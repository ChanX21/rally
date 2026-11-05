# Rally Backend: Development Instructions

Owner: Harshed (backend and Web3 infrastructure). Read `PRODUCT.md` for what Rally does and
`ARCHITECTURE.md` for how it works. The engineering playbook PDF in this folder is the source of
truth for requirements; it is git-ignored, so ask Harshed if it is missing.

## Hard rules

- Work only in `backend/` and `contracts/`. Never modify `frontend/` in any way.
- Do not commit or push unless Harshed explicitly asks in the current session. When asked, add no
  `Co-Authored-By: Claude` trailer.
- Never deploy a contract to a public network without explicit authorization.
- Never fabricate an integration result. If something could not be tested, say so.
- Keep `ARCHITECTURE.md` in step with the code in the same change.

## Product invariants

These come from the playbook. Do not trade them away for convenience.

1. A room results from mutual consent. Nobody is joined automatically.
2. AI composes, rules decide. A model never assigns seats, authorizes a join or writes to chain.
3. Zero fabricated users. Every AI-returned member must come from the shortlist sent to it.
4. PostgreSQL is the authority. Arkiv `openSeats` is an approximation and is never used for
   allocation.
5. Joining never blocks on chain confirmation. Arkiv writes happen after commit, via the outbox.
6. Rally works with zero contracts. On-chain rewards are optional and never control matching.
7. Never equate proposed, accepted, formed, met and completed.

## Stack

Node.js 22.12+, TypeScript (ESM, NodeNext), Fastify 5, Zod 4 via `fastify-type-provider-zod`,
PostgreSQL on Supabase, Drizzle ORM with the `postgres` driver, Vitest, ESLint, `viem`,
`@arkiv-network/sdk`, `@privy-io/node`. One service, no microservices, Kafka or vector DB.

`typescript` is pinned to `~6.0` because `typescript-eslint` does not support 6.1 or newer yet.

## Commands

```sh
npm run dev            # start with reload
npm run db:local       # local PostgreSQL on port 54329, no Docker
npm run db:generate    # generate a migration after changing src/db/schema
npm run db:migrate     # apply migrations
npm run arkiv:smoke    # real Arkiv read check; add -- --write with a funded key
npm run smoke:integrations   # real 0G call and Privy credential check
npm run smoke:journey  # full flow on live 0G and Arkiv, throwaway database, simulated login
npm run typecheck && npm run lint && npm test && npm run build   # run all before finishing
```

Tests start a throwaway real PostgreSQL. Set `TEST_DATABASE_URL` to use your own.

## Folder structure

```text
src/
  index.ts         process entry: configuration, listen, workers, shutdown
  app.ts           buildApp(): assembles plugins and routes, used by tests
  config/          environment validation
  db/              client, migration runner, schema
  domain/          pure rules: catalog, state machine, time, matching score
  integrations/    privy/, arkiv/, zerog/: one adapter per external service
  lib/             errors, logger, shutdown, idempotency, outbox helpers
  plugins/         error handler, security, auth, database, docs
  repositories/    database queries; take a db or transaction handle
  routes/          HTTP only: validate, authorize, call a service, shape a response
  schemas/         Zod request and response schemas
  services/        use cases and transaction boundaries
  workers/         outbox worker, handlers, scheduler
drizzle/           generated SQL migrations; never edit applied ones
test/              Vitest tests
```

Dependency direction: routes, workers -> services -> repositories, domain, integrations. Routes
never query the database. Domain code has no I/O.

## Coding conventions

- No `any`. Parse unknown data with Zod at the boundary rather than casting.
- Imports use a `.js` suffix and `import type` for types.
- Prefer plain functions taking explicit dependencies. Add an abstraction only for a second real
  use or an external service boundary.
- Comment the why, not the what.
- Do not leave placeholder implementations that look finished. If a feature is not built, it should
  not exist, and it should be listed under "Not implemented" in `ARCHITECTURE.md`.

## Naming

