import type {
  ArkivGateway,
  Listing,
  ListingValues,
  MutableListingValues,
} from '../../src/integrations/arkiv/index.js';
import type { AuthVerifier } from '../../src/integrations/privy/index.js';
import { type Infer, InferenceError } from '../../src/integrations/zero-g.js';

/** Treats any token starting with "valid:" as that user's DID. */
export function fakeAuth(wallets: Record<string, string> = {}): AuthVerifier {
  return {
    verify(token) {
      if (!token.startsWith('valid:')) return Promise.reject(new Error('invalid token'));
      return Promise.resolve({ did: token.slice('valid:'.length) });
    },
    getWallet: (did) => Promise.resolve(wallets[did] ?? null),
  };
}

export interface FakeCall {
  system: string;
  input: unknown;
}

/** Stands in for the 0G transport, so the real Formation Engine runs in every test. */
export class FakeInfer {
  readonly calls: FakeCall[] = [];
  /** Decides each reply. Throw for provider errors, or return text or an object for JSON. */
  respond: (call: FakeCall) => unknown = () => {
    throw new InferenceError('unavailable', { reason: 'http_error', httpStatus: 503 });
  };

  readonly infer: Infer = (system, input) => {
    const call = { system, input };
    this.calls.push(call);
    try {
      const reply = this.respond(call);
      return Promise.resolve({
        text: typeof reply === 'string' ? reply : JSON.stringify(reply),
        model: 'fake-model',
        providerRequestId: `req_${this.calls.length}`,
        tokens: 15,
        provider: '0xprovider',
        cost: '100 usd_micro',
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('failed'));
    }
  };

  callsFor(task: 'onboarding' | 'intent' | 'composition'): FakeCall[] {
    const marker = {
      onboarding: 'relevant question',
      intent: 'Extract activity intent',
      composition: 'Propose a compatible group',
    }[task];
    return this.calls.filter((call) => call.system.includes(marker));
  }
}

export class FakeArkiv implements ArkivGateway {
  readonly canWrite = true;
  readonly entities = new Map<string, Listing & { expiresAt: Date }>();
  readonly writes: string[] = [];
  failWrites = false;
  failReads = false;
  private next = 1;

  private writable(): void {
    if (this.failWrites) throw new Error('RPC unavailable');
  }

  createListing(values: ListingValues, expiresAt: Date) {
    this.writable();
    const entityKey = `0x${(this.next++).toString(16).padStart(64, '0')}`;
    this.entities.set(entityKey, { ...values, entityKey, expiresAt });
    this.writes.push(`create:${values.opaqueId}`);
    return Promise.resolve({ entityKey, txHash: `0xtx${this.next}` });
  }

  updateListing(entityKey: string, values: MutableListingValues) {
    this.writable();
    const entity = this.entities.get(entityKey);
    if (!entity) throw new Error('no such entity');
    this.entities.set(entityKey, { ...entity, ...values });
    this.writes.push(`update:${entity.opaqueId}`);
    return Promise.resolve({ entityKey, txHash: `0xtx${this.next++}` });
  }

  extendListing(entityKey: string, expiresAt: Date) {
    this.writable();
    const entity = this.entities.get(entityKey);
    if (!entity) throw new Error('no such entity');
    this.entities.set(entityKey, { ...entity, expiresAt });
    this.writes.push(`extend:${entity.opaqueId}`);
    return Promise.resolve({ entityKey, txHash: `0xtx${this.next++}` });
  }

  deleteListing(entityKey: string) {
    this.writable();
    const entity = this.entities.get(entityKey);
    this.entities.delete(entityKey);
    this.writes.push(`delete:${entity?.opaqueId ?? entityKey}`);
    return Promise.resolve({ txHash: entity ? `0xtx${this.next++}` : null });
  }

  findByOpaqueId(opaqueId: string) {
    if (this.failReads) return Promise.reject(new Error('RPC unavailable'));
    const found = [...this.entities.values()].find((entity) => entity.opaqueId === opaqueId);
    return Promise.resolve(found ?? null);
  }

  queryListings(filter: {
    category?: string | undefined;
    zone?: string | undefined;
    startBucket?: string | undefined;
    limit: number;
    after?: string | undefined;
  }) {
    if (this.failReads) return Promise.reject(new Error('RPC unavailable'));
    const matching = [...this.entities.values()]
      .filter((entity) => !filter.category || entity.category === filter.category)
      .filter((entity) => !filter.zone || entity.zone === filter.zone)
      .filter((entity) => !filter.startBucket || entity.startBucket === filter.startBucket)
      .filter((entity) => !filter.after || entity.entityKey > filter.after)
      .sort((a, b) => a.entityKey.localeCompare(b.entityKey));
    const listings = matching.slice(0, filter.limit);
    return Promise.resolve({
      listings,
      nextAfter: matching.length > filter.limit ? (listings.at(-1)?.entityKey ?? null) : null,
    });
  }
}
