# Reach

## Who is it for?

People at ETHGlobal Mumbai 2026 who want company for something right now: a coffee, a pitch rehearsal,
a workshop or a game. Asking in a crowded group chat is slow, and it tells everyone where you will be.

Rally turns a sentence into a small group that has agreed to meet. The public Arkiv board shows what is
happening without revealing who is going.

The people who read the board first are attendees deciding whether Rally is worth signing in for.
Because it needs no login, it also works from a QR code on a poster or table.

## Would they use it?

What we can show today:

- **The board is live.** On 6 November 2026, at about 18:15 UTC, it had
  [9 listings](how-you-use-arkiv.md#numbers), across coffee, arts, photography, workshops and building.
  Public data cannot show who made them, so some may be the team's own.
- **Strangers tried it, and it showed us real problems.** We put the app in front of people we did not
  know. Some tapped Continue and nothing appeared to happen. We traced this to off-list meeting areas and
  past start times failing silently, then fixed it and added progress feedback in commit `71c82d9`.

What we cannot claim yet: repeat use, retention, or that anyone outside the team has built on the
public data. This was a small informal test, not a study.

<!-- TODO(team): add real counts before submitting: people who signed in, Rallies created, groups
formed, and how many strangers tried it. Read these from production. Do not estimate. -->

## Can they try it today?

Yes.

| What | Where | Needs |
| --- | --- | --- |
| See the live board | <https://www.therally.xyz/app/discover> | Nothing |
| Create a plan and get matched | <https://www.therally.xyz> | Sign-in through Privy |
| Query the data directly | [`schema.md`](schema.md#queries-you-can-run) | `curl` |
| Run it yourself | [Quick start](../README.md#quick-start) | Node.js 22.12+, PostgreSQL |

The code is public at <https://github.com/ChanX21/rally> under the [MIT license](../LICENSE).

Known limits: this is a testnet deployment, and matching only works when enough people at the event
have opted in. A new attendee might wait for a fit. The first deployment is built around one event's
venue zones and categories.

## Will we keep building after Mumbai?

<!-- TODO(team): this needs a decision from the team, not a guess. State plainly whether you will keep
building, who will, and what happens next. Replace this comment before submitting.

Facts that may help:
- ARKIV_EVENT and ARKIV_APP are configuration, so a new event does not need a schema change.
- The event name is a queryable field, so several events can share one network.
- Venue zones are a fixed list in backend/src/domain/catalog.ts and would need changing per venue.
-->
