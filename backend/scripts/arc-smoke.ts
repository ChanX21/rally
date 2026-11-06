/**
 * Runs the real gateway against a deployed RallyLedger, which proves the ABI and the contract agree.
 * Writes to the chain, so it is only for Anvil or Arc Testnet.
 *
 *   ARC_RPC_URL=... ARC_CHAIN_ID=... ARC_LEDGER_ADDRESS=... ARC_RELAYER_PRIVATE_KEY=... npx tsx scripts/arc-smoke.ts
 */
import { randomBytes } from 'node:crypto';

import {
  createPublicClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from 'viem';

import { DEFAULT_AMOUNTS, REWARD_ACTIONS } from '../src/domain/reward-policy.js';
import { createArcGateway, LEDGER_ABI } from '../src/integrations/arc/index.js';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
};

const rpcUrl = need('ARC_RPC_URL');
const chainId = Number(need('ARC_CHAIN_ID'));
const ledgerAddress = getAddress(need('ARC_LEDGER_ADDRESS'));
const gateway = createArcGateway({
  rpcUrl,
  chainId,
  ledgerAddress,
  privateKey: need('ARC_RELAYER_PRIVATE_KEY'),
});
const reader = createPublicClient({
  chain: defineChain({
    id: chainId,
    name: 'Arc',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }),
  transport: http(rpcUrl),
});

const run = randomBytes(8).toString('hex');
const key = (label: string): Hex => keccak256(stringToHex(`smoke:${run}:${label}`));
// A fresh throwaway address each run, so test records never land on a real person.
const subject = getAddress(`0x${randomBytes(20).toString('hex')}`);
const raiser = getAddress(`0x${randomBytes(20).toString('hex')}`);

const read = async () => {
  const token = await reader.readContract({ address: ledgerAddress, abi: LEDGER_ABI, functionName: 'token' });
  const balance = await reader.readContract({
    address: token,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [subject],
  });
  const net = await reader.readContract({
    address: ledgerAddress,
    abi: LEDGER_ABI,
    functionName: 'netOf',
    args: [subject],
  });
  const debt = await reader.readContract({
    address: ledgerAddress,
    abi: LEDGER_ABI,
    functionName: 'debt',
    args: [subject],
  });
  return { balance, net, debt };
};

const assertState = async (label: string, want: { balance: bigint; net: bigint; debt: bigint }) => {
  const got = await read();
  if (got.balance !== want.balance || got.net !== want.net || got.debt !== want.debt) {
    throw new Error(`${label}: expected ${String(want.net)}, got ${String(got.net)}`);
  }
  console.log(`ok  ${label}: balance=${got.balance} debt=${got.debt} net=${got.net}`);
};

const record = (action: (typeof REWARD_ACTIONS)[number], label: string) =>
  gateway.record({
    subject,
    action: REWARD_ACTIONS.indexOf(action),
    delta: DEFAULT_AMOUNTS[action],
    policyVersion: 1,
    ref: key(`ref:${label}`),
    evidenceHash: key(`evidence:${label}`),
    key: key(label),
  });

console.log(`subject ${subject}`);
await record('OnTime', 'on-time');
await assertState('earn mints', { balance: 10n, debt: 0n, net: 10n });

// The same key again, as a worker retry would send it.
await record('OnTime', 'on-time');
await assertState('a retry is a no-op', { balance: 10n, debt: 0n, net: 10n });

await record('NoShow', 'no-show');
await assertState('a penalty burns, then adds debt', { balance: 0n, debt: 10n, net: -10n });

await record('Vouched', 'vouched');
await assertState('earning repays debt first', { balance: 15n, debt: 0n, net: 15n });

const ruling = await gateway.recordRuling({
  disputeRef: key('dispute'),
  subject,
  raiser,
  category: 1,
  outcome: 0,
  evidenceHash: key('dispute-evidence'),
  key: key('ruling'),
});
console.log(`ok  ruling recorded: ${ruling}`);

const already = await gateway.publishPolicy(1, REWARD_ACTIONS.map((action) => DEFAULT_AMOUNTS[action]));
if (already !== null) throw new Error('publishing an existing version should be a no-op');
console.log('ok  republishing a version is a no-op');

const bad = await gateway
  .record({
    subject,
    action: 0,
    delta: 99,
    policyVersion: 1,
    ref: key('ref:bad'),
    evidenceHash: key('evidence:bad'),
    key: key('bad'),
  })
  .then(
    () => false,
    () => true,
  );
if (!bad) throw new Error('a delta outside the policy should revert');
console.log('ok  a delta outside the policy reverts');
console.log('smoke passed');
