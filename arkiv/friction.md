# Arkiv feedback

Written from building Rally on Rabdi with `@arkiv-network/sdk` 1.0.1. Each item says whether we
reproduced it on the live network, reproduced it locally, or read it in the docs or our code.

## What to improve first

1. Publish the anonymous rate limit, and explain what spends it.
2. Make rate limiting a fast, typed SDK error, instead of a silent wait.
3. Give writes on missing or expired entities their own error.
4. Add a way to learn that an entity expired.
5. Let a schema name be tied to an owner.

## When something broke

### 1. The keyless endpoint locked us out for about 16 minutes

**Reproduced live on 6 November 2026.**

- **Expected:** a few read-only queries for a docs check to work, since the docs say the public RPC is
  available without a key. We expected the limit to be written down.
- **What happened:** we got `HTTP 429`, with a `Retry-After` starting at `980` seconds:

  ```text
  HTTP/2 429
  ratelimit: limit=10000, remaining=0, reset=769
  retry-after: 769
  {"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}
  ```

- **What puzzled us:** we can account for only a few of our own requests. With a key, the same query
  costs 10 units (`Arkiv-Cost: 10`), so a budget of 10,000 should allow about 1,000 of them. We cannot
  tell whether the budget is shared per IP, costs more without a key, or something else. If it is per
  IP, everyone at a venue behind one address would share it.
- **Reproduce:** run `arkiv_query` without a key until you see the `429`, then read the headers:

  ```bash
  curl -si https://rpc.rabdi.db-chain.testnet.arkiv.network \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'rally-mumbai.activity.v1'"'"')",{"select":{"count":true}}]}'
  ```

