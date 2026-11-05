# Rally Formation Engine

Rally is an intelligent activity formation engine that brings people together in the real world.
Project wallet: `0x4A1cD581623Dc1efcB3Eea5da963BFC2C53A996f` (reported funded by the team; not an authentication credential).

## Setup

Use the existing backend `.env` and add:

```dotenv
ZERO_G_API_KEY=your-server-side-router-key
ZERO_G_MODEL=an-available-model-id-from-the-router-catalog
AI_REQUIRED=true
AI_TIMEOUT_MS=60000
```

Create a Router API key and select a model at https://pc.0g.ai. A funded wallet alone does not establish Router access or balance: Router and direct-provider accounts are separate. Never commit a private key or API key. No wallet secret is used by this integration.

The adapter follows the official [0G Router overview](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview): native `fetch` calls `https://router-api.0g.ai/v1/chat/completions` with server-side bearer auth. This is inference integration, not a claim of verified/private execution or sponsor eligibility.

```sh
cd backend
npm install
npm run typecheck
npm run test:ai
npm run ai:smoke  # requires real credentials and available balance; incurs inference usage
```

`AI_REQUIRED=true` rejects missing credentials at startup. Without credentials, onboarding returns catalog fallback questions; parsing and composition return `unavailable`. The smoke test is opt-in, never part of tests or server startup. It sends only a harmless JSON request and prints safe metadata.

## Backend teammate integration

`buildApp` registers `formationPlugin`, exposing `app.formation`:

```ts
const result = await app.formation.composeGroup({
  requestId: request.id,
  rally: {
    id: 'rly_1',
    intent: confirmedIntent,
    requiredMembers: [creatorSummary],
    requiredRoleIds: ['buddy'],
  },
  candidates: eligibleSummaries,
});
```

Use `app.formation.chooseOnboardingQuestions(...)` and `app.formation.parseActivity(...)` similarly. Types and Zod schemas are in `src/schemas/formation.ts`; complete valid fixtures are in `test/formation.test.ts`. Catalogs are injected by your backend, not invented by the model. Questions include an ID and a short purpose so the model can choose relevant questions; display text and answer controls remain backend/frontend-owned.

- Question input: exactly three distinct interests, catalog, answered IDs, remaining budget and request ID. Output includes `source: ai|fallback`; failed inference also includes a failure code.
- Parse input: original text, up to three answers, catalog, `now`, `eventEnd`, IANA timezone, allowed categories/zones, remaining budget, `attempt` (0 initially, 1 after answers), and request ID. Outputs are `ready` with an **unconfirmed** intent, `needs_answers`, or a failure. Backend must enforce attempt/budget across requests; clients cannot be trusted to reset them. Retain original text/answers; after the second attempt use the editable form.
- Composition input: confirmed fixed-time intent, required members including creator, required roles, up to 20 additional eligible candidates, request ID. All people must explicitly opt in. `groupMin`/`groupMax` include creator. Each person has interests, eligible role IDs, allowed coarse zones and UTC availability. Output is a validated `proposed` group or shortlist-scoped `no_fit`.
- Failures are `unavailable`, `timeout`, or `invalid_output`. They never mean nobody matches. Bad caller inputs throw Zod validation errors before inference; routes must validate their own request schemas and build trusted service inputs.

Subscribe the backend's future worker to `UserOnboarded` and `RallyPublished`; both should retrieve eligible users/opportunities and call the same composition function. For onboarding, choose an existing rally first, then compose against that rally. The engine does not retrieve or persist anything.

Before passing candidates, enforce auth, opt-in, category compatibility, blocks, visibility, expiry, active claims and live capacity. After a proposal, recheck current state before saving offers. At acceptance, atomically validate and allocate seats; unlock a room only after mutual consent. Do not expose arbitrary candidate composition over a public endpoint.

