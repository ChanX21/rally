# How Rally uses Arkiv

Arkiv matches what Rally's public board needs. A listing is public and small, it changes while a plan
comes together, and it stops mattering once the plan has passed. Arkiv entities can be read by anyone,
updated in place and expire by themselves, so the data model maps across directly.

Every Rally that is open to the public gets one listing. The public Discover screen,
<https://www.therally.xyz/app/discover>, is built from a query for those listings, and
[the reader](https://www.therally.xyz/reader.html) shows the same data straight from Arkiv. The field list,
expiry rules and runnable queries are in [`schema.md`](schema.md).

## Why Arkiv fits

| What a Rally needs | Arkiv feature | What people see |
| --- | --- | --- |
| Old plans must disappear | Automatic expiry, set to the end of the plan's time window | A plan whose time has passed leaves the board, even if our worker is down |
| Details change after publishing | `patchEntity` on the existing listing | The same listing shows the current seats, status, time slot and area, with no duplicates |
| The time window moves later | `extendEntity` | The listing stays up until the new end time |
| Plans finish early or get cancelled | `deleteEntity` | The Rally leaves the board at once |
| Listings must be trustworthy | An owner the network enforces | Listings written by any other wallet never appear |
| People ask "any coffee on my floor?" | Indexed `category` and `zone` attributes | Discover's two filters go straight into the Arkiv query |
| Long boards must page cleanly | `$key` cursors with `ORDER BY` | "Show more" loads the next page without repeats |
| The board should be open | Public queries, with no account | Anyone can browse before signing in |

### Example: a plan changes

Rally's update API lets a host move a published coffee from 5pm to 6pm until people have been invited.
Rally patches `startBucket` on the existing listing, and extends its expiry if the window now ends later.
Anyone reading Arkiv sees the new time under the same entity key, with nothing to clean up.

The same happens as people join. When someone accepts, `openSeats` and `status` are patched, so a listing
goes from `filling` to `full` without being republished.

## The read and write paths

```text
Write  Host approves plan -> PostgreSQL commit -> outbox job -> relayer writes to Arkiv
Read   Discover -> GET /activities/preview -> Arkiv query -> checked against PostgreSQL -> cards and map
Direct The reader -> Arkiv query, with no Rally backend involved
```

Writes happen after the database commit, so a slow chain write never blocks someone joining. A retry reads
current PostgreSQL state and converges instead of replaying an old snapshot, and a reconciler repairs any
listing that drifts.

## How each filter is used

| Query part | Why it is there |
| --- | --- |
| `$owner` | Makes a listing trustworthy. A test confirms another writer's listing never appears |
| `app`, `event` | Keeps a board to one event. Smoke tests write to a separate event and stay out of the live board |
| `$key` with `ORDER BY` | Drives "show more" with stable pages during writes |
| `opaqueId` | After a crash between a chain write and our commit, a retry finds the listing and adopts it |
| `category`, `zone` | Drive Discover's activity and area filters |

`startBucket`, `neededRole`, `openSeats` and `status` are indexed too, so another app can ask for "open plans
needing a builder" using the same public data.

## Who can edit

One relayer owns every listing. This suits a public board, because a person's wallet is never tied to their
plans on a permanent chain history. People also need no gas or wallet prompt to publish.

## Reliability

| Situation | What users see |
| --- | --- |
| Arkiv unreachable or rate limited | Discover shows a notice straight away and tries again on its 15-second refresh. Matching, invitations and joining keep working |
| Listing written by another wallet | Never shown |
| Listing is stale or unknown to Rally | Dropped by the PostgreSQL check |
| Two workers run at once | A PostgreSQL advisory lock keeps relayer nonces in order |

These are covered in [`backend/test/arkiv.test.ts`](../backend/test/arkiv.test.ts), which fakes the
network. Run `npm run arkiv:smoke` in `backend/` for the real one, and `npm run arkiv:smoke -- --write`
with a funded key to create, read, patch, extend and delete a test entity.

## Numbers

Read from the live network, with times in UTC:

| Measure | 7 November 2026, about 02:15 | 6 November 2026, about 18:15 |
| --- | --- | --- |
| Live listings owned by the relayer | 5 | 9 |
| Rally's public API returned | 5, all 5 found on Arkiv | 9, all 9 found on Arkiv |
| Listing status | 5 `open` | 5 `open`, 4 `filling` |
| Other wallets found under our schema name | 0 | 0 in the first 100 rows |
| Transactions sent by the relayer | 155 | 135 |
| Relayer balance | 9.984 tGLM | 9.986 tGLM |
| Single query latency, with a key | 516 to 1,765 ms | 246 to 591 ms |
| Cost per listing or count query | 10 quota units, from the `Arkiv-Cost` header | Same |

The listing count moves as plans end and new ones open. The transaction count includes smoke tests and is
not a count of Rallies. Latency comes from a handful of queries on one connection, not a load test.
