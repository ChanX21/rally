# Rally completion and photo rewards — revised plan

Status: plan only. Updated to the user's latest rules; no implementation or deployment authorized here.

## The agreed behavior

1. A formed Rally automatically becomes completed after its scheduled activity ends, even if nobody taps anything.
2. Vouching is optional. If someone vouches for another participant, save that contribution to their profile/history.
3. No photo proof means no completion reward. It does not stop the Rally from completing.
4. One participant can submit 1–3 photos showing the Rally happened.
5. If the submission passes the photo checks, reward **all confirmed participants, including the host**, once each.
6. No complaint process, reward appeal screens, extra participant confirmation step or dispute waiting period in this version.

Vouches are recorded independently of photos. They are not a requirement for group rewards and do not
create a separate reward in this proposed flow. No participant needs to upload individually or prove
punctuality to receive the group completion reward. The reward amount remains to be decided.

## What the latest code already provides

Reviewed `origin/main` at `bbf5e882589261d8c6329886a765c7b569c8756f`, merged locally as `a90c1fd`.

- Non-transferable RALLY points, an on-chain points ledger, reward history and background chain writes.
- Arrival, host-completion and vouch rewards. These currently grant points without photo proof.
- Optional feedback/vouch storage and profile evidence.
- Existing complaint and penalty features. These are not part of the new flow requested here.
- Completion currently requires host check-in and participant feedback; automatic completion is new work.
- No private photo upload or production image-assessment flow exists yet.

## Step 1 — automatic completion

Use the agreed meeting time plus the activity duration. If no explicit meeting time exists, use the
current `meetTime` fallback. A proposed 15-minute grace period can allow an activity to run slightly late.

- Complete only activities that formed; unformed activities still expire, and cancelled ones stay cancelled.
- Add the direct formed-to-completed transition in the shared lifecycle code.
- Do not invent arrival/check-in records or assert that people were physically present.
- Stop new joins at the activity cutoff and freeze the confirmed participant list for the reward.
- Exclude people who withdrew before the activity cutoff; include the host and other confirmed members.
- Make completion and expiry agree under the existing Rally lock so neither can overwrite the other.
- Send one optional “How did it go?” notification with “Add photos for group rewards.”
- No photo, vouch or response must create a no-show penalty by itself in this new flow.

## Step 2 — vouches remain optional records

Let confirmed group members leave a contribution vouch after automatic completion, even without a host
check-in. Keep authorization, no-self-vouch checks and existing duplicate/abuse checks.

Save the vouch and profile evidence, but disconnect it from immediate points. Likewise, stop the current
arrival and host-completion paths from granting the new completion reward before photo approval.
Preserve historical records and points; apply the new behavior only after an explicit rollout cutoff.

## Step 3 — one private photo submission for the group

Any participant in the frozen group can submit 1–3 JPEG/PNG photos and an optional short note.
Proposed submission window: 48 hours after completion. Timely submissions remain eligible if AI is slow.

- Use a private object bucket; storage credentials and upload support still need to be configured.
- Validate actual image contents, enforce file/pixel limits, remove location metadata and compute hashes.
- Only accept uploaded objects owned by the submitter for this Rally; do not fetch arbitrary URLs.
- Keep photos out of public listings and blockchain records. Use authorized, short-lived viewing links.
- Limit resubmissions and allow only one successful group reward, regardless of who uploads again.
- Keep a versioned submission and model assessment so a late result cannot approve an old replaced photo.
- Proposed photo retention is 30 days after the decision, with a clear deletion policy.

Use simple evidence states: `not_submitted`, `processing`, `accepted`, `needs_clearer_photos`.
A timeout or unavailable model leaves processing pending/retryable; it does not mean fraud or rejection.

## Step 4 — assess the photos through 0G

Use a separate vision-model setting, initially `gemini-2.5-flash-lite`. It passed seven public sample
checks in our existing probe; our current `qwen3.7-flash` is text-only. Keep it for existing text tasks.

Extend the existing 0G adapter and Formation Engine to accept image parts. Reuse `model_runs`, strict
response validation, bounded output, timeouts and request/cost tracking. Do not ship the diagnostic
transport injection as the production interface.

