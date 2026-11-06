<p align="center">
  <img src="frontend/public/logo/rally-blue-coral-on-cream.svg" alt="Rally" width="280" />
</p>

<h1 align="center">Rally</h1>

<p align="center">
  <strong>Less time finding people. More time doing things.</strong>
</p>

<p align="center">
  Turn “anyone up for this?” into a real plan with the right people.<br />
  AI-assisted matching, mutual consent, a shared rally point, and visible 0G request receipts.
</p>

<p align="center">
  <a href="https://www.therally.xyz">Live application</a> ·
  <a href="https://www.therally.xyz/app/discover">Browse live rallies</a> ·
  <a href="https://rally-6ncc.onrender.com/health/ready">API readiness</a> ·
  <a href="#quick-start">Run locally</a> ·
  <a href="#api">API reference</a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white" />
  <img alt="0G Compute" src="https://img.shields.io/badge/AI-0G_Compute-7057FF" />
  <img alt="Arkiv" src="https://img.shields.io/badge/Discovery-Arkiv-F06445" />
  <img alt="Arc Testnet" src="https://img.shields.io/badge/Network-Arc_Testnet-315FE8" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" />
</p>

<p align="center">
  <img src="docs/images/home.png" alt="Rally home screen with an entry to create a Rally" width="310" />
  &nbsp;&nbsp;
  <img src="docs/images/discover.png" alt="Rally discovery screen with live activities and an illustrative venue map" width="310" />
</p>

## Why Rally?

At a busy event, finding someone for coffee, a pitch rehearsal, a workshop, or a game can take
longer than the activity itself. Rally turns those small intentions into groups that can actually meet.

1. **Tell Rally about yourself.** Choose three interests to guide up to three onboarding questions.
2. **Make a plan.** Describe an activity; AI asks only the missing details needed to match it.
3. **Find compatible people.** Saved preferences are compared with active Rallies, across interest categories.
4. **Agree to join.** Candidates receive inbox invitations and choose whether to accept.
5. **Meet at your rally point.** Once the group forms and the host sets the meeting point, the room unlocks.
6. **Finish and follow up.** Formed Rallies complete automatically; photos and vouches are optional.

The first pilot is built around ETHGlobal Mumbai. Public browsing is available before sign-in;
joining always goes through matching and consent.

## Features

- **Natural-language Rally creation:** activity-specific follow-up questions, editable confirmation,
  and a default group of two people including the host.
- **Preferences beyond presets:** suggested choices, custom answers, and editable personal matching notes.
  The three onboarding interests guide questions; they do not restrict who can match.
- **Background matchmaking:** new Rallies, onboarding, preference and availability changes trigger
  evaluation. A two-minute sweep rechecks active Rallies with open seats.
- **Consent before membership:** invitations do not reserve seats. Acceptance rechecks eligibility
  and allocates a real seat atomically.
- **Live discovery:** anonymous activity cards and an illustrative venue map. Each displayed dot
  represents a real open Rally and takes a turn showing its own AI-generated invitation.
- **A shared rally point:** meeting details and the confirmed group become available after formation.
- **Automatic completion:** formed photo-flow Rallies finish at the meeting time plus duration plus
  a 1-minute grace period. The completion scheduler normally checks every 30 seconds.
- **Optional group photo rewards:** one accepted submission earns 10 RALLY per confirmed member
  under the default policy. Photos can be submitted for 48 hours after completion.
- **Visible AI receipts:** real 0G provider request IDs appear near the bottom of the relevant screens,
  with task labels and failure outcomes where applicable.
- **Responsive PWA:** mobile-first screens, wallet sign-in through Privy, and an inbox for invitations
  and activity updates.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS | Onboarding, creation, discovery, invitations, rally points, photos, and profiles |
| Authentication | Privy | Wallet sign-in and verified API sessions |
| API | Node.js, Fastify, Zod | Authorization, validation, activity lifecycle, matching, and rewards |
| AI | 0G Compute Router | Question selection, intent parsing, group composition, map dialogue, and photo assessment |
| Data | PostgreSQL / Supabase, Drizzle ORM | Profiles, preferences, Rallies, claims, offers, traces, and reward records |
| Discovery | Arkiv | Public, expiring activity listings, checked against PostgreSQL before display |
| Workers | Transactional outbox and scheduler | Matching sweeps, retries, expiry, completion, and integration writes |
| Contracts | Solidity, Foundry, Arc Testnet | Optional non-transferable points and public reward history |

