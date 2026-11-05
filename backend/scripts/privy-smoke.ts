// Checks Privy credentials against the real service. Use npm run ai:smoke for 0G.
//   npm run smoke:privy
import { PrivyClient } from '@privy-io/node';

import { loadEnv } from '../src/config/env.js';
import { createPrivyVerifier } from '../src/integrations/privy/index.js';

const env = loadEnv();
let failed = false;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200) ?? '';

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
