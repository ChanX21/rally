import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseEnv } from '../src/config/env.js';

const DATABASE_URL = 'postgres://user:s3cret-value@db.example.com:5432/rally';

describe('parseEnv', () => {
  it('rejects malformed verification overrides and accepts ES256 public keys', () => {
    for (const namedCurve of ['prime256v1', 'secp384r1']) {
      const pair = generateKeyPairSync('ec', { namedCurve });
      const key = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      if (namedCurve === 'prime256v1') {
        expect(parseEnv({ DATABASE_URL, PRIVY_VERIFICATION_KEY: key }).PRIVY_VERIFICATION_KEY).toBe(key);
      } else {
        expect(() => parseEnv({ DATABASE_URL, PRIVY_VERIFICATION_KEY: key })).toThrow(/PRIVY_VERIFICATION_KEY/);
      }
    }
    expect(() => parseEnv({ DATABASE_URL, PRIVY_VERIFICATION_KEY: 'placeholder' })).toThrow(/PRIVY_VERIFICATION_KEY/);
    expect(parseEnv({ DATABASE_URL, PRIVY_VERIFICATION_KEY: '' }).PRIVY_VERIFICATION_KEY).toBeUndefined();
  });

  it('applies defaults', () => {
    const env = parseEnv({ DATABASE_URL });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY: false,
      CORS_ORIGINS: [],
    });
  });

  it('treats blank values as unset', () => {
    const env = parseEnv({ DATABASE_URL, DATABASE_MIGRATION_URL: '', PORT: ' ' });
    expect(env.DATABASE_MIGRATION_URL).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it('parses and trims CORS origins', () => {
    const env = parseEnv({
      DATABASE_URL,
      CORS_ORIGINS: 'https://a.example.com, http://localhost:5173',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example.com', 'http://localhost:5173']);
  });

  it.each(['*', 'a.example.com', 'https://a.example.com/path', 'https://a.example.com/'])(
    'rejects CORS origin %s',
    (origin) => {
      expect(() => parseEnv({ DATABASE_URL, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
    },
  );

  it('requires CORS origins in production', () => {
    expect(() => parseEnv({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
  });

  it('requires a PostgreSQL DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/rally' })).toThrow(/DATABASE_URL/);
  });

  it('never includes values in validation errors', () => {
    let caught: unknown;
    try {
      parseEnv({ DATABASE_URL, PORT: 'not-a-port', DATABASE_MIGRATION_URL: 'http://s3cret-value' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as Error).message).toMatch(/PORT/);
    expect((caught as Error).message).not.toContain('s3cret-value');
  });
});
