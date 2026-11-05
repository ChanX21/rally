import { and, eq, gt } from 'drizzle-orm';
import { type Address, type Hex, hexToBigInt, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { rewardLedger, rewardVouchers } from '../db/schema/index.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { lockUser } from '../repositories/users.js';

/** Must match CLAIM_TYPEHASH and the EIP-712 domain in contracts/src/RewardClaim.sol. */
export const VOUCHER_TYPES = {
  Claim: [
    { name: 'account', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

/** One nonce per ledger entry, forever. */
export function voucherNonce(ledgerId: string): bigint {
  return hexToBigInt(keccak256(toHex(ledgerId)));
}

/**
 * Signs eligibility for an already-earned ledger entry. A voucher is evidence of eligibility, not
 * proof of physical presence, and it is off by default: core Rally works without any contract.
 */
export async function issueVoucher(deps: Deps, userId: string, ledgerId: string) {
  const { env } = deps;
  if (
    !env.REWARDS_CLAIMS_ENABLED ||
    !env.REWARD_SIGNER_PRIVATE_KEY ||
    !env.REWARD_CLAIM_CONTRACT ||
    !env.REWARD_CHAIN_ID ||
    !env.REWARD_TOKEN_UNITS_PER_POINT
  ) {
    throw new AppError(404, 'CLAIMS_DISABLED', 'On-chain claims are not enabled');
  }

  const signer = privateKeyToAccount(env.REWARD_SIGNER_PRIVATE_KEY as Hex);
  const verifyingContract = env.REWARD_CLAIM_CONTRACT as Address;
  const chainId = env.REWARD_CHAIN_ID;
  const unitsPerPoint = env.REWARD_TOKEN_UNITS_PER_POINT;
  const ttlMinutes = env.REWARD_VOUCHER_TTL_MINUTES;

  return deps.db.transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!user) throw notFound('User');

    const [entry] = await tx
      .select()
      .from(rewardLedger)
      .where(and(eq(rewardLedger.id, ledgerId), eq(rewardLedger.subjectUserId, userId)));
    if (!entry) throw notFound('Reward');
    if (entry.antiAbuse !== 'passed' || entry.delta <= 0) {
      throw new AppError(409, 'NOT_CLAIMABLE', 'This reward cannot be claimed');
    }
    if (!user.walletAddress) {
      throw new AppError(409, 'WALLET_REQUIRED', 'A verified wallet is required to claim');
    }

    const [existing] = await tx
      .select()
      .from(rewardVouchers)
      .where(and(eq(rewardVouchers.ledgerId, ledgerId), gt(rewardVouchers.expiresAt, new Date())));

    const domain = { name: 'RallyRewardClaim', version: '1', chainId, verifyingContract } as const;
    const present = (voucher: typeof rewardVouchers.$inferSelect) => ({
      domain,
      message: {
        account: voucher.wallet,
        amount: voucher.amount,
        nonce: voucher.nonce,
        expiry: String(Math.floor(voucher.expiresAt.getTime() / 1000)),
      },
      signature: voucher.signature,
    });

    if (existing) return present(existing);

    const [previous] = await tx
      .select()
      .from(rewardVouchers)
      .where(eq(rewardVouchers.ledgerId, ledgerId));

    // The backend cannot see whether a lapsed voucher was claimed on-chain before it expired. A
    // replacement therefore keeps the same nonce and wallet, so the contract rejects a second claim.
    const account = (previous?.wallet ?? user.walletAddress) as Address;
    const nonce = voucherNonce(ledgerId);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const amount = BigInt(entry.delta) * unitsPerPoint;
    const signature = await signer.signTypedData({
      domain,
      types: VOUCHER_TYPES,
      primaryType: 'Claim',
      message: {
        account,
        amount,
        nonce,
        expiry: BigInt(Math.floor(expiresAt.getTime() / 1000)),
      },
    });

    const values = {
      ledgerId,
      userId,
      wallet: account,
      amount: amount.toString(),
      nonce: nonce.toString(),
      expiresAt,
      signature,
    };
    const [voucher] = previous
      ? await tx
          .update(rewardVouchers)
          .set(values)
          .where(eq(rewardVouchers.id, previous.id))
          .returning()
      : await tx.insert(rewardVouchers).values(values).returning();
    return present(voucher!);
  });
}
