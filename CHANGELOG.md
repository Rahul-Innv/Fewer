# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-source files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `ROADMAP.md`, issue and pull request templates.
- A GitHub Actions workflow (`.github/workflows/ci.yml`) that runs the type check, unit tests and lint on Node 24 with no secrets.
- A logo (`docs/assets/logo.svg`) and a README with badges, a how-it-works diagram and a proof section.
- `license` field (`Apache-2.0`) in `package.json`.

### Changed
- README and `docs/ARCHITECTURE.md` now cover the two intake channels, proactive mode, the Fly.io deploy and Mastra traces.

## [0.1.0] - 2026-10-04

First version, built at the Build Personal Agents Hack in San Francisco.

### Added
- An agent with its own AgentMail inbox that decides each ask: yes, a smaller yes, one question, a wildcard yes, or no, with the reason and the hours it would cost.
- Pure TypeScript decision logic in `src/core` (checks R0 to R6) with golden fixtures.
- Exa research on who is asking, where a claim counts as verified only when 2 or more independent sites quote it.
- One approval brief per batch, with a single-use code bound to a SHA-256 of the exact drafts, and exactly-once sends.
- Rejection of emails that try to instruct the agent (R0 BLOCKED).
- "Was it worth it? 1 to 5" follow-ups, and a learned preference from low ratings.
- The Desk (Next.js) with the Ask Fewer chat (assistant-ui and Mastra), and **Add an ask** for pasting an invite or request.
- Proactive mode: automatic follow-ups after an event ends, an 8:00 local morning brief, and a labeled demo button.
- Fly.io deploy files, with a password gate for the Desk, and optional Mastra traces.
