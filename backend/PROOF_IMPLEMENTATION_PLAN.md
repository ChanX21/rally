# Rally photo evidence implementation plan

Status: proposal only. No proof feature, migration or chain write implemented by this plan.

## Baseline reviewed

Fetched `origin/main` at `bbf5e882589261d8c6329886a765c7b569c8756f` and merged it locally,
preserving the local vision evidence and clarification work. Local merge: `a90c1fd`.

The new rewards work is materially different from the earlier voucher-based proposal:

- `RallyLedger` records policy-bound point changes and dispute rulings; `RallyToken` is
  non-transferable, whole-number RALLY. These are reputation points, not cash payouts.
- `contracts/README.md` records Arc Testnet ledger `0xf36Fab5B39f0741Ee549B83Aefa64af7BbE9F642`
  and token `0xb34c92f18E76EAb1a93a9ACDf4e677685498826B`. Deployment state and roles were not
  independently checked on-chain in this planning pass.
- `RewardClaim` is retained but explicitly not in use. Do not build this feature around vouchers.
- Arrival taps, host check-in, vouches, pending no-show penalties, admin dispute resolution,
  immutable amount policies and asynchronous Arc synchronization already exist.
- Completion still requires `formed -> met -> completed`. No automatic completion or private
  photo upload service exists. Production inference still sends text only.
- Migration `0006_rally_rewards.sql` is now part of the baseline. Do not edit it; generate the next
  migration when implementation starts. No deployed database migration was run for this plan.

## Recommended scope

Ship automatic closure plus photo-gated **existing positive reward actions** first. Reuse the new
ledger, disputes, outbox, caps and admin screen. Avoid a contract deployment in the first phase.

There is an important product limit: the deployed contract has only eight fixed actions.
`publishPolicy` changes amounts, not the enum, action names or eligibility semantics.

| Existing positive action | Proposed requirement under the proof policy |
| --- | --- |
| `OnTime` (+10 in policy 1) | Existing qualifying arrival tap, approved participation evidence, corroboration and no reward hold |
| `HostCompleted` (+5) | Host of an ended activity, approved participation evidence, corroboration and no reward hold |
| `Vouched` (+25) | Existing valid contribution vouch, approved evidence for giver/recipient participation, caps and no hold |

Photos alone must not fabricate an `OnTime` event or a contribution vouch. A non-host who neither
records arrival nor receives a qualifying vouch would not earn points in this compatible MVP,
even if their photo is approved. Make that clear in the reward UI.

**If the intended product is “any participant earns a base reward for verified participation,”**
add a properly named action such as `ParticipationVerified` in a new ledger contract deployment.
That requires matching backend enums/amounts, contract tests, a token/history migration decision
and explicit deployment authorization. Do not disguise it as `OnTime`. Treat this as a separate
product decision before implementation, not an accidental consequence of image scoring.

## User experience and completion

1. Let users form and attend activities without mandatory post-activity administration.
2. Auto-close eligible `formed` or `met` activities at `meetTime(rally) + durationMin + 15 minutes`.
   Fifteen minutes is a proposed configurable grace period. Prefer the explicit `meetAt`; the
   current fallback is `windowStart`. Do not use the discovery expiry as the activity end time.
3. Record `completionSource: auto | participant`, `completedAt`, and the accepted participant
   roster used for evidence eligibility. An automatically ended activity does not assert attendance.
4. Add `formed -> completed` through the shared state machine; never invent `metAt`,
   `checkedInAt` or `arrivedAt`. Reconcile completion with expiry under the Rally lock, including
   an explicit precedence rule for formed activities whose discovery expiry is already due.
5. Stop accepting seats at the activity cutoff and preserve historical membership/withdrawal
   times. A later upload must not make a withdrawn or unrelated account eligible.
6. Send one optional “How did it go?” notification. Offer “Add photos for rewards” and “Skip.”
   Display “Ended automatically; attendance unverified” where applicable.
7. Propose a 48-hour evidence window and a 24-hour hold after approval before point release.
   A late approval starts its own hold; a model outage must not erase an on-time submission.

Auto-closure must not call the existing reward-granting paths. Missing photos, arrival taps or
feedback must never create a no-show penalty by themselves. Review existing
`penaliseAbsentHost`/host check-in behavior against this rule; retain an explicit, appealable
absence-report path rather than interpreting silence as absence.

## Private evidence storage and records

Use a private object bucket, preferably within the existing Supabase infrastructure. This is a new
integration to configure; a Postgres connection does not provide storage credentials automatically.

- Issue short-lived upload authorization only for an eligible participant's own submission.
- Accept 1–3 JPEG/PNG images; propose 5 MB per image plus a decoded-pixel limit.
- Decode and re-encode server-side, strip EXIF/GPS, validate actual content and compute hashes.
  Do not trust browser MIME types, filenames or EXIF capture times.
- Verify uploaded object ownership and size before finalizing a submission. Do not fetch arbitrary
  user-supplied URLs. Add upload/inference rate limits and clean up abandoned uploads.
