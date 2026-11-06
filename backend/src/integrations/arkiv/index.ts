import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  NoEntityFoundError,
} from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { and, asc, eq, gt } from '@arkiv-network/sdk/query';
import { defineSchema, i32, key as keyValue, str } from '@arkiv-network/sdk/schema';
import type { Hex } from 'viem';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Everything Rally publishes. Adding a field here needs a privacy review: it becomes public. */
export interface ListingValues {
  app: string;
  event: string;
  opaqueId: string;
  category: string;
  zone: string;
  startBucket: string;
  neededRole: string;
  openSeats: number;
  minGroupSize: number;
  status: string;
}

export type MutableListingValues = Pick<
  ListingValues,
  'category' | 'zone' | 'startBucket' | 'neededRole' | 'openSeats' | 'minGroupSize' | 'status'
>;

export interface Listing extends ListingValues {
  entityKey: string;
}

export interface ListingFilter {
  category?: string | undefined;
  zone?: string | undefined;
  startBucket?: string | undefined;
  limit: number;
  /** Key of the last row of the previous page. */
  after?: string | undefined;
}

export interface ArkivWriteResult {
  entityKey: string;
  txHash: string;
}

export interface ArkivGateway {
  /** False when no relayer key is configured. Reads may still work. */
  readonly canWrite: boolean;
  createListing(values: ListingValues, expiresAt: Date): Promise<ArkivWriteResult>;
  updateListing(entityKey: string, values: MutableListingValues): Promise<ArkivWriteResult>;
  extendListing(entityKey: string, expiresAt: Date): Promise<ArkivWriteResult>;
  deleteListing(entityKey: string): Promise<{ txHash: string | null }>;
  findByOpaqueId(opaqueId: string): Promise<Listing | null>;
  queryListings(filter: ListingFilter): Promise<{ listings: Listing[]; nextAfter: string | null }>;
}

export interface ArkivOptions {
  privateKey: string | undefined;
  accessKey: string | undefined;
  rpcUrl: string | undefined;
  app: string;
  event: string;
  schemaName: string;
  queryTimeoutMs: number;
}

export function listingSchema(schemaName: string) {
  return defineSchema(schemaName, {
    app: str().indexed(),
    event: str().indexed(),
    opaqueId: str().indexed(),
    category: str().indexed(),
    zone: str().indexed(),
    startBucket: str().indexed(),
    neededRole: str().indexed(),
    openSeats: i32().indexed(),
    minGroupSize: i32(),
    status: str().indexed(),
  });
}

/** A short-lived listing still gets a minimum life, so a late sync cannot be rejected as expired. */
const MINIMUM_LIFE = ExpirationTime.fromHours(1);

/** Requires a relayer key to know whose entities to trust, because anyone can write this schema. */
export function createArkivGateway(options: ArkivOptions): ArkivGateway | null {
  if (!options.privateKey) return null;

  const schema = listingSchema(options.schemaName);
  const chain = rabdi({ accessKey: options.accessKey ?? '' });
  // No retries: the transport waits out Retry-After, ignoring the timeout, and Arkiv can send 980
  // seconds. A failed read shows a notice on Discover and retries on the next poll or outbox attempt.
  const transport = http(options.rpcUrl, { timeout: options.queryTimeoutMs, retryCount: 0 });
  const account = privateKeyToAccount(options.privateKey as Hex);
  const publicClient = createPublicClient({ chain, transport });
  // Chain writes wait for a block, so they get a longer deadline than reads.
  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(options.rpcUrl, { timeout: 30_000 }),
  });

  const baseQuery = () =>
    publicClient
      .select({
        $key: true,
        app: true,
        event: true,
        opaqueId: true,
        category: true,
        zone: true,
        startBucket: true,
        neededRole: true,
        openSeats: true,
        minGroupSize: true,
        status: true,
      })
      .from(schema)
      .ownedBy(account.address);

  type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['fetch']>>['entities'][number];

  const toListing = (row: Row): Listing => ({
    entityKey: row.$key,
    app: row.app.value,
    event: row.event.value,
    opaqueId: row.opaqueId.value,
    category: row.category.value,
    zone: row.zone.value,
    startBucket: row.startBucket.value,
    neededRole: row.neededRole.value,
    openSeats: Number(row.openSeats.value),
    minGroupSize: Number(row.minGroupSize.value),
    status: row.status.value,
  });

  return {
    canWrite: true,

    async createListing(values, expiresAt) {
      const { entityKey, txHash } = await walletClient.createEntity(
        schema,
        { ...values, openSeats: i32(values.openSeats), minGroupSize: i32(values.minGroupSize) },
        { expiration: ExpirationTime.atDate(expiresAt, { atLeast: MINIMUM_LIFE }) },
      );
      return { entityKey, txHash };
    },

    async updateListing(entityKey, values) {
      const { txHash } = await walletClient.patchEntity(schema, entityKey as Hex, {
        set: {
          ...values,
          openSeats: i32(values.openSeats),
          minGroupSize: i32(values.minGroupSize),
        },
      });
      return { entityKey, txHash };
    },

    async extendListing(entityKey, expiresAt) {
      const { txHash } = await walletClient.extendEntity({
        entityKey: entityKey as Hex,
        expiration: ExpirationTime.atDate(expiresAt, { atLeast: MINIMUM_LIFE }),
      });
      return { entityKey, txHash };
    },

    async deleteListing(entityKey) {
      // An entity that expired on its own is already gone. Check first, since a failed delete is
      // indistinguishable from any other transaction revert.
      try {
        await publicClient.getEntity(entityKey as Hex, schema);
      } catch (error) {
        if (error instanceof NoEntityFoundError) return { txHash: null };
        throw error;
      }
      const { txHash } = await walletClient.deleteEntity({ entityKey: entityKey as Hex });
      return { txHash };
    },

    async findByOpaqueId(opaqueId) {
      const result = await baseQuery().where(eq('opaqueId', opaqueId)).limit(1).fetch();
      const row = result.entities[0];
      return row ? toListing(row) : null;
    },

    async queryListings(filter) {
      const conditions = [
        eq('app', options.app),
        eq('event', options.event),
        ...(filter.category ? [eq('category', filter.category)] : []),
        ...(filter.zone ? [eq('zone', filter.zone)] : []),
        ...(filter.startBucket ? [eq('startBucket', filter.startBucket)] : []),
        ...(filter.after ? [gt('$key', keyValue(filter.after as Hex))] : []),
      ];
      const result = await baseQuery()
        .where(and(...conditions))
        .orderBy(asc('$key'))
        .limit(filter.limit)
        .fetch();

      const listings = result.entities.map(toListing);
      const last = listings.at(-1);
      return {
        listings,
        nextAfter: result.entities.length === filter.limit && last ? last.entityKey : null,
      };
    },
  };
}
