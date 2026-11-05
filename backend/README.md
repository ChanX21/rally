# Rally Backend

Rally API service: Node.js, TypeScript, Fastify, PostgreSQL (Supabase), Drizzle ORM and Zod.

Status: foundation only. The server boots, validates configuration, connects to PostgreSQL and
runs migrations. Product routes and tables are not implemented yet.

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
- `DATABASE_MIGRATION_URL`: direct or session pooler, port 5432, with `?sslmode=require`.

Prepared statements are disabled because the transaction pooler does not support them.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start with reload and readable logs |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check source, tests and scripts |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests (see below) |
| `npm run db:local` | Run local PostgreSQL on port 54329, with data in `.local/postgres` |
| `npm run db:generate` | Generate a migration from `src/db/schema` |
| `npm run db:migrate` | Apply migrations (development) |
| `npm run db:migrate:prod` | Apply migrations from `dist/` (needs `drizzle/` alongside it) |
| `npm run db:studio` | Open Drizzle Studio |

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

## Layout

```text
src/
  index.ts        entry point: configuration, listen, graceful shutdown
  app.ts          buildApp(): assembles plugins and routes, used by tests too
  config/         environment validation
  db/             client, migration runner, schema/
  lib/            errors, logging, shutdown
  plugins/        error handler, security (helmet, CORS, rate limit), database
  routes/         HTTP routes
  schemas/        shared Zod schemas and response envelope
  services/       domain logic (empty)
  repositories/   database queries (empty)
  workers/        outbox and background jobs (empty)
  integrations/   Privy, Arkiv, 0G adapters (empty)
drizzle/          generated SQL migrations
scripts/          developer tooling
test/             Vitest tests
```

See `.env.example` for all configuration.
