# Rally Formation Engine — AI architecture

**Status:** implementation contract, 5 November 2026. Companion to *Rally v2 Intelligence & System Architecture*. This document describes the AI work to build on backend commit `17ab8c8`; it is not a claim that these routes or tables already exist.

## Decision

Keep one Fastify backend and one small AI module. Use 0G inference in the actual onboarding, activity, and matching flows. The model chooses questions, structures a user's activity request, and ranks a group **only from a backend-supplied eligible shortlist**. PostgreSQL and backend rules decide who is eligible, who receives an offer, whether a seat is available, and whether everyone consented. No model response creates a room, joins a person, publishes to Arkiv, or writes to a chain.

```text
User text / answers ──> Fastify route ──> Formation Engine ──> 0G
                           │                    │          │
                           │                    └─ parse + validate result
                           └─ authenticate, filter, commit, notify ──> Postgres / outbox
```

### What exists today

`backend/` has Node 22+, TypeScript with NodeNext `.js` imports, Fastify 5, Zod 4, Drizzle/Postgres, Vitest, request IDs, a response envelope, rate limiting, and environment validation. `src/services`, `src/repositories`, `src/workers`, and `src/integrations` are placeholders. `src/db/schema/index.ts` has no product tables; `src/app.ts` registers only health routes. No Privy verification, rally state machine, shortlist query, 0G client, or Arkiv integration exists yet. The AI module must integrate with those as they land; do not bypass their absence with a second datastore or public LLM routes.

## Ownership and handoff

| Owner | Builds | Provides / receives |
| --- | --- | --- |
| AI owner | Versioned Zod contracts and prompts, 0G adapter, Formation Engine, deterministic output validation, labeled eval set, sanitized inference traces | Receives authenticated and minimized context; returns typed suggestions or a typed failure |
| Backend owner | Privy auth, profile/rally tables, candidate retrieval and hard filters, consent and state machine, transactions, offers, outbox/notifications, Arkiv | Calls the engine after validation; rechecks live state before offers and every acceptance |
| Frontend owner | Interest selection, question UI, editable intent, processing/wait states, proposal accept/decline | Sends user answers and confirmed intent; never treats an AI suggestion as a confirmed seat |

The first integration handshake is the three engine inputs and outputs below, plus shared category/zone/role IDs and the backend's event names. Put schemas in `backend/src/schemas/formation.ts` so routes and services use the same Zod definitions. `contracts/` is currently the smart-contract directory, not a TypeScript package; no new package is needed.

| Change when implementing | Owner | Touches |
| --- | --- | --- |
| Engine contracts, prompts, provider call | AI | `src/schemas/formation.ts`, `src/services/formation.ts`, `src/integrations/zero-g.ts` |
| Provider config and route wiring | AI + backend | `src/config/env.ts`, `.env.example`, `src/app.ts`, new route modules |
| Eligible shortlist, events, offers, consent | Backend | `src/db/schema/index.ts` plus migration, repositories, services, workers |
| Shared behavior checks | AI + backend | `test/formation.test.ts`, route/worker tests, fixtures, `README.md` API notes |

This is planned scope, not a request to change those files now. Preserve existing route response envelopes, auth checks, and database error handling when connecting callers.

## Engine surface

Three functions in `backend/src/services/formation.ts` are enough. Inputs are built by backend services, not accepted directly from the browser. Keep provider transport in `backend/src/integrations/zero-g.ts`; that file alone knows the current 0G API and credentials. Add prompt text/version constants beside the engine, not a generic prompt registry.

```ts
chooseOnboardingQuestions(input: {
  interests: [CategoryId, CategoryId, CategoryId];
  availableQuestionIds: QuestionId[];
  alreadyAnsweredIds: QuestionId[];
  remainingQuestions: number; // 0..3 across this onboarding
  requestId: string;
}): Promise<QuestionSelection>

parseActivity(input: {
  text: string;
  answers: { questionId: QuestionId; answer: string }[];
  now: string; // ISO UTC
  timeZone: string; // IANA zone supplied/confirmed by client
  allowedCategoryIds: CategoryId[];
  allowedZoneIds: ZoneId[];
  remainingQuestions: number; // 0..3 across this activity
  requestId: string;
}): Promise<ParseResult>

composeGroup(input: {
  rally: ValidatedRallySummary;
  candidates: EligibleCandidateSummary[]; // backend-filtered, bounded shortlist
  requestId: string;
}): Promise<CompositionResult>
```

