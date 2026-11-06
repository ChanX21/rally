# Rally API: Frontend Handoff

For Divyanshi, from Harshed. Everything here is on `main` and working. The full journey has passed
against real 0G and Arkiv, with one exception: **login with a real Privy user has never run**, because
it needs your frontend. Please tell Harshed the first time you try it. See [Known gaps](#known-gaps).

Browse every request and response schema at **`http://localhost:3000/docs`**, or fetch
`/docs/json` to generate a typed client. If this document and `/docs` disagree, trust `/docs`.

## Run the backend

```sh
cd backend
npm install
cp .env.example .env
npm run db:local      # terminal 1: local PostgreSQL, no Docker
npm run db:migrate    # terminal 2
npm run dev
```

Then, in `backend/.env`:

- `PRIVY_APP_ID` and `PRIVY_APP_SECRET`: get them from Harshed privately. Authenticated routes return
  `503 AUTH_NOT_CONFIGURED` without them. Use the **same app ID in the frontend**, or every token is
  rejected. Never put the secret in the frontend.
- `CORS_ORIGINS`: add your dev origin, exact and comma-separated, e.g. `http://localhost:5173`. An
  unlisted origin fails in the browser with a CORS error.
- `ZERO_G_API_KEY` and `ZERO_G_MODEL`: optional. Without them, parsing always returns `needs_review`,
  which is a handy way to build the fallback screens.

There is no deployed URL yet. Keep the base URL configurable.

## Basics

**Response format.** Check `success`, not just the HTTP status:

```json
{ "success": true, "data": {} }
```

```json
{
  "success": false,
  "error": { "code": "RALLY_FULL", "message": "That was the last seat...", "requestId": "..." }
}
```

- Branch on `error.code`. `error.message` is safe to show to users.
- `details` is present on validation errors.
- Show `requestId` on unexpected errors, so Harshed can find it in the logs.

**Authentication.** Send a Privy access token on every call except health and preview:

```ts
const token = await getAccessToken(); // from usePrivy() in @privy-io/react-auth
fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
```

Tokens expire after about an hour, so fetch one per request rather than storing it. Cookies are not used.

**Call `POST /auth/session` once after every login, before anything else.** It creates the user. Other
routes return `401 SESSION_REQUIRED` until you do. Never send a user ID or wallet address as identity:
the backend ignores them and reads both from the token and Privy.

| Code | What to do |
| --- | --- |
| `401 INVALID_TOKEN` | Refresh the token and retry once, then send to login |
| `401 SESSION_REQUIRED` | Call `POST /auth/session`, then retry |
| `403 ACCOUNT_SUSPENDED` | Show a message and stop |

**POST with no body.** Do not send `Content-Type: application/json` with an empty body: it returns
`400`. Send `{}`, or leave out the header. This affects `/auth/session`, publish, cancel, withdraw and
mark-as-read.

**Polling.** There is no push or SSE yet. Poll `GET /notifications` every 10 to 15 seconds while the app
is open. The limit is 300 requests per minute per IP, and phones on venue wifi may share one IP, so do
not poll faster. A `429 RATE_LIMITED` comes with a `retry-after` header.

**Slow calls.** `/intents/parse`, `/intents/:id/answers` and `/onboarding/questions` call AI and took **7
to 24 seconds** in live tests. Show a real processing state, and set client timeouts above 60 seconds.

**Displaying text.** Render all AI and user text as plain text, never as HTML.

## Fixed values

There is no catalog endpoint yet, so hardcode these.

| | Values |
| --- | --- |
| Categories | `build`, `coffee`, `workshop`, `gaming`, `food`, `explore`, `networking`, `wellness`, `support` |
| Zones (configurable on the server) | `venue-floor-1`, `venue-floor-2`, `venue-nearby` |
| Vibes | `quiet`, `chatty`, `any` |
| Offered roles | `participant`, `buddy`, `builder`, `reviewer`, `mentor`. The creator is `host` |
| Group size | 2 to 12, **including the creator** |
| Duration | 5 to 480 minutes |

`wellness` and `support` are always private and never appear in public discovery.

## Screens

### 1. QR preview (no login)

`GET /activities/preview?category=food&zone=venue-nearby&limit=20&cursor=...`

```json
{
  "available": true,
  "notice": null,
  "activities": [
    {
      "opaqueId": "rly_7NdURJcUgYYCROUs",
      "category": "food",
      "zone": "venue-nearby",
      "startBucket": "2026-11-06T14",
      "neededRole": "participant",
      "minGroupSize": 2,
      "openSeats": 2,
      "status": "open"
    }
  ],
  "nextCursor": null
}
```

- `status` is `open`, `filling` or `full`.
- **Cards are not joinable.** Tapping "Let's Rally" starts login and onboarding. Nobody can join from
  here, and no route accepts `opaqueId`.
- When `available` is `false`, show `notice` and carry on. Arkiv being down is not an error, and the
  rest of the app still works.
- Pass `nextCursor` back as `cursor` for the next page.

### 2. Login

Privy wallet login, then `POST /auth/session`, then `GET /me`:

```json
{
  "user": {
    "id": "uuid",
    "walletAddress": "0x...",
    "displayName": null,
    "optInMatching": false,
    "onboarded": false
  },
  "profile": null
}
```

`onboarded: false` goes to onboarding. `true` goes to home.

### 3. Onboarding

1. The user picks exactly three different interests.
2. `POST /onboarding/questions` with `{ "interests": ["food", "coffee", "gaming"] }`. You get up to three
   `{ id, text }` questions, plus `source`. Works even if AI is down.
3. `POST /onboarding/complete`:

```json
{
  "displayName": "Asha",
  "interests": ["food", "coffee", "gaming"],
  "answers": [{ "questionId": "group_energy", "answer": "chatty" }],
  "declaredSkills": ["reviewer"],
  "preferences": { "group_energy": "chatty" },
  "optInMatching": true,
  "availableFrom": "2026-11-06T09:00:00+05:30",
  "availableTo": "2026-11-06T23:00:00+05:30"
}
```

- **Availability is required when `optInMatching` is true.** Without it: `422 AVAILABILITY_REQUIRED`.
- Matching starts in the background once this succeeds. The user only hears through notifications.
- All times must be ISO 8601 with an offset.
- Later changes use `PATCH /me/profile`, including opting out.

### 4. Home: "What do you want to do, and when?"

`POST /intents/parse`:

```json
{
  "text": "Anyone up for a late snack run?",
  "timeZone": "Asia/Kolkata"
}
```

Send the device's zone, from `Intl.DateTimeFormat().resolvedOptions().timeZone`. The response:

```json
{
  "status": "needs_answers",
  "needsReview": false,
  "aiRequestId": "...",
  "intent": {
    "id": "uuid",
    "status": "draft",
    "source": "ai",
    "category": null,
    "goal": "Anyone up for a late snack run?",
    "windowStart": null,
    "windowEnd": null,
    "durationMin": null,
    "groupMin": null,
    "groupMax": null,
    "zone": null,
    "vibe": null,
    "questions": [{ "id": "start_time", "text": "What date and time should your food meetup start?" }],
    "expiresAt": null,
    "createdAt": "..."
  }
}
```

**Branch on `status`:**

| `status` | Meaning | Show |
| --- | --- | --- |
| `needs_answers` | AI needs more | `intent.questions`, up to three, then `POST /intents/:id/answers` |
| `ready` | AI drafted a plan | The plan, **for the user to review and confirm** |
| `needs_review` | AI failed or gave up | The editable form, prefilled with `intent`. May contain guessed defaults |

Answers call, **once per intent**:

```json
{ "answers": [{ "questionId": "start_time", "answer": "In about an hour" }] }
```

It returns the same shape, with `status` as `ready` or `needs_review`. A second attempt returns `409
PARSE_BUDGET_EXHAUSTED`, so go to the form. Any field can be `null`, and the form must let the user
fill it. Nothing is published until the user confirms it in the next step.

### 5. Confirm and publish

`POST /rallies`, with an `Idempotency-Key` header (8 to 128 characters). Generate one per form, and reuse
it on retries, so a flaky network cannot create two rallies.

```json
{
  "intentId": "uuid",
  "category": "food",
  "goal": "Late snack run",
  "vibe": "chatty",
  "windowStart": "2026-11-06T20:00:00+05:30",
  "windowEnd": "2026-11-06T21:00:00+05:30",
  "durationMin": 45,
  "zone": "venue-nearby",
  "groupMin": 2,
  "capacity": 4,
  "publish": true
}
```

- **`windowStart` is the actual start time.** Candidates must be free from then for `durationMin`.
  `windowEnd` is when the rally expires, and must be at least `durationMin` after the start.
- `capacity` and `groupMin` include the creator, who is seated automatically.
- `meetingPoint` is optional here. It is the exact location, and only the formed group ever sees it.
- `publish: false` saves a draft. Publish it later with `POST /rallies/:id/publish`.

Response, used throughout the rally screens:

```json
{
  "id": "uuid",
  "opaqueId": "rly_...",
  "creatorId": "uuid",
  "status": "open",
  "visibility": "public_coarse",
  "category": "food",
  "goal": "Late snack run",
  "vibe": "chatty",
  "windowStart": "...",
  "windowEnd": "...",
  "durationMin": 45,
  "zone": "venue-nearby",
  "groupMin": 2,
  "capacity": 4,
  "openSeats": 3,
  "expiresAt": "...",
  "version": 2,
  "hasMeetingPoint": false,
  "createdAt": "..."
}
```

### 6. Rally status

| `status` | Show the creator | Show participants |
| --- | --- | --- |
| `draft` | Edit, publish | |
| `open` | Looking for people | |
| `waiting` | "No close fit yet. We'll notify you" | |
| `proposed` | People are deciding | Waiting for others |
| `ready` | **Prompt to set a meeting point**, if `hasMeetingPoint` is false | Waiting for the meeting point |
| `formed` | Room and check-in | Room |
| `met` | "How did it go?" | Feedback form |
| `completed` | Done | Done, feedback still open |
| `cancelled`, `expired` | Over | Over |

These are separate on purpose. Never show "joined" for `proposed`, or "meeting confirmed" before
`formed`. A rally can move backward: a withdrawal can return it to `open` or `proposed`.

- **Edit:** `PATCH /rallies/:id`, including `expectedVersion` from the last response. On `409
  VERSION_CONFLICT`, reload and retry. Time and zone are locked once people have been asked (`409
  SCHEDULE_LOCKED`).
- **Set meeting point:** the same PATCH, with `meetingPoint`. From `ready`, this moves it to `formed`.
- **Cancel:** `POST /rallies/:id/cancel`, creator only.
- **My rallies:** `GET /rallies?status=formed&limit=20&cursor=...`.

### 7. Match proposal

`GET /matches` returns the proposals, and the wait state for "no match":

```json
{
  "matches": [
    {
      "id": "uuid",
      "status": "pending",
      "role": "participant",
      "holdUntil": "...",
      "reason": "You are both free in this window and interested in food.",
      "source": "ai",
      "rally": {
        "id": "uuid",
        "status": "proposed",
        "category": "food",
        "goal": "Late snack run",
        "vibe": "chatty",
        "windowStart": "...",
        "windowEnd": "...",
        "durationMin": 45,
        "zone": "venue-nearby",
        "groupMin": 2,
        "capacity": 4,
        "openSeats": 3
      }
    }
  ],
  "waiting": [{ "id": "uuid", "category": "food", "goal": "...", "expiresAt": "..." }]
}
```

- Show a countdown from `holdUntil`.
- A notification links here through `data.matchId`. `GET /matches/:id` works as a deep link.
- **Respond:** `POST /matches/:id/respond` with `{ "response": "accept" }` or `"decline"`. Safe to retry.

Nothing is ever accepted on the user's behalf. Handle these:

| Code | Say |
| --- | --- |
| `409 RALLY_FULL` | Someone took the last seat. **The two-phone demo tests this.** See [Testing](#testing-a-full-flow) |
| `409 OFFER_EXPIRED`, `OFFER_CLOSED`, `RALLY_CLOSED` | This match is no longer available |
| `409 SCHEDULE_CONFLICT` | You already have a rally at this time |
| `409 ROLE_TAKEN`, `MEMBER_CONFLICT` | This match is no longer available |
| `409 ALREADY_ACCEPTED` | They tried to decline after accepting. Offer withdraw |

**No match is never a dead end.** When there is nothing to accept, offer: "Keep this interest active until
6 PM?" That is `POST /intents/:id/activate`, with `{ "expiresAt": "..." }` and any corrected fields. It
needs category, time window and duration, or returns `422 INTENT_INCOMPLETE`, so show the form.
`POST /intents/:id/cancel` drops it.

### 8. Temporary room

`GET /rallies/:id/room`:

```json
{
  "rallyId": "uuid",
  "status": "formed",
  "goal": "Late snack run",
  "windowStart": "...",
  "windowEnd": "...",
  "zone": "venue-nearby",
  "meetingPoint": "Food court, north entrance",
  "meetingBrief": "Look for the Rally sign",
  "members": [
    { "userId": "uuid", "displayName": "Asha", "role": "host", "checkedIn": false }
  ]
}
```

- `409 ROOM_LOCKED`: accepted, but the group has not formed yet. Show a waiting state.
- `404`: not a member. This includes after withdrawing.
- **Withdraw:** `POST /rallies/:id/withdraw`. The creator gets `409 CREATOR_CANNOT_WITHDRAW`, and should
  cancel instead.

This is the meeting card and member list. There is no chat.

### 9. After meeting

**Host check-in**, creator only, once `formed`: `POST /rallies/:id/check-in`.

```json
{ "presentUserIds": ["uuid"] }
```

The host is included automatically. At least one other person must be present. Anyone not listed is
marked a no-show, and loses access to the rally.

**Feedback**, for people marked present: `POST /rallies/:id/feedback`.

```json
{
  "happened": true,
  "useful": true,
  "vouches": [{ "recipientId": "uuid", "contribution": "Helped my pitch" }],
  "encoreWith": ["uuid"]
}
```

- The first `happened: true` moves the rally to `completed`.
- Take recipient IDs from the room's `members`.
- A vouch comes back as `verified` or `flagged`. Flagged means abuse checks stopped points, so do not
  present it as a penalty.
- A retry is safe, and its `vouches` list comes back empty.

**Rewards:** `GET /me/rewards` returns `{ balance, net, tier, chain, entries }`. `net` can be negative, and
`chain` is null while on-chain records are off. Entries in state `pending` are no-shows that can still be
appealed. Ignore the voucher route: claims are off.

**Arrival:** `POST /rallies/:id/arrive` is the "I'm here" tap, from 30 minutes before `meetAt`. Safe to retry.

**Disputes:** `POST /rallies/:id/disputes` takes `{ category, subjectId, description }`. An appeal needs only
`{ category: "no_show_appeal" }`. `GET /me/disputes` returns `{ raised, against }`.

## Notifications

`GET /notifications?limit=20&unreadOnly=true&cursor=...` returns `{ items, nextCursor, unreadCount }`:

```json
{
  "id": "uuid",
  "type": "match.proposed",
  "title": "You have been matched",
  "body": "...",
  "data": { "matchId": "uuid" },
  "readAt": null,
  "createdAt": "..."
}
```

Mark read with `POST /notifications/:id/read`, or `POST /notifications/read-all`. Show `title` and `body`
as sent, and route on `type`:

| `type` | `data` | Open |
| --- | --- | --- |
| `match.proposed`, `match.expired` | `matchId` | Match |
| `match.accepted`, `match.declined`, `rally.waiting` | `rallyId` | Rally status |
| `rally.formed` | `rallyId` | Room |
| `rally.participant_withdrew` | `rallyId` | Rally status or room |
| `rally.seat_open` | `rallyId` | Matches |
| `rally.met` | `rallyId` | Feedback |
| `rally.cancelled`, `rally.expired` | `rallyId` | Rally status |
| `reward.earned` | `rallyId` | Rewards |

## Other error codes

| Code | Meaning |
| --- | --- |
| `400 VALIDATION_ERROR` | Bad input; `details` lists the fields |
| `404 NOT_FOUND` | Missing, or not visible to this user |
| `409 NOT_ONBOARDED` | Send to onboarding |
| `409 ALREADY_ONBOARDED` | Use `PATCH /me/profile` |
| `409 INVALID_STATE` | Not possible in this rally state. Reload |
| `422 INVALID_WINDOW`, `INVALID_DURATION`, `INVALID_GROUP`, `INVALID_ZONE`, `INVALID_ROLES`, `INVALID_INTERESTS` | Form errors; show `message` |
| `429 RATE_LIMITED` | Wait for `retry-after` |
| `500 INTERNAL_ERROR` | Show `requestId`, and tell Harshed |

## Testing a full flow

Use two browsers with two Privy accounts:

1. Account A onboards with `optInMatching: true`, availability covering the next few hours, and `food`
   as an interest.
2. Account B onboards, and publishes a `food` rally starting within A's availability.
3. Within about 30 seconds with AI on, or a few seconds without it, A gets a `match.proposed`
   notification.
4. A accepts, and B sets a meeting point. Both open the room.
5. B checks A in, and A leaves feedback.

**Last-seat race.** The backend never offers more people than seats, so set this up deliberately:

1. Accounts A and C both onboard as in step 1.
2. B publishes with `capacity: 3`, and waits until A and C each have a match.
3. B reduces the rally to `capacity: 2` with `PATCH /rallies/:id`. Now there is one seat and two offers.
4. A and C accept on two phones at once. Exactly one succeeds, and the other gets `409 RALLY_FULL`.

## Known gaps

**Needs testing with your frontend:**

- Real Privy login has never run end to end. Tests use the real SDK with locally signed tokens, and the
  wallet lookup is faked.
- If `walletAddress` comes back `null` for a logged-in user, tell Harshed. Login still works.

**Not built, so do not design around them:** push notifications, SSE, room chat, "4 exploring" counts on
preview cards, and a catalog endpoint. The playbook's vague cards can use `category`, `zone`,
`startBucket` and `openSeats`. If the demo needs any of these, ask Harshed.

**Questions:** Harshed for the API, Chanchal for AI behaviour and question wording.

## Personalized questions and preferences

Onboarding now returns interest-specific questions. A question can include `options: [{ value, label }]`: render suggestions in a text input so the user can choose an option value or enter custom text (up to 120 characters). Keep the 300-character text field for questions without options. Do not send a suggestion label as its structured option value. Supported option answers become structured profile preferences server-side; the frontend does not need to duplicate that mapping.

Intent responses include `preferences`. Keep these in the editable plan, show controls for their known values, and send them when creating a Rally or activating a waiting intent. An explicit user answer overrides model/profile defaults. Changing category should clear unrelated preferences. Unknown or `any` preferences remain eligible, but known conflicting choices are excluded. Acceptance may return `409 MATCH_NO_LONGER_ELIGIBLE` if availability/preferences changed after the invitation.

Backend migration 0005 must run before deployment. See `ARCHITECTURE.md`. The local preview uses frontend `http://localhost:3000` and backend `http://localhost:3123`; production data was not migrated by starting this preview.


## Group photo rewards

Rally/room responses now include `proofFlow` and `completedAt`. For proof-flow Rallies, hide host
check-in, arrival rewards and complaint controls. Completed rooms remain accessible and allow
optional vouches without host attendance marking. Show completion as automatic, not verified presence.

`GET /rallies/:id/proof` returns `{id,state,reason,canSubmit,rewardAmount,rewardedCount,
submissionsLeft,closesAt}` to a frozen completed-group member. States are `not_submitted`,
`processing`, `accepted`, `needs_clearer_photos`, `unavailable`. No photo data is returned.
`POST /rallies/:id/proof` takes `{images:["data:image/jpeg;base64,..."],note?:"..."}` and a required
`Idempotency-Key` (8–128 characters). Accept 1–3 JPEG/PNG photos, 5 MB each, at most 20 megapixels.
The request limit is 22 MB; normalized photos stay private. Reuse a key after a network error;
change it only for a changed selection/note. Submission returns immediately and assessment happens
in the worker. Poll at 10-second intervals; never present temporary AI failure as reward approval.

A single accepted submission rewards all confirmed members once (including host), default 10 each.
A vouch is optional feedback only. Route `rally.completed` and `proof.needs_clearer_photos`
notifications to the room. `RallyCompleted` is the new reward-history label. New points may be
pending chain synchronization until the revised contract is deployed/configured; no wallet action
or stablecoin claim is part of this flow.


### Matching and manual preference inputs

New onboarding defaults Receive Rally invites to on, visibly editable before completion. Default
availability is the next 12 hours, adjustable during onboarding and in Profile. Existing users are not
opted in retroactively. Profile supports editing/clearing suggestions and custom preferences, plus
availability and the matching switch. Background matching does not require the app to remain open.

Use `custom_<category>` (for example `custom_gaming: "Rocket League doubles"`) for custom input,
with at most 120 characters. Keep only the custom or structured choice for a given category; an
explicit plan preference overrides profile defaults. The existing preferences object is carried
through intent review, waiting-intent activation and publication. These are soft matching preferences,
not guarantees of every free-text requirement. Changing a custom preference cancels pending invites
in that category; old cancelled invites cannot be accepted. Closing an invite does not revoke an
already accepted seat.


### Venue map speech

`GET /activities/preview` returns `dialogue` (a public-safe string of at most 80 characters) for
each confirmed Rally. Pass open activity records to the venue map so a bubble and its dot always
refer to the same `opaqueId`. Dialogue is based on the current goal/category without returning
the raw goal. The map is illustrative and does not reveal participants' real locations.
