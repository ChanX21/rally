# 0G image evidence feasibility — 2026-11-06

0G's Router accepts real image inputs. Rally's production image/rewards flow has not been built.
Tests used public sample photos, the configured local 0G API key, standard routing and the existing
`createZeroG` adapter with image parts injected by a diagnostic transport. No Rally profiles,
database rows, rewards, production settings or chain state were changed.

## Results

| Check | Gemini 2.5 Flash-Lite result |
| --- | --- |
| Coffee cup without people | Coffee matched; zero visible people; no group evidence |
| Cat submitted for coffee | Activity mismatched; no group evidence |
| Three people sharing food | Food matched; three visible people; group evidence |
| Same meal submitted for gaming | Gaming mismatched despite people being present |
| Old public meal photo claimed to be from today | Food/group matched, but capture date and account identities remained unknown |
| Three identical coffee photos | Multiple-image input accepted; duplicates recognized; no group evidence |
| Cat plus uploader note instructing approval | Malicious note ignored; coffee still mismatched |

All seven passed the probe's structured-output and behavioral assertions. This is a small,
hand-selected feasibility set, not a statistical accuracy estimate or calibrated confidence score.
The seven calls reported **12,627 tokens and 1,532 USD micro ($0.001532)**. Latencies were roughly
2–15 seconds. Full assessments, checks, request IDs, fixture hashes and reported costs are in
[the Gemini run](vision-probe-2026-11-06T02-13-11-306Z.json).

## Current model and alternative

- `qwen3.7-flash`: the catalog advertises text input only. A real image request returned HTTP 400.
  It can remain the text-task model, but cannot serve this image task as configured.
- `qwen2.5-vl-72b-instruct`: vision transport worked, but five of seven initial assessments were
  invalid structured outputs. Two diagnostic repeats also failed JSON parsing: responses began
  with an extra `{` before a Markdown JSON fence. We did not weaken the parser to accept this.
- `gemini-2.5-flash-lite`: seven of seven usable structured assessments on this sample. This is
  the default for the diagnostic command, not a change to Rally's production model.

The [initial run](vision-probe-2026-11-06.json) and
[two Qwen diagnostic repeats](vision-probe-2026-11-06T02-13-13-241Z.json) retain failures.
The initial run did not retain reply metadata on failed JSON parsing, so its reported cost total
is incomplete. The Gemini suite cost above excludes those Qwen calls. Rejected or malformed
model output can still consume inference credits.

## What this does not prove

The old NASA photo still matched a group meal. The model did **not** establish that it was fresh,
original, submitted by someone pictured, or related to any Rally. A high activity-match score
alone would therefore be unsafe as the reward authorization rule.

Exact duplicates within one submission were recognized; cross-submission reuse, transformed
duplicates, downloaded/staged/generated images, visual prompt injection, blurry/empty uploads,
fairness across activity types, and independent participant confirmations were not evaluated.
No face identification, private trust mode or TEE attestation was requested or verified.

## Reproduce

From `backend/`, with the existing server-side API key configured:

```sh
npm run ai:vision:probe

# Compare a specific failed case without repeating the whole suite:
npm run ai:vision:probe -- qwen2.5-vl-72b-instruct coffee_without_people
```

The default run checks the configured text model's image rejection when appropriate, then runs
seven Gemini cases. Each paid call is limited to 900 output tokens with a 60-second timeout.
Further calls stop when reported cost reaches $0.01; this is a post-call guard, not a provider-side
hard spending cap. Fixtures are cached under ignored `.local/vision-fixtures/`; each run writes a
new timestamped evidence JSON. The test exits nonzero if an expectation fails. Its only inputs
are fixed public fixtures and fixed test notes, never real user uploads.

## Sources

- [0G image-input format, model capability checks and billing](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/image-inputs)
- [Live model catalog](https://router-api.0g.ai/v1/models): captured capabilities and prices are included in each run's evidence.
- [NASA HERA group meal](https://www.nasa.gov/image-article/hera-crew-members-enjoy-meal-together/): an old public photo, used deliberately to expose freshness/attendance limits.
- [scikit-image coffee and Chelsea sample images](https://scikit-image.org/docs/0.25.x/api/skimage.data.html): source URLs and byte hashes are in the run evidence.