These are contract sketches, not existing TypeScript exports. The backend chooses the exact enum values and supplies them to the engine; the model cannot create new IDs. Use opaque user IDs only. Never send wallets, Privy tokens, contact details, exact meeting points, blocklists, raw feedback, or full profiles to 0G. The activity `text` is user content, treated as data rather than instructions; cap its length at the route boundary. Explicit opt-in is required before including another user's summary in a shortlist.

### 1. Onboarding questions

The user picks exactly three catalog interests. The model selects **at most three total** relevant question IDs from a backend-owned catalog; the backend looks up display text and answer controls. This prevents invented questions and makes answers stable data. A question should distinguish availability, preferred activity, or useful role/capability. The model cannot infer an undeclared skill as fact.

```json
{
  "schemaVersion": 1,
  "questionIds": ["availability_window", "activity_style"],
  "reasonCode": "disambiguate_interests"
}
```

Validation: IDs must be unique, in `availableQuestionIds`, absent from `alreadyAnsweredIds`, and count must not exceed `remainingQuestions`. The backend persists declared answers and opt-in; any inferred tag remains separate with provenance and user correction. If inference fails, use a small fixed ordering from the same catalog. Do not block onboarding or pretend the fallback was AI-generated.

### 2. Activity intent and clarification

The user describes an activity. The initial parse call returns either a typed draft or question IDs from an activity-specific catalog. The UI can ask only the IDs returned, within a **three-question total** budget for that activity. Keep the original text and collected answers on the backend/client; make at most one reparse call after the answers. If it still cannot produce a valid draft, show an editable form. Ask only when time, location range, group size, or another hard match decision cannot be determined. Never guess a time or zone.

```json
{
  "schemaVersion": 1,
  "status": "ready",
  "intent": {
    "categoryId": "food",
    "goal": "late snack run",
    "startAt": "2026-11-05T19:00:00Z",
    "durationMin": 40,
    "groupMin": 2,
    "groupMax": 4,
    "zoneId": "venue_nearby",
    "vibe": "chatty"
  }
}
```

The other valid shape is `{ "schemaVersion": 1, "status": "needs_answers", "questionIds": ["start_time"] }`. Use a discriminated Zod union and reject mixed or extra fields. `goal` is short, sanitized display text, not a public Arkiv payload. The server checks that category and zone are allowed; start time is future and inside the event; duration and group size fit product bounds; and the parsed time agrees with the user's local time zone and explicit words. Ambiguous phrases such as “tonight” require clarification when the clock or zone makes them unclear. Only the authenticated user confirms the draft; `answersConfirmed` is backend state, never a model assertion.

### 3. Group composition

Run on **both** `UserOnboarded` (when opted in) and `RallyPublished`. The backend first queries current opportunities and consenting users, then hard-filters category/roles, overlapping time for the full duration, zone, capacity, expiry, visibility, blocks, and active claims. If no feasible shortlist exists, skip 0G and enter a bounded waiting state. The exact SQL and capacity checks belong to the backend owner.

Give 0G one small shortlist containing opaque IDs and only match-relevant features: declared interests, verified/inferred capabilities labeled as such, coarse availability, roles, and zone. The validated rally summary must include its creator/required members, available roles, time window, zone, and group bounds. `groupMin`/`groupMax` count **all** people, including the creator; the shortlist contains additional eligible candidates. Cap it at an agreed backend limit (initially 20) with documented deterministic retrieval order. The engine returns either `no_fit` or a proposal from required members plus those candidate IDs:

```json
{
  "schemaVersion": 1,
  "status": "proposed",
  "memberIds": ["u21", "u44", "u82"],
  "roles": [
    { "memberId": "u21", "roleId": "host" },
    { "memberId": "u44", "roleId": "builder" },
    { "memberId": "u82", "roleId": "reviewer" }
  ],
  "reason": "Shared time window and complementary workshop roles"
}
```

The other valid shape is `{ "schemaVersion": 1, "status": "no_fit" }`, meaning no feasible composition **within this supplied shortlist**. Validate unique IDs, exact membership in required members plus shortlist, inclusion of all required members, required role coverage, group bounds, same time/zone, and a short reason without private details. Revalidate against **live** database state before creating offers; use the backend's transaction/unique claim rules at acceptance. A proposal is an invitation, not a seat or a formed room. Persist genuine `no_fit` as waiting until eligible supply changes. Persist provider failure or invalid output as `unavailable`/`invalid_output`, keep the rally pending, and retry transient failures under a separate bounded backend policy. Never fabricate users or auto-accept a replacement.

