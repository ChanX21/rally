# How Rally uses Arkiv

Every Rally that is open to the public gets one listing on Arkiv. The public Discover screen,
<https://www.therally.xyz/app/discover>, is built from a query for those listings. The field list,
expiry rules and runnable queries are in [`schema.md`](schema.md).

## The read and write paths

```text
Write  Host approves plan -> PostgreSQL commit -> outbox job -> relayer writes to Arkiv
Read   Discover -> GET /activities/preview -> Arkiv query -> checked against PostgreSQL -> cards and map
```

Writes happen after the database commit, so a slow or failed chain write never blocks someone joining.
A retry reads current PostgreSQL state and converges instead of replaying an old snapshot. A reconciler
repairs any listing that drifts.

## Do the filters fit what the app does?

| Query part | Why it is there | Fit |
| --- | --- | --- |
| `$owner` | Anyone can write under our schema name, so this is what makes a listing trustworthy | Strong: a test confirms another writer's listing never appears |
| `app`, `event` | A board for one event must show that event only | Strong: smoke tests write to a separate event and stay out of the live board |
| `$key` with `ORDER BY` | Key cursors do not repeat or skip rows during writes the way offsets can | Strong: this drives Discover's "show more" |
| `opaqueId` | After a crash between a chain write and our commit, a retry finds the listing and adopts it, rather than publishing a duplicate | Strong |
| `category`, `zone` | People ask "any coffee on my floor?" | Strong: Discover's two dropdowns send these straight into the Arkiv query |
| `startBucket` | Browsing by hour | Partial: `GET /activities/preview` accepts it, but Discover has no time control yet |
| `neededRole`, `openSeats`, `status` | Let another app ask for "open plans needing a builder" | Unused by Rally: nothing in the product queries these |

## Who can edit, and does that fit?

One relayer owns every listing. This fits a public board where a person's wallet must not be tied to
their plans, because a per-user owner would publish exactly that link on a permanent chain history. It
also means people do not need gas or a wallet prompt to publish.

The cost is that readers trust a single writer. Rally can write a wrong listing, and a listing cannot
be edited by the person who made the plan except through Rally.

## Does the expiry fit?

A listing expires when its activity's time window ends. Plans last hours or days, and a stale plan
is worse than none, so the data lifetime matches how long the data is useful.

The one hour minimum is a safeguard for late syncs. Completed and cancelled Rallies are deleted rather
than left to expire, so they leave the board at once.

## Does each feature change something users see?

| Arkiv feature | What users see | Honest limit |
| --- | --- | --- |
| Create | A new card and map dot appear on Discover | |
| Query with owner and event filters | The contents of the public board, without signing in | |
| `category` attribute | The card's headline, such as a coffee phrase, and the activity filter | The map's speech bubble is separate AI text from PostgreSQL |
| `startBucket` attribute | The time label on the card | |
| `neededRole`, `minGroupSize` attributes | "Participant wanted. Happens with 3 or more people." on an open card | |
| Key pagination | "Show more" loads the next page | Needs more than 20 live listings to appear |
| Delete | A finished or cancelled Rally leaves the board | Rally also hides these using PostgreSQL |
| Expiry | A plan whose time has passed leaves the board, even if our worker is down | Rally's preview hides it from PostgreSQL first, so inside the app the difference is invisible. It matters to direct Arkiv readers |
| Patch of `status`, `openSeats` | Direct Arkiv readers see current state | Rally's own cards take these from PostgreSQL, not from the listing |
| `zone` attribute | The area on each card, such as "Venue, floor 1", and the area filter | Map dot positions are still illustrative, and do not use it |

One gap remains: `neededRole`, `openSeats` and `status` are indexed for other readers, and Rally never
filters on them.

## Failure behaviour

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

Read from the live network on 6 November 2026, at about 18:15 UTC:

| Measure | Value |
| --- | --- |
| Live listings owned by the relayer | 9 |
| Rally's public API returned | 9, all 9 found on Arkiv |
| Listing status | 5 `open`, 4 `filling` |
| Other wallets found under our schema name | 0 in the first 100 rows |
| Transactions sent by the relayer | 135 |
| Relayer balance | 9.986 tGLM |
| Single query latency, with a key | 246 to 591 ms |
| Cost per listing or count query | 10 quota units, from the `Arkiv-Cost` header |

The transaction count includes smoke tests and is not a count of Rallies.
