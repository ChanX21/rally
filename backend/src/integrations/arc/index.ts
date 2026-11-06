import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Must match contracts/src/RallyLedger.sol. The smoke script runs this against the real contract. */
export const LEDGER_ABI = parseAbi([
  'function record(address subject, uint8 action, int32 delta, uint32 policyVersion, bytes32 ref, bytes32 evidenceHash, bytes32 key)',
  'function recordRuling(bytes32 disputeRef, address subject, address raiser, uint8 category, uint8 outcome, bytes32 evidenceHash, bytes32 key)',
  'function publishPolicy(uint32 version, int32[8] amounts)',
  'function latestPolicy() view returns (uint32)',
  'function netOf(address subject) view returns (int256)',
  'function debt(address subject) view returns (uint256)',
  'function token() view returns (address)',
]);

export interface ArcRecord {
  subject: string;
  /** Index into REWARD_ACTIONS. */
  action: number;
  delta: number;
  policyVersion: number;
  ref: Hex;
  evidenceHash: Hex;
  key: Hex;
}

export interface ArcRuling {
  disputeRef: Hex;
  subject: string;
  raiser: string;
  /** Index into DISPUTE_CATEGORIES. */
  category: number;
  /** Index into DISPUTE_OUTCOMES. */
  outcome: number;
  evidenceHash: Hex;
  key: Hex;
}

export interface ArcGateway {
  record(input: ArcRecord): Promise<Hex>;
  recordRuling(input: ArcRuling): Promise<Hex>;
  /** Returns null if that version is already on-chain, so a retry after a timeout still succeeds. */
  publishPolicy(version: number, amounts: number[]): Promise<Hex | null>;
}

interface ArcOptions {
  rpcUrl: string;
  chainId: number;
  ledgerAddress: string;
  privateKey: string;
}

const RECEIPT_TIMEOUT_MS = 60_000;

export function createArcGateway(options: ArcOptions): ArcGateway {
  const chain = defineChain({
    id: options.chainId,
    name: 'Arc',
    // Arc pays gas in USDC. The native balance uses 18 decimals, unlike USDC's ERC-20 interface.
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [options.rpcUrl] } },
  });
  const transport = http(options.rpcUrl);
  const account = privateKeyToAccount(options.privateKey as Hex);
  const reader = createPublicClient({ chain, transport });
  const writer = createWalletClient({ account, chain, transport });
  const address = getAddress(options.ledgerAddress);

  /** Waits for the receipt. The outbox runs one event at a time, which keeps nonces in order. */
  const confirm = async (hash: Hex): Promise<Hex> => {
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted`);
    return hash;
  };

  const eoa = (value: string): Address => getAddress(value);

  return {
    async record(input) {
      return confirm(
        await writer.writeContract({
          address,
          abi: LEDGER_ABI,
          functionName: 'record',
          args: [
            eoa(input.subject),
            input.action,
            input.delta,
            input.policyVersion,
            input.ref,
            input.evidenceHash,
            input.key,
          ],
        }),
      );
    },

    async recordRuling(input) {
      return confirm(
        await writer.writeContract({
          address,
          abi: LEDGER_ABI,
          functionName: 'recordRuling',
          args: [
            input.disputeRef,
            eoa(input.subject),
            eoa(input.raiser),
            input.category,
            input.outcome,
            input.evidenceHash,
            input.key,
          ],
        }),
      );
    },

    async publishPolicy(version, amounts) {
      const latest = await reader.readContract({
        address,
        abi: LEDGER_ABI,
        functionName: 'latestPolicy',
      });
      if (latest >= version) return null;
      return confirm(
        await writer.writeContract({
          address,
          abi: LEDGER_ABI,
          functionName: 'publishPolicy',
          args: [version, amounts as unknown as readonly [number, number, number, number, number, number, number, number]],
        }),
      );
    },
  };
}