```mermaid
flowchart TD
    Web[Next.js PWA] --> Auth[Privy sign-in]
    Web --> API[Fastify API]
    Auth --> API
    API --> DB[(PostgreSQL: source of truth)]
    API --> AI[0G Formation Engine]
    DB --> Jobs[Outbox worker and scheduler]
    Jobs --> AI
    Jobs --> Arkiv[Arkiv activity index]
    Jobs --> Arc[Optional Arc Testnet reward records]
    Arkiv --> Preview[Public preview, confirmed against PostgreSQL]
    Preview --> Web
    AI --> Receipts[Provider request IDs and model-run metadata]
    Receipts --> DB
```

### How matching works

SQL first checks active opt-in, availability for the full activity, explicit waiting-plan constraints,
blocks, existing offers or claims, and overlapping commitments. Eligible people enter a bounded,
pseudonymous shortlist. AI compares the Rally's goal and preferences with the candidates' saved
preferences, including relevant notes stored under other activity categories.

The server validates the proposed group before issuing invitations. Every acceptance rechecks
current preferences, schedule, blocks, and capacity under database locks. AI cannot invent members,
assign seats directly, or authorize rewards.

An unchanged `no_fit` reuses its cached result, so the two-minute sweep does not repeatedly pay for
identical inference. If AI is unavailable, the default configuration allows a deterministic fallback
that cannot interpret free-text preferences. Set `AI_REQUIRED=true` to retry through outages instead.

### 0G request receipts

Rally uses the 0G Router's `x_0g_trace.request_id`, falling back to the provider response ID when
available. It records model, outcome, latency, tokens, and provider cost when returned.

- Onboarding and creation display the IDs returned by their AI calls.
- Matching, room, and feedback screens load the Rally's authorized request history, including
  attributable no-fit and photo-check calls.
- Public discovery shows only the receipt for each public map dialogue.
- Missing IDs are not replaced with internal trace UUIDs. Historical unlinked calls cannot be
  attributed retroactively; old map caches regenerate once to obtain linked receipts.

See [`backend/AI.md`](backend/AI.md) and the [frontend handoff](backend/FRONTEND_HANDOFF.md).

### Arkiv and Arc

