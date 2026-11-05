// Checks 0G and Privy credentials against the real services. Makes one small paid 0G call.
//   npm run smoke:integrations
import { PrivyClient } from '@privy-io/node';

import { loadEnv } from '../src/config/env.js';
import { createPrivyVerifier } from '../src/integrations/privy/index.js';
import { createZeroGProvider } from '../src/integrations/zerog/index.js';

const env = loadEnv();
let failed = false;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200) ?? '';

if (!env.ZG_API_KEY) {
  report(false, '0G', 'ZG_API_KEY is not set');
} else {
  const catalog = (await (await fetch(`${env.ZG_BASE_URL}/models`)).json()) as {
    data: { id: string; verifiability?: string }[];
  };
  const entry = catalog.data.find((model) => model.id === env.ZG_MODEL);
  report(entry !== undefined, `0G model ${env.ZG_MODEL} is in the catalog`);
  console.log(`      verifiability: ${entry?.verifiability ?? 'none'}`);

  const provider = createZeroGProvider({
    apiKey: env.ZG_API_KEY,
    baseUrl: env.ZG_BASE_URL,
    model: env.ZG_MODEL,
    trustMode: env.ZG_TRUST_MODE,
    verifyTee: env.ZG_VERIFY_TEE,
    timeoutMs: Math.max(env.ZG_TIMEOUT_MS, 60_000),
  });
  const startedAt = Date.now();
  try {
    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'Respond with one JSON object: {"ok": true}.' },
        { role: 'user', content: 'Health check.' },
      ],
      maxTokens: 500,
    });
    report(true, '0G completion', `${Date.now() - startedAt} ms`);
    console.log(`      content: ${result.content.slice(0, 100)}`);
    console.log(`      model: ${result.model}`);
    console.log(`      request ID: ${result.requestId ?? 'MISSING'}`);
    console.log(`      provider: ${result.provider ?? 'MISSING'}`);
    console.log(`      cost: ${result.cost ?? 'MISSING'}`);
    console.log(`      tee verified: ${result.teeVerified ?? 'not requested'}`);
    report(result.requestId !== null, '0G returned a request ID');
  } catch (error) {
    report(false, '0G completion', `${Date.now() - startedAt} ms, ${messageOf(error)}`);
  }
}

if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
  report(false, 'Privy', 'credentials are not set');
} else {
  const verifier = createPrivyVerifier({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
    verificationKey: env.PRIVY_VERIFICATION_KEY,
  });
  try {
    await verifier.verify('not-a-real-token');
    report(false, 'Privy rejects a junk token', 'it was accepted');
  } catch {
    report(true, 'Privy rejects a junk token');
  }

  // An unknown user returning 404 proves the app ID and secret authenticated successfully.
  const client = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  try {
    await client.users()._get('did:privy:cm000000000000000000000000');
    report(true, 'Privy API accepted the credentials');
  } catch (error) {
    const status = (error as { status?: number }).status;
    report(status === 404, 'Privy API accepted the credentials', `HTTP ${status ?? messageOf(error)}`);
  }
}

process.exitCode = failed ? 1 : 0;