- Keep private object keys, an optional bounded note, content hashes, submission version,
  uploader, claimed participants and timestamps. Claiming a participant is not verifying them.
- Proposed raw-photo retention: 30 days after final resolution; retain a disputed photo until
  resolution. Define the accompanying access/deletion policy before enabling uploads.
- Other group members confirm participation without receiving unrestricted photo access.
  Signed viewing URLs are for authorized submitters/reviewers, not public listings.

Proposed schema additions:

| Record | Purpose |
| --- | --- |
| `rally_proofs` | Versioned shared submission, private asset metadata, note, assessment/model-run references, review state, reason and reviewer |
| `proof_participants` | Unique proof/user participation claims and independent confirmations; no self-confirmation |
| `rally_reward_eligibility` | One current eligibility decision per Rally/user, linked proof version, policy version and release time |
| Existing `rallies` | Completion source and stable completion/eligibility roster metadata |
| Existing `reward_ledger` | Eligibility reference for newly proof-gated positive entries |

Generate foreign keys, uniqueness constraints and RLS with the migration. Keep review states
`unverified`, `submitted`, `review_required`, `verified`, `rejected`, `disputed` separate from the
existing ledger states `pending`, `held`, `applied`, `cancelled` and chain-sync status.

## 0G image assessment — AI owner

Use `gemini-2.5-flash-lite` for an initial pilot. Seven public-photo checks passed through 0G;
that does not establish production accuracy. See `evidence/VISION_PROBE_2026-11-06.md`.

- Keep the existing text model for onboarding, intent parsing and composition. Add a separate
  `ZERO_G_VISION_MODEL` setting; reuse the existing API key unless deliberately configuring another account.
- Extend the shared 0G adapter with typed image-content support. Do not ship the probe's transport
  injection or create a separate production HTTP client.
- Add a bounded `assessProof` task through Formation Engine/FormationRunner and `model_runs`.
  Reuse timeout, response-size, output validation and request/billing metadata handling.
- Send normalized images as base64, the activity category, a redacted short goal and optional note.
  Exclude wallets, names, exact meeting locations, full profiles and signed storage URLs.
- Return validated activity compatibility, assessability, visible group evidence, uncertainty,
  observed inconsistencies and short reasons. Do not identify faces or claim freshness/attendance.
- Treat image text and uploader notes as untrusted data. No AI output can award points or write to chain.
- Batch up to three images in one assessment. Retry transient failures at most once; cap resubmissions
  and reuse successful assessments of the same version. Keep AI unavailable/invalid output in review.
- Record prompt/schema/model versions and evidence content hashes. Reject stale results when an
  upload is replaced or a reviewer has already made a newer decision.

Do not ship an arbitrary “90% means verified” threshold. First evaluate more activity types and
adversarial examples with human labels. For the initial pilot, manual review decides eligibility;
AI assists the reviewer. Later automation requires compatible evidence, another accepted
participant's confirmation of the specific claimant, passed deterministic abuse checks and no
open relevant dispute. Two accounts can still collude; retain existing repeat-group/counterparty caps.

## Backend reward gates and disputes — backend owner

Close every current positive-reward bypass:

- `services/rewards.ts::rewardCheckIn` currently applies `OnTime` during host check-in.
- `services/rewards.ts::rewardHostCompleted` currently grants points from feedback completion.
- `services/feedback.ts::applyVerifiedVouch` currently inserts `Vouched` entries as applied.

Change these to preserve qualifying events and record pending eligibility, then have one shared
release service grant the eligible actions after proof approval, corroboration and the hold period.
Recompute daily/repeated-group/counterparty caps under user locks at release; parallel claims must
not exceed caps. Freeze each event's reward policy version instead of silently using whatever
policy is newest when the model finishes. Publish a new documented policy version for the new
eligibility rules; leave historical entries and already queued chain events untouched.

Specific hazards in the latest code that implementation must address:

1. `applyDuePenalties` selects **all** due `pending` entries, without checking whether they are
   penalties. Adding timed positive entries unchanged would auto-release them. Restrict this job
   to its intended negative actions and release positive rewards through the proof gate.
2. `raiseDispute` holds a pending entry only for a no-show appeal. Other complaints do not currently
   hold positive rewards. Relevant proof/false-check-in complaints must hold the affected
   eligibility and unreleased positive entries, without blocking unrelated Rally members.
3. `syncRewardEntry` does not recheck reward state once an entry is queued. Add a state/eligibility
   recheck in the chain worker and coordinate holds, queueing and submission under a defined lock
   protocol. Specify the cutoff after which submission may already be irreversible; do not promise
   that a complaint can cancel a broadcast transaction.
4. `syncRewardEntry` currently hashes the entry ID as its evidence hash. For new proof-backed
   records, commit to a canonical private evidence manifest/version using the existing secret,
   scoped per recipient/entry. Do not put images, notes, URLs, raw hashes shared across participants,
   identities or the shared proof ID on-chain. Existing hashes and entries must remain unchanged.
5. Current dispute timeout dismisses unresolved non-appeal complaints after 72 hours. Define proof
   hold behavior explicitly: a review timeout must not accidentally approve unverified evidence.

