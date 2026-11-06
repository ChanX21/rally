# Why Arkiv

Rally needs two kinds of data that want opposite things. Who is going, and where they will meet, must
stay private. The fact that someone at the event wants a coffee at 7pm should be public, easy to read
and gone once it no longer matters. Arkiv holds only the second kind.

## If we swapped Arkiv for Postgres, what would users lose?

**Reading the board without trusting or asking Rally.** Today anyone can run
[one query](schema.md#queries-you-can-run) and see what is open at the event, with no Rally account,
API key from us, or permission. With Postgres, the board exists only through our API, on our terms, for
as long as we keep it running.

**Proof of who published a listing.** Each listing carries an owner address that the network enforces.
Readers can reject anything not written by Rally's relayer. With Postgres, they would have to take our
API's word for it.

**Cleanup that does not depend on us.** A listing expires at its own deadline, whether or not our
server is running. A Postgres row stays until our code deletes it, and our worker is the thing that
could be down.

**A public surface that holds only public data.** Other apps can build on the board without any route
into the database that holds preferences, group members and meeting points. With Postgres, a public
board and private data share one system, and one bad query or policy can expose the private part.

## What users would not lose

Inside Rally's own app, a swap would look almost the same. The Discover screen reads through our
backend and checks every listing against PostgreSQL, so a person using only the app gets no direct
benefit from the checks above, and Arkiv being down costs them only the board.

The advantage is real for anyone reading Arkiv directly, and for us as the operator. No third-party
reader exists yet. That is the gap between what this design allows and what has happened so far.

## What we kept off Arkiv, and why

| Kept off Arkiv | Where it lives | Why |
| --- | --- | --- |
| Names, wallets, profiles, preferences | PostgreSQL | Public data stays in chain history, so personal data cannot go there |
| Group members | PostgreSQL | Linking a person to a place and time on a public record is a safety problem |
| Exact meeting points | PostgreSQL, shown only to the formed group | Same reason. Only a coarse `zone` is public |
| Free-text goals and AI invitation text | PostgreSQL | People type personal details into free text |
| Group photos | Held privately by Rally, scheduled for deletion after 30 days | Faces are personal data |
| Seat allocation | PostgreSQL transactions | Two people taking the last seat needs row locks and atomic commits. `openSeats` on Arkiv is an estimate and is never used to allocate |
| Matching and consent | PostgreSQL and backend rules | Needs private inputs, and a seat must never depend on a chain write landing |
| RALLY rewards | PostgreSQL, then Arc Testnet | Permanent reward history is the opposite of expiring data |

Rule of thumb: if it describes a person, or must be exactly right the moment someone taps Accept, it
is not on Arkiv. If it describes a plan, is safe for anyone to read, and should vanish later, it is.