**Arkiv** indexes coarse activity details: category, zone, time bucket, group size, and approximate
open seats. Personal preferences, identities, exact meeting points, and photos are excluded.
PostgreSQL remains authoritative for visibility and seat allocation. See [Data on Arkiv](#data-on-arkiv).

**Arc Testnet** is optional. `RallyLedger` records point changes and `RallyToken` represents
non-transferable RALLY points. The current nine-action deployment includes group-completion rewards,
which mint once `ARC_LEDGER_ENABLED` and `ARC_COMPLETION_REWARDS_ENABLED` are both on. See the
[contract addresses and deployment notes](contracts/README.md).

RALLY points are not a cash payout. `RewardClaim` is not part of the active application flow.

## Data on Arkiv

Rally publishes one public, expiring listing for each Rally open to discovery. The
[Discover screen](https://www.therally.xyz/app/discover) reads those listings on the Rabdi testnet.

**Wallet that wrote the entities:**
[`0x0881ABfDB5FAE83F6d35FFc0A0C862f1BAD873a1`](https://rabdi.explorer.arkiv.network/address/0x0881ABfDB5FAE83F6d35FFc0A0C862f1BAD873a1)

**A query you can run** returns every live Rally listing:

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

A key is optional, but the keyless endpoint has a small shared budget. If you get a `429`, create a
free key at [hub.arkiv.network/access-keys](https://hub.arkiv.network/access-keys).

| Document | Answers |
| --- | --- |
| [Schema](arkiv/schema.md) | Entities, queried fields, owners, expiry |
| [How we use Arkiv](arkiv/how-you-use-arkiv.md) | Whether filters, ownership and expiry fit, and what users see from each feature |
| [Why Arkiv](arkiv/why-arkiv.md) | What users would lose with Postgres alone, and what stays off Arkiv |
| [Reach](arkiv/reach.md) | Who Rally is for, and how to try it today |
| [Feedback](arkiv/friction.md) | What got in our way, with reproduction steps |

## Repository

```text
.
├── arkiv/             Arkiv schema, usage, reach and feedback documents
├── frontend/          Next.js PWA and API client
├── backend/           Fastify API, Formation Engine, integrations, and workers
│   ├── drizzle/       Database migrations
│   ├── src/           Application code
│   ├── test/          Unit and integration tests
│   └── evidence/      Recorded live-integration and local-chain checks
├── contracts/         Solidity contracts, deployment scripts, and Foundry tests
└── docs/images/       Public application screenshots
```

## Quick Start

### Prerequisites

- Node.js **22.12+** and npm.
- PostgreSQL: the bundled local runner below, or a Supabase project.
- A Privy app for authenticated flows; use the same app ID in frontend and backend.
- A 0G API key for real inference. Arkiv credentials are needed for live public discovery.
- Foundry only if working on the optional contracts.

Commands below run from the repository root unless stated otherwise. There is no root package install.

### 1. Install and configure

```bash
git clone https://github.com/ChanX21/rally.git
cd rally

cd backend
npm ci
cp .env.example .env

cd ../frontend
npm ci
cp .env.example .env.local
```

Set these values before starting the app; using different ports avoids a frontend/API collision:

```env
# backend/.env
PORT=4000
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/rally
CORS_ORIGINS=http://localhost:3000
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret

# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
```

### 2. Start PostgreSQL

In a separate terminal:

```bash
cd backend
npm run db:local
```

This starts PostgreSQL on loopback port `54329`, creates the `rally` database on first run, and keeps
data in `backend/.local/postgres`. Leave it running. Skip this step when using Supabase.

### 3. Start the API

```bash
cd backend
npm run db:migrate
npm run dev
```

The configured API is available at `http://localhost:4000`, with interactive docs at `/docs`.

### 4. Start the frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`. Add that origin to Privy's allowed origins and the backend's
`CORS_ORIGINS`. Never put the Privy app secret or integration private keys in frontend variables.

## Configuration

The complete configuration lives in [`backend/.env.example`](backend/.env.example) and
[`frontend/.env.example`](frontend/.env.example).

| Backend setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL connection |
| `DATABASE_MIGRATION_URL` | Optional migration connection; with Supabase use the session pooler |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Authenticate Privy sessions |
| `ZERO_G_API_KEY`, `ZERO_G_MODEL` | 0G text inference; example model: `qwen3.7-flash` |
| `ZERO_G_VISION_MODEL` | Photo assessment; example model: `gemini-2.5-flash-lite` |
| `AI_REQUIRED` | Retry matching during AI outages rather than using deterministic composition |
| `ARKIV_PRIVATE_KEY`, `ARKIV_ACCESS_KEY` | Publish and query live activity listings |
| `WORKERS_ENABLED` | Enable outbox delivery, the two-minute matching sweep, and lifecycle jobs |
| `PROOFS_ENABLED` | New Rallies use automatic completion and optional photo rewards |
| `ARC_LEDGER_ENABLED` | Enable configured Arc reward-history writes |
| `ARC_COMPLETION_REWARDS_ENABLED` | Enable completion writes only with a compatible nine-action ledger |

For Supabase, use the transaction pooler for runtime traffic and the session pooler for migrations.
Keep credentials server-side. Locally, missing Privy credentials make authenticated routes unavailable;
missing Arkiv configuration leaves discovery unavailable; missing 0G configuration uses supported
fallbacks without pretending a provider call occurred.

## API

Production base: `https://rally-6ncc.onrender.com` · [Interactive API docs](https://rally-6ncc.onrender.com/docs)

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health`, `/health/ready` | Process health and database readiness |
| `GET` | `/activities/preview` | Anonymous, coarse activity discovery |
| `POST` | `/auth/session` | Verify sign-in and establish the application user |
| `GET` | `/me` | Current user and latest profile |
| `PATCH` | `/me/profile` | Update preferences, availability, or matching opt-in |
| `POST` | `/onboarding/questions` | Select up to three onboarding questions |
| `POST` | `/onboarding/complete` | Save onboarding and start opted-in matching |
| `POST` | `/intents/parse` | Parse an activity and return missing-detail questions |
| `POST` | `/intents/:id/answers` | Apply clarification answers |
| `GET`, `POST` | `/rallies` | List accessible Rallies or create one |
| `GET`, `PATCH` | `/rallies/:id` | Read or update an authorized Rally |
| `GET` | `/matches` | Inbox invitations and active waiting intents |
| `POST` | `/matches/:id/respond` | Accept or decline an invitation |
| `GET` | `/rallies/:id/room` | Confirmed group and shared meeting details |
| `GET`, `POST` | `/rallies/:id/proof` | Read photo-check status or submit group photos |
| `POST` | `/rallies/:id/feedback` | Optional feedback and vouches |
| `GET` | `/rallies/:id/ai-receipts` | Authorized 0G provider request history |

Authenticated routes use `Authorization: Bearer <Privy access token>`. Call `/auth/session` after
sign-in before other authenticated routes. Creation and photo submission use idempotency keys.
API error `requestId` values are debugging references, separate from 0G provider receipts.

## Privacy and Trust

- Public discovery contains anonymous, coarse activity information. Map positions are illustrative.
- Exact meeting details require authorized room access; invitations never silently add members.
- Matching uses aliases and redacted preferences at the model boundary.
- Photos are processed privately for assessment, never published to Arkiv or a blockchain, and
  scheduled for deletion after 30 days. At most three submissions are allowed per Rally.
- Visual assessment supports activity evidence; it does not independently establish identities,
  capture time, or attendance of every account in the confirmed roster.
- Rewards, membership, and capacity are enforced by server rules and database transactions.

See [`backend/ARCHITECTURE.md`](backend/ARCHITECTURE.md) for failure behavior, retention, and integration limits.

## Verification

```bash
# Backend: tests use throwaway PostgreSQL databases automatically.
cd backend
npm run typecheck
npm run lint
npm test
npm run build

# Frontend
cd ../frontend
npx tsc --noEmit
npm run lint
npm run build

# Optional contracts
cd ../contracts
forge soldeer install
forge build
forge test
```

Live AI checks spend inference credits and require configured credentials. Recorded checks clearly
separate real inference, synthetic users, local-chain tests, and public deployments:

| Evidence | Scope |
| --- | --- |
| [Personalized preferences](backend/evidence/personalization-live-2026-11-06.json) | Recorded live 0G personalization checks |
| [Map dialogue](backend/evidence/map-dialogue-live-2026-11-06.json) | A real 0G title-to-dialogue request |
| [Group photo flow](backend/evidence/proof-full-flow-live-2026-11-06.json) | Real 0G vision, a public fixture, synthetic group, isolated database |
| [Completion rewards contract](backend/evidence/arc-proof-local-2026-11-06.json) | Local Anvil check of the nine-action contract, made before its [Arc Testnet deployment](contracts/README.md#deployments) |

## Deployment

The live web app is served at **therally.xyz**, the API runs on **Render**, and PostgreSQL is hosted
on **Supabase**. See the [backend deployment guide](backend/README.md#render-deployment).

- **Frontend:** install and build from `frontend/`; set the public API URL and matching Privy app ID.
- **API:** use `backend/` as the service root, `npm ci && npm run build` to build, and `npm start` to
  migrate and start. Retain `drizzle/` alongside `dist/`; serialize migrations for multiple instances.
- **Workers:** keep `WORKERS_ENABLED=true` for matching sweeps, completion, and async integration writes.
- **Origins:** align `CORS_ORIGINS` and Privy's allowed origins with the deployed frontend.
- **Contracts:** optional and separately deployed; follow the [contract guide](contracts/README.md).

## Further Reading

- [Product and user journeys](backend/PRODUCT.md)
- [Technical architecture](backend/ARCHITECTURE.md)
- [Formation Engine contract](backend/AI.md)
- [Frontend/backend integration](backend/FRONTEND_HANDOFF.md)
- [Backend development](backend/README.md)
- [Contract development and deployment](contracts/README.md)
- [Arkiv schema and usage](arkiv/schema.md)

## How We Used AI

**In the product:** 0G Compute chooses onboarding questions, structures activity requests, composes
groups from a shortlist the server provides, writes map dialogue, and assesses group photos. Rules
decide seats and membership. Provider request IDs appear in the app.

**In development:** Claude Code was used for implementation, debugging, contract deployment,
and writing documentation, including the `arkiv/` documents. Its work was reviewed and directed by the
team, and live numbers in those documents were read from the network rather than generated.

<!-- TODO(team): each teammate should confirm or add the AI tools they used, and what for. -->

## License

[MIT](LICENSE)
