# Rally Product Overview

> **Less time finding people. More time doing things.**
> Other apps match profiles. Rally actually makes plans happen.

## What Rally is

Rally turns "I'd like to do something" into a small group of real people who have agreed to do it,
at a time and place that works. You say what you want in plain language. Rally finds people who
fit, asks everyone for consent, and unlocks a temporary room with the meeting details once the
group has formed.

Rally is not a social feed, and it is not an open list of rooms to browse and join. It is a
temporary association engine: groups exist to make one real-world activity happen.

The first deployment is ETHGlobal Mumbai 2026, with event attendees as the pilot users.

## The problem

At an event, plenty of people want the same thing at the same time: a late snack run, someone to
review a pitch, a gaming break. Today they post in crowded group chats, or give up. Finding people
takes longer than the activity, and a public post exposes where you will be to everyone.

## Vision

Make it as easy to start something with strangers as it is to think of it, while keeping people in
control of who knows what about them.

## Target users

- **Attendees** who want company for an activity but do not know who to ask.
- **Hosts** who start something and want the right few people rather than a crowd.
- **Curious visitors** who scan a QR code at the venue and see what is happening.

## How it works

1. **Understand.** You pick your top three interests and answer up to three short questions.
2. **Form.** You describe an activity. Rally asks up to three follow-up questions, and only if the
   answer would change who you are matched with.
3. **Match.** Rally finds viable people, composes a group and asks each of them for consent.
4. **Do.** You meet offline. The host confirms who showed up.
5. **Learn.** Optional feedback and vouches improve future matches.

## User journeys

### Two ways in

**QR entry.** A code at the venue opens a preview of vague live activity cards. Tapping "Yes, let's
Rally" starts onboarding. A preview never lets a stranger join.

**Direct entry.** The app opens on one conversational input: what do you want to do, and when?

Both paths lead to the same matching. Neither bypasses consent.

### Example: a late snack run

1. Asha types "Anyone up for a late snack run?"
2. Rally asks when, how far she will go, and whether she wants a quiet or chatty group.
3. Asha reviews the structured plan and publishes it.
4. Rally finds Ben and Chitra, who are opted in, free, and interested in food.
5. Each gets a notification, "You have been matched", with the reason, time and group.
6. Both accept. The group has formed, and the room shows the exact meeting point.
7. They meet. Asha confirms who arrived, and each person can confirm the outcome and vouch for
   someone.

### When nobody fits

"No match" is never a dead end. Rally offers to keep the interest active for a limited time, and
looks again every two minutes and when something changes: a new activity, a newly opted-in user,
a withdrawal or updated preferences or availability. Rally then notifies you. It never quietly adds you to anything.

## Key concepts

### Activity creation and discovery

An activity (a "rally" in the code) has a category, time window, broad zone, group size and host.
Hosts always approve the structured plan before it is published.

Publishing places a minimal listing on Arkiv, a public, expiring index that anyone can query:
category, broad zone, hour, open seat estimate and status. The listing excludes people, messages and
exact locations. Sensitive categories are private by default and are never listed publicly.

Discovery is for curiosity. **A public listing is not an invitation.**

### Intent parsing

Rally uses AI, through 0G Compute, to turn a sentence into a structured plan and choose follow-up
questions. The result is checked against strict rules, and you can edit it. If AI is slow or
unavailable, you get an editable form. Rally keeps working, and never makes up details or people.

### Matching and proposals

Hard rules run first: compatible activity, overlapping time, allowed zone, free seats, no conflicting
commitments, no blocks, and opted in. AI may then rank a small list of eligible people and suggest a
group, but rules decide, and it can only choose from that list. If AI is unavailable, a deterministic
ranking is used. If no valid group exists, the result is "no fit", not a made-up one.

### Explicit acceptance

A proposal is a question, never a decision. Nobody joins a group without accepting. A seat is taken
only at the moment you accept. If two people accept the last seat at once, exactly one gets it, and
the other receives a clear message. Replacements are never auto-accepted.

### Activity lifecycle

| State | Meaning |
| --- | --- |
| Draft | Only an intent, not visible to anyone else |
| Open | Published and discoverable; matching is running |
| Waiting | No fit yet; interest kept until expiry |
| Proposed | People have been asked and are deciding |
| Ready | Enough people have confirmed |
| Formed | The meeting card is unlocked for the group |
| Met | The host has confirmed who was present |
| Completed | A participant has confirmed it happened |
| Cancelled | The host called it off |
| Expired | Time ran out before it formed or took place |

These are deliberately separate. Being proposed does not mean accepted, accepted does not mean
formed, and formed does not mean anyone actually met.

If someone withdraws, their seat reopens and others are notified. Expiry never reopens an activity
silently.

### Notifications

The in-app inbox always works and is never lost: proposals, acceptances, formation, cancellations,
withdrawals and expiry. If a notification cannot be delivered, the proposal remains available in the
app. Nothing is ever accepted on your behalf.

### Feedback, vouches and rewards

After an activity, participants can confirm it happened and vouch for a specific contribution, such
as "helped my pitch". Vouches add evidence to a profile, but do not change identity. Abuse controls
prevent self-vouching, require the same completed activity, cap points and flag suspicious patterns.

People earn RALLY for showing up and contributing, and lose it for arriving late, cancelling late or not
coming. RALLY has no monetary value, cannot be transferred, and never affects matching. The database
holds the balance, and Arc Testnet holds a public copy of the history against the user's login wallet.
Nothing on-chain includes names, complaint text or locations, and a complaint reaches the chain only
after a ruling. A no-show waits 24 hours and can be appealed. Core Rally works with the chain switched
off.

## Privacy requirements

Rally coordinates real people, so accidental exposure matters more than clever automation.

- Exact meeting points, names, profiles, answers, consent and feedback stay in Rally's private
  database. The meeting point is visible only to the formed group.
- Public listings contain only coarse, non-personal information.
- Reward history is public and permanently tied to a wallet address, so onboarding says so. It holds only
  action codes, outcomes and hashes.
- Listings expire from live queries, but public chain history may retain them. Rally does not promise
  erasure from history, which is why nothing personal is published.
- AI sees pseudonymous, minimal context, never a name, wallet or exact location.
- Sensitive categories default to private.
- Matching is opt-in, and you can cancel, withdraw or opt out at any time.

## MVP scope

Must work (Gate A and B in the playbook):

- Privy login, three interests and up to three onboarding questions.
- AI intent parsing with an editable fallback.
- Activity creation, deterministic matching with AI composition, and proposals.
- Accept and decline with safe seat allocation, and the meeting room.
- Arkiv publishing, querying and expiry.
- Waiting and recovery, cancellation, in-app notifications, and QR preview data.

Optional (Gate D, only if stable): vouches, profile evidence, points and the on-chain reward claim.

## Explicitly out of scope

- Social feeds, followers, public profiles or open room directories.
- Joining without consent, or auto-accepting on anyone's behalf.
- Storing private data on Arkiv, or a separate wallet per user for Arkiv.
- Arbitrary AI agents, vector search, Kafka or microservices.
- Token mints or payouts that matchmaking depends on.
- Claims about private AI inference that have not been tested.
