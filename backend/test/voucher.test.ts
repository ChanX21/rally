import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hex, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { rewardLedger, rewardVouchers, users } from '../src/db/schema/index.js';
import { VOUCHER_TYPES, voucherNonce } from '../src/services/reward-voucher.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

const SIGNER_KEY = `0x${'22'.repeat(32)}`;
const CONTRACT = `0x${'33'.repeat(20)}`;
const WALLET = `0x${'44'.repeat(20)}`;

let h: Harness;
let user: TestUser;
let ledgerId: string;

async function grant(userId: string, key: string) {
  const [entry] = await h.app.deps.db
    .insert(rewardLedger)
    .values({
      subjectUserId: userId,
      reason: 'completed_and_vouched',
      delta: 25,
      policyVersion: 1,
      antiAbuse: 'passed',
      idempotencyKey: key,
    })
    .returning();
  return entry!.id;
}

beforeAll(async () => {
  h = await createHarness({
    REWARDS_CLAIMS_ENABLED: 'true',
    REWARD_SIGNER_PRIVATE_KEY: SIGNER_KEY,
    REWARD_CLAIM_CONTRACT: CONTRACT,
    REWARD_CHAIN_ID: '1337',
    REWARD_TOKEN_UNITS_PER_POINT: '10000',
  });
  h.wallets['did:privy:claimer'] = WALLET;
  user = await h.onboarded('did:privy:claimer', { optInMatching: false });
  ledgerId = await grant(user.id, 'test:1');
});
afterAll(() => h.close());

describe('reward vouchers', () => {
  it('signs a voucher the contract signer can be recovered from', async () => {
    const voucher = await user.post(`/me/rewards/${ledgerId}/voucher`);
    expect(voucher.domain).toEqual({
      name: 'RallyRewardClaim',
      version: '1',
      chainId: 1337,
      verifyingContract: CONTRACT,
    });
    expect(voucher.message).toMatchObject({ account: WALLET, amount: '250000' });

    const valid = await verifyTypedData({
      address: privateKeyToAccount(SIGNER_KEY as Hex).address,
      domain: { ...voucher.domain, verifyingContract: voucher.domain.verifyingContract as Address },
      types: VOUCHER_TYPES,
      primaryType: 'Claim',
      message: {
        account: voucher.message.account as Address,
        amount: BigInt(voucher.message.amount as string),
        nonce: BigInt(voucher.message.nonce as string),
        expiry: BigInt(voucher.message.expiry as string),
      },
      signature: voucher.signature as Hex,
    });
    expect(valid).toBe(true);
  });

  it('reissues the same live voucher, so a retry cannot create a second claim', async () => {
    const first = await user.post(`/me/rewards/${ledgerId}/voucher`);
    const second = await user.post(`/me/rewards/${ledgerId}/voucher`);
    expect(second.message.nonce).toBe(first.message.nonce);
  });

  it('keeps the nonce and wallet when replacing a lapsed voucher, so it cannot pay twice', async () => {
    const first = await user.post(`/me/rewards/${ledgerId}/voucher`);
    await h.app.deps.db
      .update(rewardVouchers)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(rewardVouchers.ledgerId, ledgerId));
    await h.app.deps.db
      .update(users)
      .set({ walletAddress: `0x${'55'.repeat(20)}` })
      .where(eq(users.id, user.id));

    const replacement = await user.post(`/me/rewards/${ledgerId}/voucher`);
    expect(replacement.message.nonce).toBe(first.message.nonce);
    expect(replacement.message.account).toBe(WALLET);
    expect(BigInt(replacement.message.expiry)).toBeGreaterThan(BigInt(first.message.expiry) - 3600n);
    expect(replacement.signature).toEqual(expect.stringMatching(/^0x/));
  });

  it('refuses other people, flagged entries and users with no wallet', async () => {
    const other = await h.onboarded('did:privy:other', { optInMatching: false });
    expect((await other.request('POST', `/me/rewards/${ledgerId}/voucher`)).statusCode).toBe(404);

    const otherEntry = await grant(other.id, 'test:2');
    const noWallet = await other.request('POST', `/me/rewards/${otherEntry}/voucher`);
    expect(noWallet.json().error.code).toBe('WALLET_REQUIRED');

    await h.app.deps.db
      .update(users)
      .set({ walletAddress: WALLET })
      .where(eq(users.id, other.id));
    await h.app.deps.db
      .update(rewardLedger)
      .set({ antiAbuse: 'flagged' })
      .where(eq(rewardLedger.id, otherEntry));
    const flagged = await other.request('POST', `/me/rewards/${otherEntry}/voucher`);
    expect(flagged.json().error.code).toBe('NOT_CLAIMABLE');
  });
});

describe('contract compatibility', () => {
  it('produces the signature the Foundry test verifies', async () => {
    // Same inputs as contracts/test/RewardClaim.t.sol. If this changes, change both.
    const signature = await privateKeyToAccount(`0x${'a1'.repeat(32)}`).signTypedData({
      domain: {
        name: 'RallyRewardClaim',
        version: '1',
        chainId: 1337,
        verifyingContract: `0x${'c0'.repeat(20)}`,
      },
      types: VOUCHER_TYPES,
      primaryType: 'Claim',
      message: {
        account: `0x${'b0'.repeat(20)}`,
        amount: 250000n,
        nonce: voucherNonce('ledger-fixture'),
        expiry: 4102444800n,
      },
    });
    expect({ signature, nonce: voucherNonce('ledger-fixture').toString() }).toMatchSnapshot();
  });
});

describe('with claims disabled', () => {
  it('is unavailable by default', async () => {
    const plain = await createHarness();
    try {
      const person = await plain.onboarded('did:privy:plain', { optInMatching: false });
      const response = await person.request(
        'POST',
        '/me/rewards/00000000-0000-4000-8000-000000000000/voucher',
      );
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('CLAIMS_DISABLED');
    } finally {
      await plain.close();
    }
  });
});