The model assesses activity compatibility, visible group participation, image quality and uncertainty.
Do not ask it to identify faces, establish photo age, assign reward amounts or write to chain. Send
only normalized image data and limited redacted activity context, not wallets or full profiles.

For an initial release, accept only clearly assessable, activity-compatible group evidence that passes
backend duplicate/abuse checks. Ask for clearer photos when uncertain. Start with a feature flag and
evaluate more real-world examples before choosing approval thresholds; the seven samples do not
establish production accuracy. Retry transient failures at most once per assessment version.

No extra participant confirmation is required under the user's revised rules. This is intentionally a
**group reward based on accepted group evidence**, not independently verified attendance per person.
An old/downloaded group photo can still look plausible, and a booked member who did not attend can
receive points. Model choice cannot eliminate that limitation by itself.

## Step 5 — reward everyone once

After acceptance, the backend creates one completion reward for each frozen participant in one
transaction, with a unique Rally/user/reward key. Record the proof version, policy version and amount.
Repeated uploads, repeated worker jobs and different uploaders must not award points twice.

Reuse the existing points history, earning caps, background queue and chain retry protection. Explain
any cap-related exclusions in the UI; if “everyone gets the full amount” must override existing caps,
make that a deliberate policy decision rather than silently retaining contradictory behavior.

No complaint hold or 24-hour waiting period is introduced. Apply the points after acceptance and send
them to Arc in the background. Chain outages must not lose the approved decision or block normal use.

The existing penalty scheduler currently selects all due pending entries. Restrict it to intended
penalties so future pending positive rewards cannot bypass photo checks. A queued reward must still
be checked for current accepted proof/version before its first chain submission.

## Contract change required for this exact behavior

The current `RallyLedger` has fixed actions: `OnTime`, `HostCompleted`, `Vouched`, and five penalty types.
It has no generic reward for all participants. Changing a policy amount does not add a new action.

Add a clearly named `RallyCompleted` earning action with the same configured amount for each confirmed
participant. Update backend action ordering, policy amounts, chain integration and contract tests together.
Do not label this reward `OnTime` or create fake vouches to fit the current contract.

The deployed ledger is not upgradeable, and its token can only be minted/burned by that ledger. This
means a new contract deployment and an explicit decision about how existing point balances and history
carry forward. Keep old history readable and never silently reset existing points. Public deployment
requires separate explicit authorization. Stablecoin payouts and `RewardClaim` are outside this plan.

Use a per-person salted commitment to the accepted private evidence manifest in the existing evidence
hash field. Do not publish photos, notes, shared proof IDs or shared raw image hashes on-chain.

## Keep the UI small

- Room: “Completed” plus optional “Add photos to reward your group.”
- Upload: 1–3 photos, optional note, submit.
- Result: checking photos / clearer photos needed / group rewarded.
- Profile: optional vouches and points history.
- No new complaint or dispute UI. Existing complaint/penalty paths must be disabled for the new flow
  where they conflict with this decision; preserve historical records rather than deleting them.

## Implementation checkpoints

1. Agree reward amount, cap behavior and the contract/history migration approach.
2. Add the revised completion reward action and test the contracts locally; do not deploy yet.
3. Implement automatic completion, frozen membership and vouch-only recording.
4. Add private uploads, evidence records, status APIs and the shared image-assessment task.
5. Add group-wide, once-only reward issuance and existing Arc synchronization.
6. Connect the minimal UI and validate the whole flow before enabling it.

Tests must cover no-action completion, no-proof/no-reward, vouches saved without photos, one accepted
submission rewarding the frozen group, withdrawn/nonmember exclusions, AI failure, uncertain evidence,
duplicate submissions, stale results, concurrent workers, reward caps and chain retries. All current
positive reward paths must be checked for bypasses. Existing backend and contract tests remain required.

## Work performed so far

Only this plan has been revised. The previously merged baseline passed type-check, lint, build,
363 backend tests and 46 local contract tests. Those checks do not mean this proposed flow exists.
No new photo calls, migration, reward change, chain write or deployment was performed for this revision.