## Provider and failure contract

The adapter returns model output text plus safe metadata: provider request ID, model ID, latency, and token usage if available. It enforces a short timeout, output-size cap, JSON-only response, and one bounded retry only for transport/transient failures. The engine validates JSON with Zod and applies business checks after parsing. Invalid JSON or unsupported IDs are failures, not invitations for a free-form repair loop. Choose the exact 0G endpoint/authentication and model from a **real minimal provider smoke test before implementation**; those SDK details and private/verified execution capabilities are not established by this repository.

Add only the provider configuration actually required by that smoke test to `backend/src/config/env.ts` and `.env.example`; validate names and types with the existing `parseEnv` pattern, keep secrets server-side, and make missing credentials disable AI explicitly in development. In a real demo environment, make startup fail or visibly flag degraded AI when inference is required, so a local fallback cannot be mistaken for sponsor integration. No new LLM dependency until the tested 0G interface requires one.

Return a typed failure to the backend service (`unavailable`, `invalid_output`, `timeout`) with safe metadata. HTTP routes use the existing `{ success, data }` / `{ success, error }` envelope and `x-request-id`. Intent parsing falls back to an editable form; onboarding uses fixed catalog questions; matching remains waiting. The backend owns persistence and retry policy. Do not put raw provider responses in `AppError.cause`: `src/lib/logger.ts` recursively serializes ordinary error messages and stacks, which may contain prompts, answers, or tokens. Log only allowlisted metadata and validator reason codes. Do not log prompt text, candidate summaries, raw answers, or provider error bodies.

## Integration sequence

1. **Agree contracts.** Backend owner fixes category, zone, role, and question catalogs, hard-filtered shortlist shape, consent rule, and event payloads. AI owner writes Zod schemas and example fixtures first. Frontend owner confirms the question and editable-intent screens can render the two parse states.
2. **Prove 0G.** Make one isolated call with harmless fixture data. Record the real auth flow, model ID, latency, timeout behavior, and provider request ID, token usage, and cost when observable. Then implement `zero-g.ts` against that verified surface.
3. **Connect the user flow.** Backend-owned `POST /onboarding/questions` calls `chooseOnboardingQuestions`; `POST /onboarding/complete` persists interests/answers and emits `UserOnboarded`. `POST /intents/parse` calls `parseActivity`; `POST /rallies` persists only a user-confirmed, server-validated draft and emits `RallyPublished`. These endpoints are proposed; none exists yet.
4. **Connect matching.** A worker consumes the two events, queries eligible candidates, calls `composeGroup` once when feasible, validates and rechecks results, persists a proposal, then enqueues notifications. Acceptance goes through the backend's own route and transaction. Arkiv publication uses the backend outbox after PostgreSQL commit and contains only coarse public fields.
5. **Demo gate.** Verify a real user can complete onboarding, parse an activity, receive an AI-composed proposal, accept with another user, and see a formed temporary room. Keep the provider request ID and prompt/model versions in traces. Show waiting and editable-form paths when 0G or supply fails.

## Checks and observability

Add a small `backend/test/formation.test.ts` with a fake adapter and fixtures for valid/invalid JSON, unauthorized IDs, duplicate IDs, role/time mismatch, three-question limit, empty shortlist, and provider timeout. Keep one labeled evaluation set of about 30 real phrases and shortlist scenarios: ambiguous times, multiple intents, mismatched availability, role gaps, location constraints, prompt injection, and PII. Report schema validity, field accuracy, proposal validity, p50/p95 latency, per-run cost, and fallback rate. The hard release gates are **zero fabricated member IDs** and **zero invalid confirmed groups** in adversarial tests. `npm test` currently starts embedded PostgreSQL globally, including unit tests; use the existing setup unless the test configuration is intentionally changed.

Each inference trace should contain request ID, provider request ID when supplied, task, prompt/schema version, model ID, latency, token usage when supplied, result (`valid`, `invalid_output`, `timeout`, `unavailable`), and a safe validation reason. Track product outcomes separately: proposed → accepted → formed → met → completed. A model score is not a calibrated acceptance probability. Keep private input out of traces and public discovery.

## Deliberately deferred

No vector database, agent framework, second backend, fine-tuning, autonomous replan loop, model-written profile truth, or on-chain rewards in the core flow. Add any of these only after the real pilot exposes a specific need. The first implementation risk is 0G transport and credentials; resolve it with the provider smoke test before promising a live inference demo.