There are deliberately no HTTP AI routes yet: authentication, product tables and matching workers are not in this backend foundation. Authenticated routes should use existing success/error envelopes. This module is available to those callers without introducing an unauthenticated paid inference endpoint.

## Validation and limits

Strict schemas reject extra fields. The engine checks catalog membership, question budget, future/event-bounded times, group bounds, known and unique people, inclusion of required members, full-duration overlap, coarse zone and eligible role coverage. Shortlists are capped at 20. Model output is capped at 16,000 characters and transport response at 64 KB. No arbitrary provider URLs, credentials in clients, automatic joins, chain writes or seat allocation.

Model interpretation of natural language remains probabilistic: a syntactically valid draft can still misread a phrase. Users must review and confirm dates, times and constraints before publication. Frontends must render all model text as plain text, never HTML. Free text may contain personal information; clients should avoid entering it and backend callers must minimize/redact it before inference. Structured profiles are allowlisted; wallet/auth/contact fields are rejected by schemas.

Traces contain only task/version, request IDs, model, duration, usage when supplied and validation outcome. No prompts, answers, candidates, raw outputs or error causes. The adapter makes one request; transient retries belong to the backend's bounded job policy to avoid duplicate billing. Genuine no-fit waits for changed supply; outages remain pending under a separate retry policy.

## Checks

`npm run test:ai` runs isolated provider and engine tests without PostgreSQL or funded inference. `npm test` retains the backend's existing full integration suite and embedded PostgreSQL setup. Mocked responses test trust boundaries, not model quality. Before the pilot, run at least 30 labeled real-input evaluations and measure field accuracy, valid proposals, latency, observable cost and fallback rate; inspect failed cases and preserve safe provider request IDs.

Not implemented here: auth, catalogs, profile/rally persistence, candidate SQL, outbox workers, notifications, rooms, Arkiv, rewards. Those remain with the backend owner as agreed in `../AI_ARCHITECTURE.md`. The smoke test and all four demo calls have now passed live; see `AI_PROOF.md` and the recorded evidence. A configured key alone does not establish ongoing service availability.

## Proof and live demonstration

See [AI_PROOF.md](AI_PROOF.md) for verified evidence and the complete flow. `npm run ai:demo` performs four real inference calls with synthetic people and assertions; it spends inference credits but makes no database changes.

The inference deadline defaults to 60 seconds (configurable from 100 ms to 120 seconds). A 10-second deadline timed out during a live onboarding demo. Timeouts remain explicit failures, with no automatic retry; a longer deadline is not a guarantee of provider availability. Demo failures include the step and original inference failure code.

## Diagnosing model failures

`AI_MAX_OUTPUT_TOKENS` defaults to 4096 (allowed 128–8192). The original 2000-token completion cap may truncate a reasoning response; finish reason `length` is now reported as `output_limit`, never treated as a usable answer. A larger budget can increase inference cost.

Failure traces distinguish `output_limit`, `empty_content`, `response_shape`, `invalid_json`, `schema_mismatch`, `http_error` (with status), and `network_error`. Safe request IDs and usage are retained when available. No app trace contains model answer text. The synthetic-only `ai:demo` separately prints `demo_model_output` so a failing shape can be reproduced; do not copy this raw-output behavior into production or use personal information as demo fixtures.

Run `npm run ai:demo` locally. If it fails, share the failing step's `demo_model_output` and `inference_trace` lines; neither includes the API key. `output_limit` means the completion was truncated; `schema_mismatch` means valid JSON violated the strict task contract. These require different fixes.

Prompt version `formation-v2` explicitly lists allowed question, category, zone and member IDs. The adapter also unwraps a complete JSON Markdown fence, while still rejecting surrounding prose and enforcing all strict schemas. These changes resolved observed live failures; see `AI_PROOF.md`.

`npm run ai:demo` now narrates each fictional user input, translates the validated response into plain English, and explains what passed. Original JSON responses and traces remain alongside the narration for technical evidence. A final success message requires all four assertions to pass.
