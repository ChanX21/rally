# Reach

## Who is it for?

Anyone who wants company for something they would like to do: a coffee, a pitch rehearsal, a workshop or
a game. Asking in a crowded group chat is slow, and it tells everyone where you will be.

Rally turns "anyone up for this?" into a real plan with the right people. The public Arkiv board shows what
is happening without revealing who is going.

Busy events are where finding people takes longest, so that is where we started. ETHGlobal Mumbai is the
location of our first pilot, not the limit of who Rally is for.

The people who read the board first are those nearby, deciding whether Rally is worth signing in for.
Because it needs no login, it also works from a QR code on a poster or table.

## Would they use it?

What we can show today:

- **18 accounts have signed in.** Privy showed 18 total users on 7 November 2026 at 12:10 am IST, and its
  activity chart rose from 4 on 5 November to 18 on 6 November. This may include the team's own accounts,
  and it counts sign-ins, not Rallies or groups formed.
- **The board is live.** On 7 November 2026, at about 02:15 UTC, it had
  [5 listings](how-you-use-arkiv.md#numbers), across coffee, animals, music and workshops. It had 9 about
  eight hours earlier, and the count moves as plans end and new ones open. Public data cannot show who made
  them, so some may be the team's own.
- **Strangers tried it, and it showed us real problems.** We put the app in front of people we did not
  know. Some tapped Continue and nothing appeared to happen. We traced this to off-list meeting areas and
  past start times failing silently, then fixed it and added progress feedback in commit `71c82d9`.

What we cannot claim yet: repeat use, retention, or that anyone outside the team has built on the
public data. This was a small informal test, not a study.

## Can they try it today?

Yes.

| What | Where | Needs |
| --- | --- | --- |
| Watch the demo | <https://youtu.be/NZan1O1gnhM> | Nothing |
| See the live board | <https://www.therally.xyz/app/discover> | Nothing |
| Read the board directly from Arkiv | <https://www.therally.xyz/reader.html> | Nothing |
| Create a plan and get matched | <https://www.therally.xyz> | Sign-in through Privy |
| Query the data directly | [`schema.md`](schema.md#queries-you-can-run) | `curl` |
| Run it yourself | [Quick start](../README.md#quick-start) | Node.js 22.12+, PostgreSQL |

The code is public at <https://github.com/ChanX21/rally> under the [MIT license](../LICENSE).

Known limits: this is a testnet deployment, and matching only works when enough people at the event
have opted in. A new attendee might wait for a fit. The first deployment is built around one event's
venue zones and categories.

## Will we keep building after Mumbai?

Yes. We plan to take Rally to more places and make it the best product in its category, with privacy as
the focus.

Arkiv fits that plan, because public listings can carry a plan's coarse details while people, groups and
meeting points stay off the public record. Parts of this are ready for a second event, and parts are not:

- `ARKIV_APP` and `ARKIV_EVENT` are configuration, so a new event needs no schema change.
- `event` is a queryable field, so several events can share one network and schema.
- Venue zones need changing for each venue: `EVENT_ZONES` on the backend, the list in
  `frontend/src/lib/format.ts`, and the illustrative map.
