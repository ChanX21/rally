import { eq } from 'drizzle-orm';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import { users } from '../src/db/schema/index.js';
import { createPrivyVerifier } from '../src/integrations/privy/index.js';
import { createTestDatabase, type TestDatabase } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { createHarness, type Harness } from './helpers/harness.js';

describe('createPrivyVerifier using the real SDK', () => {
  const appId = 'test-app-id';
  let sign: (claims: {
    sub?: string;
    audience?: string;
    issuer?: string;
    expiresIn?: string;
  }) => Promise<string>;
  let verificationKey: string;
  let otherSign: () => Promise<string>;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    verificationKey = await exportSPKI(pair.publicKey);
    sign = ({ sub = 'did:privy:abc', audience = appId, issuer = 'privy.io', expiresIn = '1h' }) =>
      new SignJWT({ sid: 'session-1' })
        .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
        .setSubject(sub)
        .setAudience(audience)
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(pair.privateKey);

    const other = await generateKeyPair('ES256');
    otherSign = () =>
      new SignJWT({ sid: 'session-1' })
        .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
        .setSubject('did:privy:abc')
        .setAudience(appId)
        .setIssuer('privy.io')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(other.privateKey);
  });

  const verifier = () => createPrivyVerifier({ appId, appSecret: 'secret', verificationKey });

  it('accepts a valid token and returns the DID', async () => {
    await expect(verifier().verify(await sign({}))).resolves.toEqual({ did: 'did:privy:abc' });
  });

  it('aborts a stalled wallet lookup after five seconds without retrying', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
    try {
      const result = expect(verifier().getWallet('did:privy:abc')).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5001);
      await result;
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
      vi.useRealTimers();
    }
  });

  it('rejects another app, another issuer, an expired token and a forged signature', async () => {
    await expect(verifier().verify(await sign({ audience: 'other-app' }))).rejects.toThrow();
    await expect(verifier().verify(await sign({ issuer: 'evil.io' }))).rejects.toThrow();
    await expect(verifier().verify(await sign({ expiresIn: '-1h' }))).rejects.toThrow();
    await expect(verifier().verify(await otherSign())).rejects.toThrow();
    await expect(verifier().verify('not-a-jwt')).rejects.toThrow();
  });
});

describe('authentication', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('rejects missing and invalid tokens', async () => {
    const missing = await h.app.inject({ url: '/me' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('UNAUTHENTICATED');

    const invalid = await h.app.inject({
      url: '/me',
      headers: { authorization: 'Bearer garbage' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.code).toBe('INVALID_TOKEN');
  });

  it('protects every non-public route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const routes = [
      ['GET', '/me'],
      ['PATCH', '/me/profile'],
      ['POST', '/me/blocks'],
      ['DELETE', `/me/blocks/${id}`],
      ['GET', '/me/rewards'],
      ['POST', `/me/rewards/${id}/voucher`],
      ['GET', '/me/disputes'],
      ['POST', `/rallies/${id}/arrive`],
      ['POST', `/rallies/${id}/disputes`],
      ['POST', '/onboarding/questions'],
      ['POST', '/onboarding/complete'],
      ['POST', '/intents/parse'],
      ['GET', '/intents'],
      ['POST', `/intents/${id}/activate`],
      ['POST', `/intents/${id}/cancel`],
      ['POST', '/rallies'],
      ['GET', '/rallies'],
      ['GET', `/rallies/${id}`],
      ['PATCH', `/rallies/${id}`],
      ['POST', `/rallies/${id}/publish`],
      ['POST', `/rallies/${id}/cancel`],
      ['POST', `/rallies/${id}/withdraw`],
      ['GET', `/rallies/${id}/participants`],
      ['GET', `/rallies/${id}/room`],
      ['POST', `/rallies/${id}/check-in`],
      ['POST', `/rallies/${id}/feedback`],
      ['GET', '/matches'],
      ['GET', `/matches/${id}`],
      ['POST', `/matches/${id}/respond`],
      ['GET', '/notifications'],
      ['POST', '/notifications/read-all'],
      ['POST', `/notifications/${id}/read`],
    ] as const;
    for (const [method, url] of routes) {
      const response = await h.app.inject({ method, url, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('requires a session before other routes', async () => {
    const response = await h.app.inject({
      url: '/me',
      headers: { authorization: 'Bearer valid:did:privy:new' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SESSION_REQUIRED');
  });

  it('creates a user once and ignores identity supplied in the body', async () => {
    h.wallets['did:privy:a'] = '0x000000000000000000000000000000000000aaaa';
    const first = await h.app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { authorization: 'Bearer valid:did:privy:a' },
      payload: { userId: 'evil', wallet: '0xevil', privyDid: 'did:privy:victim' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.walletAddress).toBe('0x000000000000000000000000000000000000aaaa');

    const again = await h.user('did:privy:a');
    expect(again.id).toBe(first.json().data.id);

    const victim = await h.app.deps.db
      .select()
      .from(users)
      .where(eq(users.privyDid, 'did:privy:victim'));
    expect(victim).toEqual([]);
  });

  it('updates the wallet from Privy and keeps it through a Privy failure', async () => {
    const did = 'did:privy:wallet';
    h.wallets[did] = '0x000000000000000000000000000000000000bbbb';
    await h.user(did);
    h.wallets[did] = '0x000000000000000000000000000000000000cccc';
    await h.user(did);
    delete h.wallets[did];
    await h.user(did);

    const [row] = await h.app.deps.db.select().from(users).where(eq(users.privyDid, did));
    expect(row?.walletAddress).toBe('0x000000000000000000000000000000000000cccc');
  });

  it('blocks suspended users', async () => {
    const user = await h.user('did:privy:suspended');
    await h.app.deps.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));
    const response = await user.request('GET', '/me');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('allows new and returning sessions when the optional wallet lookup fails', async () => {
    const did = 'did:privy:wallet-timeout';
    const auth = h.app.deps.auth!;
    const lookup = vi.spyOn(auth, 'getWallet').mockRejectedValue(new Error('wallet lookup timed out'));
    try {
      const first = await h.user(did);
      const again = await h.user(did);
      expect(again.id).toBe(first.id);
      expect((await again.get('/me')).user.walletAddress).toBeNull();
    } finally {
      lookup.mockRestore();
    }
  });

  it('hides internal metrics without a token configured', async () => {
    const response = await h.app.inject({
      url: '/internal/metrics',
      headers: { authorization: 'Bearer anything' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('when Privy is not configured', () => {
  let database: TestDatabase;
  let app: App;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildApp({ env: testEnv({ DATABASE_URL: database.url }) });
  });
  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it('boots and refuses authentication rather than allowing access', async () => {
    const response = await app.inject({
      url: '/me',
      headers: { authorization: 'Bearer anything' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('AUTH_NOT_CONFIGURED');
  });
});

describe('internal metrics', () => {
  let h: Harness;
  const token = 'a'.repeat(32);

  beforeAll(async () => {
    h = await createHarness({ ADMIN_API_TOKEN: token });
  });
  afterAll(() => h.close());

  it('requires the admin token and returns aggregates', async () => {
    const denied = await h.app.inject({
      url: '/internal/metrics',
      headers: { authorization: `Bearer ${'b'.repeat(32)}` },
    });
    expect(denied.statusCode).toBe(401);

    await h.onboarded('did:privy:metrics');
    const allowed = await h.app.inject({
      url: '/internal/metrics',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.users).toMatchObject({ total: 1, onboarded: 1, opted_in: 1 });
  });
});