- **Why it matters:** the [limits page](https://docs.arkiv.network/reference/limits/) does not mention
  this budget, and this is the first thing a hackathon team or judge will hit. The error message is good,
  and it told us what to do.
- **Ask:** document the budget, the window, how it is keyed and what a query costs. Consider a shorter
  penalty for anonymous reads.

### 2. A rate limited SDK query waits silently, and ignores its timeout

**Long wait seen live. Cause reproduced locally against a mock server.**

- **Expected:** a query with `timeout: 2000` to fail within a few seconds, with an error saying it was
  rate limited.
- **What happened:** a keyless script printed nothing for more than three minutes, until we killed it.
  We then pointed the SDK at a local server that always returns `429` with `Retry-After: 7`. It sent 4
  requests, 7 seconds apart, and threw a generic `HttpRequestError: HTTP request failed.` after 21 seconds.
  The 2-second timeout had no effect on this.
- **Scale:** with the real `Retry-After` of 980 seconds and the same default retries, a query could wait
  about 49 minutes. We infer this, and did not wait to watch it. We also did not prove that the live hang
  was this exact path.
- **Reproduce:**

  ```js
  import { createServer } from 'node:http';
  import { createPublicClient } from '@arkiv-network/sdk';
  import { rabdi } from '@arkiv-network/sdk/chains';
  import { eq } from '@arkiv-network/sdk/query';
  import { http } from 'viem';

  const hits = [];
  const server = createServer((req, res) => {
    hits.push(Date.now());
    req.resume();
    req.on('end', () => {
      res.writeHead(429, { 'retry-after': '7' });
      res.end('Too Many Requests');
    });
  });
  await new Promise((ok) => server.listen(0, ok));

  const client = createPublicClient({
    chain: rabdi({ accessKey: '' }),
    transport: http(`http://127.0.0.1:${server.address().port}`, { timeout: 2000 }),
  });
  const start = Date.now();
  await client.select({ $key: true }).where(eq('app', 'x')).limit(1).fetch()
    .catch((e) => console.log(Date.now() - start, 'ms', e.name, e.shortMessage));
  console.log(hits.length, 'requests');
  process.exit(0);
  ```

- **In fairness:** the retry comes from viem's `http` transport, which the Arkiv docs and our code use.
  Setting `retryCount: 0` avoids it.
- **Why it matters to us:** with default retries, a rate limited Arkiv could hold a Discover request
  open rather than quickly showing the "temporarily unavailable" notice. Our read client now sets
  `retryCount: 0`, and a test in `backend/test/arkiv.test.ts` covers it. That also removes retries for
  brief network errors, which is why a built-in cap on the wait would be better. Our write client still
  uses the defaults.
- **Ask:** throw a typed `RateLimitError` carrying the retry time. Otherwise, document a recommended
  transport configuration in the client setup guide.

### 3. We could not tell "already expired" from any other failed delete

**From our code and the docs. Not rerun on the live network for this document.**

- **Expected:** deleting an expired entity to give a specific error we could treat as success.
- **What happened:** the [errors page](https://docs.arkiv.network/reference/errors/) describes write
  failures as `EntityMutationError`, with not being the owner and having no tGLM as its examples. It does
  not say what patching or deleting a missing entity does. `NoEntityFoundError` is listed for reads only.
- **Workaround:** `deleteListing` calls `getEntity` first and treats `NoEntityFoundError` as already
  gone. That costs an extra request, and the entity can still expire between the two calls.
- **Reproduce:** with a funded key, create an entity with a short expiry, wait for it to pass, then call
  `deleteEntity` and inspect the error.
- **Ask:** add a specific error, or a `reason` on `EntityMutationError`.

### 4. A wrong attribute name returns an empty result

**Reproduced live.**

- **Expected:** a warning or an error for a filter on an attribute that no entity has.
- **What happened:** `arkiv.schema = str('rally-mumbai.activity.v1') AND nope = str('x')` returned
  `{"data": []}`. A typo looks exactly like "nothing is live".
- **In fairness:** this follows from schemaless storage, and the SDK's `.from(schema)` catches it before
  sending. It catches people using raw JSON-RPC.
- **Ask:** mention this on the JSON-RPC page.

## What got in our way

### Expiry has no event

The docs confirm: "Arkiv emits no event when an entity expires." `onEntityDeleted` and
`onExpiryExtended` exist, but nothing fires on expiry. We run a reconciler against PostgreSQL to catch up.
An `onEntityExpired` event, or a way to query recently expired keys for an owner, would remove it.

### Anyone can write under our schema name

Schema names are public, so every read needs `.ownedBy(relayer)`, and forgetting it means showing
strangers' data. We found no other wallet under our schema name in the first 100 rows, but nothing
prevents one. Ask: let a schema be tied to an owner, or have `.from(schema)` warn when no owner or creator
filter is present.

### Retrying a create safely takes extra work

A crash between a chain write and our database commit leaves a live entity whose key we did not save.
We query by `opaqueId` before each create and adopt any match. A caller-chosen salt might give a
predictable key and remove this step. The docs mention `SaltInput`, `InvalidSaltError` and `NO_SALT`, but
the [create page](https://docs.arkiv.network/writing/create/) does not explain custom salts or what
happens when one is reused. We have not tried one. Ask: document this as the idempotent create pattern.

### One wallet writes one transaction at a time

A single relayer means nonces must stay in order, so we hold a PostgreSQL advisory lock around every
write. Writes took about 6 seconds in our earlier live checks. Ask: a short guide for the shared relayer
pattern, since any app with users who have no wallets will arrive at it. We have not adopted
[batches](https://docs.arkiv.network/writing/batches/) yet, so they may ease part of this.

### Expiry is written by date but read by block

`ExpirationTime.atDate()` is pleasant to write with, but `$expiresAt` reads back as a block number
(`0x4c84b`). Showing "ends in 2 hours" means calling `getBlockTiming` and doing the arithmetic. We found
no read-side helper in the SDK. Ask: a helper that converts a block to an estimated date.

### Limits we could not confirm

| Topic | What we were told informally | What we found |
| --- | --- | --- |
| Page size | 40 | Docs say 100. The node accepted 100 and rejected 101: `limit 101 exceeds the node maximum of 100` |
| Wallet storage | About 40 pages per user | Not on the limits page |
| Query length and nesting | | The limits page says limits exist but gives no numbers |
| Keyless rate limit | | Not on the limits page; see item 1 |

We default to 40 per page, in case the informal figure reflects something we cannot see.

## What worked well

- `defineSchema` with `.from(schema)` gave typed rows and caught wrong filters before sending.
- `ExpirationTime.atDate(date, { atLeast })` matched our needs exactly, including late syncs.
- The errors we did hit were clear: the node's page size message, the SDK's "needs at least one filter"
  `InvalidPredicateError`, and its startup notice telling us to get an access key.
- With a key, single queries took 246 to 591 ms.
