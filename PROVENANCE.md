# Provenance

Fewer was built on 2026-10-04 at the Build Personal Agents Hack in San Francisco. Every file in
this repository was written that day.

Some ideas come from earlier open-source projects by the same author. No code was copied from them;
the patterns were re-implemented here in TypeScript.

| Idea in Fewer | Earlier project (MIT) | What carried over |
|---|---|---|
| Single-use approval tied to a hash of the exact drafts | [TruthLease](https://github.com/Rahul-Innv/truthlease) | Approve exactly what was shown, once; refuse if it changed |
| A claim counts as verified only when 2+ independent sites agree | [Laptop-Deal-Watcher](https://gitlab.com/krahul02004/Laptop-tracker) | Corroboration before trust; "unverified" beats a guess |
| Missing evidence is shown as "couldn't check", never filled in | StormWorthy | Abstain instead of inventing |

Third-party services used: Neon (Postgres and AI Gateway), Mastra, AgentMail, Exa and assistant-ui.

The demo uses a made-up persona, demo inboxes and demo asks. Nothing real is booked or sent to
anyone outside the demo inboxes.
