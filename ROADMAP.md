# Roadmap

Fewer was built in one day. This page says what it deliberately does today, what could come next, and what it will not do. Items are ideas, not promises, and nothing here has a date.

## Today (the deliberate scope)

- **One owner, one approver, one agent inbox.** The three goals and the boundaries are a demo persona seeded by `npm run migrate`.
- **Two ways in:** email to Fewer's AgentMail inbox, and **Add an ask** on the Desk.
- **Decisions are deterministic.** The model reads and drafts. Pure TypeScript in `src/core` decides.
- **Nothing reaches an asker without your approval.**
- **Proactive mode:** follow-ups after an event ends, and a morning brief at 8:00 local, both to you only.

## Near term

- Edit your goals and boundaries from the Desk instead of seeding them.
- Let high ratings (4 and 5) raise a kind of ask, not only let low ratings lower it.
- Handle multi-part public suffixes such as `co.uk` when checking that two sources are independent.
- Make the Fly.io image smaller by moving `tsx` to `dependencies` and pruning dev dependencies after the build ([docs/DEPLOY.md](docs/DEPLOY.md) explains the tradeoff).

## Later

- More than one owner, each with their own goals, boundaries and inbox.
- Checks against your real calendar, so a conflict is found, not just a protected time block.
- Retry a failed send safely, without ever sending twice.

## Non-goals

- Giving the model a send tool, or sending to an asker without your yes.
- Accepting, declining or booking anything on your behalf. Fewer answers by email and you act.
- Helping you do more. The point is fewer yeses, better ones.

Want to help with one of these? Open an issue first so we can agree on the approach, and read [CONTRIBUTING.md](CONTRIBUTING.md).