Extend existing dispute records/admin review rather than building a second reporting system.
Use existing `false_checkin` or `other` categories for the first version; a new on-chain category
would also require a contract interface change. Keep proof-review rejection separate from an
upheld misconduct complaint; an unclear photo is not a finding of fraud.

## Arc settlement and contract limits — backend/Web3 owner

Retain `Postgres applied entry -> outbox -> Arc record -> transaction receipt`. The user flow must
work while Arc is unavailable; chain retries retain the same idempotency key. Activate a reward
amount policy only with its corresponding immutable contract policy available for synchronization.

No contract changes are needed just to gate existing actions or populate the existing
`evidenceHash`. There is no stablecoin payout or user claim transaction in this feature.

The ledger is not upgradeable, has a fixed action enum and rejects deltas that differ from policy.
It cannot arbitrarily revoke a `Recorded` event or apply a freely chosen refund/reversal amount.
Existing complaint penalties burn points and create debt where needed, but are **not** an exact
reversal of an earlier earning. Hold before settlement and keep late-dispute policy honest.
A new generic participation reward or general corrective action requires a separately designed
new contract deployment/history strategy, not an invented action code sent to the current address.

## Proposed API and frontend integration

All endpoints require existing Privy authorization and service-side membership checks.

| Proposed endpoint | Purpose |
| --- | --- |
| `POST /rallies/:id/proofs/uploads` | Authorize bounded private uploads |
| `POST /rallies/:id/proofs` | Finalize objects/claimed participants, version and enqueue assessment; idempotent |
| `GET /rallies/:id/proofs` | Authorized evidence status and viewer-specific eligibility |
| `POST /rallies/:id/proofs/:proofId/confirm` | Another accepted participant confirms specified participation claims |
| `GET /internal/proofs` | Admin review queue |
| `POST /internal/proofs/:id/review` | Approve/reject with reason and audit trail; idempotent/version checked |

Reuse `/rallies/:id/disputes`, `/internal/disputes` and `/me/rewards`.
Extend reward responses to distinguish missing proof, assessment pending, review required,
verified but held, applied points and chain pending/synced/failed. Keep the first positive release
and its eligibility transition in one transaction, with a unique Rally/user/action event key.

Frontend owner changes `app/room`, `app/profile` and `admin`: optional photo/note submission,
participant confirmations, clear pending/rejection reasons, evidence review and dispute holds.
Existing generic feedback/vouch submission must also work after auto-completion for eligible
members without inventing host-attested check-in timestamps.

## Delivery checkpoints

1. **Completion and policy plumbing:** state-machine/scheduler changes, roster preservation,
   evidence schema, safe eligibility gate and protection against old reward bypasses. Deploy the
   migration before serving new code; keep the proof feature off during rollout.
2. **Private uploads:** server validation, ownership checks, status API, retention and review UI.
3. **AI assessment:** shared multimodal adapter, strict task schema, bounded asynchronous worker,
   metadata, stale-result checks and manual-only decision pilot.
4. **Reward release:** corroboration, holds, caps, disputes, per-recipient evidence commitments
   and existing Arc outbox integration. No deployment of a new contract for this compatible scope.
5. **Limited automation:** expand the labeled dataset, inspect failure rates by activity, then
   enable bounded automatic approvals if evidence supports it. Keep manual review and an off switch.

Suggested responsibility split: AI owner handles the adapter/task/prompts/evaluation evidence;
backend owner handles lifecycle, storage, eligibility, disputes and Arc synchronization; frontend
owner handles optional user/reviewer flows. Agree API schemas before splitting implementation.

## Acceptance checks before enabling

- No interaction auto-closes the activity but awards no positive points and fabricates no attendance.
- No photo means no new proof-policy positive reward, including arrival, host and vouch paths.
- A photo does not prove identity or punctuality; only corroborated, eligible claims reach release.
- Nonmembers, withdrawn accounts, arbitrary object keys, another submitter's assets, oversize files,
  self-confirmations and stale proof versions are rejected.
- AI failures, duplicate/reordered jobs and resubmissions cannot approve by default or bill without bounds.
- An old downloaded group photo can look plausible; no image-only automatic reward rule is allowed.
- Pending positive rewards cannot be applied by `applyDuePenalties` or synced while held.
- Concurrent disputes/releases/submissions and expiry/completion races are tested on real Postgres.
- Caps and per-event uniqueness hold under concurrent processing; replayed Arc records cannot mint twice.
- Chain outages do not lose decisions; per-person salted commitments preserve the current privacy model.
- Published amount policies, backend action ordering and deployed contract enums stay aligned.
- Historical points and records are preserved; no retroactive migration applies the new policy silently.

## Verification for this planning pass

Merged backend: type-check, lint, build and **363 tests passed**. After installing the repository's
pinned Soldeer dependencies, **46 local contract tests passed** (23 RallyLedger, 23 RewardClaim,
including fuzz tests). The install left tracked contract configuration unchanged. Vision findings
are from the previous public-fixture probe, not a new accuracy evaluation. No deployment,
public-chain transaction, production configuration change or production migration was performed.
