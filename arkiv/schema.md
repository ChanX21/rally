# Arkiv schema

Rally has one entity type: a public listing for an activity that is looking for people.

| | |
| --- | --- |
| Network | Rabdi testnet, network ID `7794095` |
| RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network` |
| Schema name | `rally-mumbai.activity.v1` |
| Owner of every entity | Rally's relayer, [`0x0881ABfDB5FAE83F6d35FFc0A0C862f1BAD873a1`](https://rabdi.explorer.arkiv.network/address/0x0881ABfDB5FAE83F6d35FFc0A0C862f1BAD873a1) |
| SDK | `@arkiv-network/sdk` 1.0.1 |
| Code | [`backend/src/integrations/arkiv/index.ts`](../backend/src/integrations/arkiv/index.ts), [`backend/src/services/arkiv-sync.ts`](../backend/src/services/arkiv-sync.ts) |

## Fields

| Field | Type | Indexed | Example | Meaning | Does Rally's own app filter on it? |
| --- | --- | --- | --- | --- | --- |
| `app` | `str` | yes | `rally-mumbai` | Application namespace | Yes, every listing query |
| `event` | `str` | yes | `ethglobal-mumbai-2026` | Event the listing belongs to | Yes, every listing query |
| `opaqueId` | `str` | yes | `rly_K2OWzFPqjd6vMdEG` | Random ID, unrelated to the private database ID | Yes, crash recovery lookup |
| `category` | `str` | yes | `coffee` | Value from a fixed catalog | Yes, Discover's activity filter |
| `zone` | `str` | yes | `venue-floor-1` | Coarse area from a fixed list | Yes, Discover's area filter |
| `startBucket` | `str` | yes | `2026-11-07T00` | Start time, rounded down to the UTC hour | API supports it; Discover does not send it |
| `neededRole` | `str` | yes | `participant` | Role being sought | No, indexed for other readers |
| `openSeats` | `i32` | yes | `2` | Seat estimate at the last sync | No, indexed for other readers |
| `minGroupSize` | `i32` | no | `3` | Smallest group that goes ahead | No |
| `status` | `str` | yes | `open` | `open`, `filling`, `full` or `closed` | No, indexed for other readers |

System fields used: `$key` for cursor pagination, `$owner` for trust, and `$expiresAt` for lifetime.

## Who owns and edits each entity

One relayer wallet owns and writes every listing. Only that wallet can patch, extend or delete one.

- People using Rally have no Arkiv wallet and cannot edit listings directly. They change a listing by
  acting in the app, and the backend syncs the result.
- Anyone can write an entity under this schema name, so readers must filter on `$owner`. Rally's
  queries always do, through `.ownedBy(relayer)`.
- `readonly` is off because seats and status change. `permissionlessExtension` is off because only
  a change to the plan should move a deadline.

## When each entity expires

Expiry is the activity's window end, with a one hour minimum so a late sync cannot be rejected as
already expired:

```ts
ExpirationTime.atDate(rally.expiresAt, { atLeast: ExpirationTime.fromHours(1) })
```

Example from the live network: the listing with `startBucket` `2026-11-07T00` expires at block
`0x4c84b` (313419). At block 301561, with 2-second blocks, that was 6 hours 35 minutes away, or about
`00:50 UTC` on 7 November.

| Event in Rally | Arkiv operation |
| --- | --- |
| Host approves a public plan | `createEntity` with the expiry above |
| Seats, status or coarse details change | `patchEntity`, which leaves expiry alone |
| The window moves later | `extendEntity` |
| Rally completes, is cancelled or expires | `deleteEntity`, skipped if the entity has already expired |
| Nothing happens | The entity expires by itself |

Arkiv cannot shorten an expiry. If a window moves earlier, the listing keeps its later expiry until
the Rally ends and the listing is deleted. Rally's preview also hides it once PostgreSQL says it has
expired.

## What is never published

The privacy boundary is one function, `toListing` in
[`arkiv-sync.ts`](../backend/src/services/arkiv-sync.ts). It takes only the coarse values above.

Never on Arkiv: names, wallets, user IDs, the activity's free-text goal, preferences, group members,
meeting points, messages and photos. Activities in the `wellness` and `support` categories are forced
private and never get an entity. A typed meeting area is stored as the private meeting point, and the
public `zone` stays `venue-nearby`.

Listing data is public and stays in chain history, so adding a field needs a privacy review.

## Queries you can run

No key is needed, but the keyless endpoint has a small shared budget. If you get a `429` with
`ANON_COST_LIMITED`, create a free key at <https://hub.arkiv.network/access-keys>.

All live Rally listings:

```bash
curl "https://rpc.rabdi.db-chain.testnet.arkiv.network/$ARKIV_ACCESS_KEY" \
  -H "content-type: application/json" \
  --data @- <<'EOF'
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "arkiv_query",
  "params": [
    "arkiv.schema = str('rally-mumbai.activity.v1') AND app = str('rally-mumbai') AND event = str('ethglobal-mumbai-2026') AND $owner = addr(0x0881ABfDB5FAE83F6d35FFc0A0C862f1BAD873a1)",
    { "select": { "key": true, "attributes": true, "owner": true, "expiresAt": true }, "limit": "0x64" }
  ]
}
EOF
```

To find open coffee plans, use this query string in the same request:

```text
arkiv.schema = str('rally-mumbai.activity.v1') AND category = str('coffee') AND status = str('open') AND $owner = addr(0x0881ABfDB5FAE83F6d35FFc0A0C862f1BAD873a1)
```

The same read through the SDK:

```ts
const { entities } = await client
  .select({ $key: true, opaqueId: true, category: true, startBucket: true, status: true })
  .from(listingSchema('rally-mumbai.activity.v1'))
  .ownedBy('0x0881ABfDB5FAE83F6d35FFc0A0C862f1BAD873a1')
  .where(and(eq('app', 'rally-mumbai'), eq('event', 'ethglobal-mumbai-2026')))
  .orderBy(asc('$key'))
  .limit(100)
  .fetch();
```

Results change as activities open and close. A count of zero means nothing is live at that moment.
