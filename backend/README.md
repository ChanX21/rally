# Rally Backend

Rally API service: Node.js, TypeScript, Fastify, PostgreSQL (Supabase), Drizzle ORM and Zod.

See `PRODUCT.md` for what Rally does, `ARCHITECTURE.md` for how it works and what has been verified,
and `CLAUDE.md` for development rules. API docs are served at `/docs` while the server runs.

Privy, 0G and Arkiv are optional locally. Without Privy credentials, authenticated routes return 503.
Without 0G, deterministic fallbacks run. Without Arkiv, public discovery shows a notice.

## Local setup

Requires Node.js 22.12 or newer.

```sh
npm install
cp .env.example .env

# Terminal 1: PostgreSQL. No Docker needed. Skip this if DATABASE_URL points at Supabase.
npm run db:local

# Terminal 2
npm run db:migrate
npm run dev
```

Check it:

```sh
curl localhost:3000/health        # process is up
curl localhost:3000/health/ready  # process is up and PostgreSQL responds
```

### Using Supabase

Set both URLs in `.env`, taken from the Supabase dashboard (Connect):

- `DATABASE_URL`: transaction pooler, port 6543, with `?sslmode=require`.
- `DATABASE_MIGRATION_URL`: session pooler, port 5432, with `?sslmode=require`.

Use the pooler hosts (`*.pooler.supabase.com`). The direct `db.<ref>.supabase.co` host is IPv6-only and
fails with `ENETUNREACH` on networks without IPv6.

Prepared statements are disabled because the transaction pooler does not support them.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start with reload and readable logs |
| `npm run build` | Compile to `dist/` |
| `npm start` | Apply pending migrations, then run the compiled server |
| `npm run typecheck` | Type-check source, tests and scripts |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests (see below) |
| `npm run db:local` | Run local PostgreSQL on port 54329, with data in `.local/postgres` |
| `npm run db:generate` | Generate a migration from `src/db/schema` |
| `npm run db:migrate` | Apply migrations (development) |
| `npm run db:migrate:prod` | Apply migrations from `dist/` (needs `drizzle/` alongside it) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run arkiv:smoke` | Check Arkiv on the real network; add `-- --write` with a funded key |
| `npm run smoke:privy` | Real Privy credential check |
| `npm run smoke:journey` | Whole flow on live 0G and Arkiv, throwaway database, simulated login |
| `npm run ai:vision:probe` | Paid 0G image capability tests with public sample photos; no users, rewards or production configuration changes |

## Render deployment

Use `backend` as the service root, `npm ci && npm run build` as the build command, and
`npm start` as the start command. Keep `drizzle/` alongside `dist/`. The `prestart` lifecycle
runs `db:migrate:prod` against `DATABASE_MIGRATION_URL` (or `DATABASE_URL`) before serving requests;
a failed migration prevents startup. Starting `node dist/index.js` directly skips this step.
For multiple instances or concurrent deployments, run migrations once in a serialized deployment
step before starting the servers.

## Tests

`npm test` starts a throwaway PostgreSQL automatically. To use your own database, set
`TEST_DATABASE_URL`.

## API conventions

Success:

```json
{ "success": true, "data": {} }
```

Failure:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [], "requestId": "..." }
}
```

Every response carries an `x-request-id` header. Quote it when reporting a problem; it matches
`reqId` in the logs.

Clients must call `POST /auth/session` once after login, before other authenticated routes.

## Layout

```text
src/
  index.ts        entry point: configuration, listen, graceful shutdown
  app.ts          buildApp(): assembles plugins and routes, used by tests too
  config/         environment validation
  db/             client, migration runner, schema/
  domain/         pure rules: catalog, state machine, scoring, intent fallback
  integrations/   Privy, Arkiv, 0G adapters
  lib/            errors, logging, shutdown, outbox, idempotency, pagination
  plugins/        error handler, security, database, integrations, auth, docs
  repositories/   database queries
  routes/         HTTP routes
  schemas/        Zod request and response schemas
  services/       use cases and transactions
  workers/        outbox worker, handlers, scheduler
drizzle/          generated SQL migrations
scripts/          developer tooling
test/             Vitest tests
```

See `.env.example` for all configuration.

## AI Formation Engine

Onboarding questions, activity parsing and group composition all run through the Formation Engine. See
[AI.md](AI.md) for its contract, and `ARCHITECTURE.md` for how routes use it. Run `npm run test:ai` for
isolated AI tests; `npm run ai:smoke` and `npm run ai:demo` check funded 0G access.
