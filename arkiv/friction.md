# Arkiv feedback

Arkiv was good to build on. Written from building Rally on Rabdi with `@arkiv-network/sdk` 1.0.1.

## What worked well

- `defineSchema` with `.from(schema)` gave typed rows and caught wrong filters before sending.
- `ExpirationTime.atDate(date, { atLeast })` matched our needs exactly, including late syncs.
- `patchEntity` and `extendEntity` let one listing follow a plan as it changes, without republishing.
- The errors we hit were clear: the node's page size message, the SDK's "needs at least one filter"
  `InvalidPredicateError`, and its startup notice telling us to get an access key.
- With a key, single queries usually took under a second across our checks.

## The three things we would fix first

### 1. Publish the keyless rate limit

**Reproduced live on 6 November 2026.**

- **Expected:** a few read-only queries to work without a key, with the limit written down.
- **What happened:** we got `HTTP 429`, with a `Retry-After` starting at `980` seconds, about 16 minutes:

  ```text
  HTTP/2 429
  ratelimit: limit=10000, remaining=0, reset=769
  retry-after: 769
  {"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}
  ```

- **Reproduce:** run this until you see the `429`, then read the headers:

  ```bash
  curl -si https://rpc.rabdi.db-chain.testnet.arkiv.network \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'rally-mumbai.activity.v1'"'"')",{"select":{"count":true}}]}'
  ```

- **Ask:** add the budget, its window, how it is keyed and what a query costs to the
  [limits page](https://docs.arkiv.network/reference/limits/). If it is per IP, everyone at a venue behind
  one address shares it. The error message itself is good, and it told us what to do.

### 2. Make a rate limited query fail fast

**Long wait seen live. Cause reproduced locally against a mock server.**

- **Expected:** a query with `timeout: 2000` to fail within a few seconds, saying it was rate limited.
- **What happened:** against a local server that always returns `429` with `Retry-After: 7`, the SDK sent 4
  requests, 7 seconds apart, and threw a generic `HttpRequestError: HTTP request failed.` after 21 seconds.
  The timeout had no effect.
- **Reproduce:** point `createPublicClient` at such a server, using `http(url, { timeout: 2000 })`.
- **Workaround:** the retry comes from viem's `http` transport, and `retryCount: 0` avoids it. Our read client
  does this, and a test in `backend/test/arkiv.test.ts` covers it.
- **Ask:** throw a typed `RateLimitError` carrying the retry time, or recommend a transport configuration in
  the client setup guide.

### 3. Give writes on expired entities their own error

**From our code and the docs. Not rerun on the live network for this document.**

- **Expected:** deleting an expired entity to give a specific error we could treat as success.
- **What happened:** the [errors page](https://docs.arkiv.network/reference/errors/) does not say what
  patching or deleting a missing entity does.
- **Workaround:** `deleteListing` calls `getEntity` first and treats `NoEntityFoundError` as already gone.
- **Reproduce:** with a funded key, create an entity with a short expiry, wait for it to pass, then call
  `deleteEntity` and inspect the error.
- **Ask:** add a specific error, or a `reason` on `EntityMutationError`.
