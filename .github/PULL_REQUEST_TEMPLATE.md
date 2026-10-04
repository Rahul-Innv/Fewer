## What and why
<!-- What does this change, and why? Link any issue. -->

## How I tested
- [ ] `npm test` passes
- [ ] `npx tsc --noEmit -p .` passes
- [ ] `npx eslint src/app src/components` passes
- [ ] If I changed `src/core/decide.ts`, I added or updated a case in `fixtures/asks.golden.json`

## Guardrails
- [ ] The model still has no send tool, and only the approval step emails an asker
- [ ] Inbound email text is still treated as data, never as instructions
- [ ] No secrets staged (`git status` shows no `.env.local`, keys or tokens), and no real personal email in fixtures or docs
- [ ] No new dependency, or the PR says why it is needed
