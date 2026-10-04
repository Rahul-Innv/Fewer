# Contributing to Fewer

Thanks for your interest. Fewer is an agent that can send email on someone's behalf, so a few guardrails matter more here than in most projects. Please read them before opening a pull request.

## Guardrails

- **The model never sends.** The parsing, drafting and chat agents are built with no tools. The only code path that emails an asker is the approval step in `src/server/pipeline.ts`, and it needs the owner's `YES <CODE>` first. Do not add a send tool to an agent, and do not add a second path that mails an asker.
- **Inbound mail is data, not instructions.** Never put email text where a model could read it as a command. A message that tries to instruct the agent is quarantined (R0 BLOCKED), not answered.
- **`src/core` stays pure.** No network, no database, no clock reads, no environment. It depends only on `zod` and `node:crypto`. Given the same inputs it must return the same verdict. If you change `decide()`, add or update a case in `fixtures/asks.golden.json`.
- **Do not weaken the approval.** The code is single-use, expires after 30 minutes, and is bound to a SHA-256 of the exact recipients and bodies. Sends are exactly once (`actions` is `unique (approval_id, draft_id)`, plus an `Idempotency-Key`).
- **Run safely.** Set `FEWER_ALLOW_SEND=false` to dry-run all outbound mail while you develop. Use demo inboxes and made-up asks. Mastra traces include email text, so never trace real mail.
- **No secrets, no real personal data.** `.env.local` is gitignored; never commit it, and keep real names and email addresses out of fixtures, docs and screenshots.
- **Plain words in anything a person reads.** Copy in the Desk, emails and docs should read like a person wrote it: short, concrete, no filler.
- **Keep dependencies small.** Add one only when the change needs it, and say why in the pull request.

## Dev setup

Fewer needs Node 24.

```bash
npm install
npm test          # unit tests; no keys, database or network needed
```

To run the whole loop you need Neon, AgentMail and Exa accounts. Follow "Run it locally" in the [README](README.md), then use `npm run smoke` to check each service.

The Desk uses Next.js 16, which has breaking changes from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before changing `src/app` (see [AGENTS.md](AGENTS.md)).

## Making a change

1. Fork the repo and create a branch (`git checkout -b my-change`).
2. Make a focused change that matches the surrounding style.
3. Add or update tests, then run what CI runs:

   ```bash
   npx tsc --noEmit -p .
   npx vitest run
   npx eslint src/app src/components
   ```

4. Open a pull request that says what changed and why, and name any guardrail it touches.

### Commit checklist

- [ ] `npx vitest run`, `npx tsc --noEmit -p .` and `npx eslint src/app src/components` pass.
- [ ] Decision changes have a golden case in `fixtures/asks.golden.json`.
- [ ] No secrets staged: `git status` shows no `.env.local`, keys or tokens.
- [ ] No new dependency, or the pull request explains it.

## Reporting bugs and security issues

Open an [issue](https://github.com/Rahul-Innv/Fewer/issues) for bugs and ideas. For anything security-sensitive, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