- Files: `kebab-case.ts`. Types: `PascalCase`. Functions and variables: `camelCase`.
- Database tables and columns: `snake_case`, plural tables.
- Domain language follows the playbook: `rally` (the brief's "activity"), `claim` (seat held),
  `offer` (one person's invitation), `match proposal` (a composed group).
- Outbox event types are dotted lowercase, for example `rally.published`.
- API error codes are `UPPER_SNAKE_CASE`.

## Database conventions

- Primary keys are `uuid` with `gen_random_uuid()`. Timestamps are `timestamptz`.
- Every table has `created_at`; mutable tables also have `updated_at`.
- Change the schema in `src/db/schema/index.ts`, then run `npm run db:generate`. Keep it in a single
  file because `drizzle-kit` struggles to resolve `.js` imports between schema files.
- Constrained values use PostgreSQL enums. Invariants that must survive bugs belong in the database
  as `CHECK` constraints and partial unique indexes.
- Any multi-write use case runs in one transaction. Lock order is always `users`, then `rallies`,
  then `offers`, to avoid deadlocks. Use `lockUser` and `lockRally`, which take `FOR NO KEY UPDATE`.
- Enable row level security in the migration for every new table. Supabase's Data API exposes the
  public schema otherwise. A test fails if you forget.
- Status changes go through `domain/rally-state.ts`. Never set `rallies.status` without it.
- No soft delete. Rows keep a lifecycle status instead, and audit evidence is kept.

## API conventions

- Paths follow the playbook with no version prefix. Commands mutate; queries read.
- Every route declares a Zod schema for its input and its 200 response.
- Success: `{ "success": true, "data": ... }`.
- Failure: `{ "success": false, "error": { code, message, details?, requestId } }`.
- Retryable commands accept an `Idempotency-Key` header; see `lib/idempotency.ts`.
- Lists use `limit` plus an opaque `cursor`, and return `nextCursor`.
- Status codes: 400 validation, 401 no valid session, 403 known but forbidden, 404 absent or not
  visible to you, 409 state conflict, 422 semantically invalid, 429 rate limited, 502 or 503 upstream.

## Authentication and authorization

- Clients send `Authorization: Bearer <Privy access token>`. The backend verifies it with
  `@privy-io/node`.
- Identity comes only from the verified token. Never accept a user ID or wallet address from a
  request body as identity. Wallets are read server-side from Privy.
- Use the `app.authenticate` pre-handler on every non-public route.
- Check ownership in the service, inside the transaction that uses the row. Return 404, not 403,
  when revealing that a rally exists would itself leak information.

## Error handling

- Throw `AppError` for expected failures; its code and message reach the client.
- Everything else becomes an opaque 500, with detail only in logs.
- Log errors under the `err` key so `serializeError` strips SQL parameters and row values.
- External calls need a timeout and a defined failure behaviour. See the failure table in
  `ARCHITECTURE.md`.

## Security

- Secrets exist only in environment variables, never in code, logs, responses or AI prompts.
- Do not log tokens, private keys, raw intent text, exact meeting points or user profiles.
- Treat user text as data, and all AI output as untrusted until validated.
- Only the fields in the Arkiv listing schema may leave for Arkiv. Adding a field needs a privacy
  review because Arkiv data is public and survives in chain history.

## Testing

- Use real PostgreSQL for anything touching the database, and fake only external services.
- Each file that needs a database uses `createTestDatabase()`.
- Race conditions need real concurrent requests, not sequential simulation.
- Cover authorization failures as well as success paths.

## Environment variables

- Add new variables to `config/env.ts`, `.env.example` and the reference in `ARCHITECTURE.md`.
- Optional integrations must leave the server bootable when unset, and must degrade as documented.
- Validation errors name variables and never print values.

## Arkiv guidelines

- SDK: `@arkiv-network/sdk`. Network: Rabdi testnet, through `rabdi({ accessKey })`.
- All access goes through `integrations/arkiv/`. Services use the `ArkivGateway` interface.
- One relayer wallet owns every entity. Users have no Arkiv wallet.
- The wallet key (`ARKIV_PRIVATE_KEY`) is secret and is separate from the RPC access key
  (`ARKIV_ACCESS_KEY`).
- Filter reads with `.ownedBy(relayer)`, because anyone can write entities using our schema name.
- Use the SDK query builder. It is not SQL.
- There is no `updateEntity`: use `patchEntity`. A patch never changes expiry. Use `extendEntity`,
  which can only move expiry later.
- Arkiv emits no event on expiry, so reconcile from PostgreSQL.
- Do not hardcode limits told to us informally. Make them configuration, and record what is verified
  in `ARCHITECTURE.md`.
- Writes run one at a time from the worker to keep relayer nonces in order.

## 0G guidelines

- Use the 0G Compute Router, which is OpenAI-compatible, through `integrations/zerog/`.
- Every call goes through the harness: route, infer, validate, execute, measure.
- Record `x_0g_trace.request_id`, model, provider, prompt version, latency, tokens and validator
  outcome in `model_runs`.
- Send pseudonymous candidates only. Never send names, wallets, DIDs or exact locations.
- AI failure must never block the flow. Fall back deterministically and never invent matches.
- Never claim private or verified inference unless `tee_verified` was actually returned as true.
- Do not send `response_format`: the live Router fails with it. See `ARCHITECTURE.md`.
- Budget: new profile 1 call, new activity 1 call, matched case 1 call, decline 0 to 1 call.

## Contracts

- Rally's MVP needs no contract. See `contracts/README.md` for the optional rewards claim.
- The backend only signs claim vouchers, behind `REWARDS_CLAIMS_ENABLED`, and never holds user funds.
- The voucher format in `services/reward-voucher.ts` must stay in step with the contract's EIP-712
  type. Change both together and run both test suites.
