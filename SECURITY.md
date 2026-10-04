# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's **Private vulnerability reporting**: the repository's **Security** tab, then **Report a vulnerability**. If that is not available, open a minimal public issue that says only that you would like a private security contact (no details), and the maintainer will set up a channel.

Include what the issue is and where, how to reproduce it, and the likely impact.

Fewer is a small project built at a hackathon, so responses are best effort. Security reports are taken seriously and come before features.

## Supported versions

Only the current `main` branch is supported.

## What matters most here

Fewer sends email for its owner, so the reports that matter most are the ones that get around these guarantees:

- **An asker, or anyone but the approver, releasing a send.** Only a reply from the approver address with the current single-use code, or the Approve button on the Desk, may approve.
- **Approving something other than what the owner saw.** The approval is bound to a SHA-256 of the exact recipients and bodies and expires after 30 minutes.
- **Sending twice, or sending without approval.**
- **Prompt injection.** Inbound email is untrusted data. A message that makes the agent act on its instructions, or reach a send, is a bug.
- **The Desk password gate.** With `DESK_PASSWORD` set, every page and API route needs a signed session cookie. A bypass is a vulnerability.

## Deployment notes

- The Desk has no login unless `DESK_PASSWORD` is set. In production it fails closed without one (`503` on every route) unless `DESK_GATE=off` is set; do not set that on a Desk the internet can reach. See [docs/DEPLOY.md](docs/DEPLOY.md).
- Secrets live only in environment variables (`.env.local` locally, `fly secrets` on Fly.io) and are never committed. `.env*` files other than `.env.example` are gitignored.
- If a key is ever exposed, rotate it right away. Treat anything that touched a commit, a log or a transcript as compromised.
- Mastra traces include email text. Use demo data only when tracing is on ([docs/MASTRA.md](docs/MASTRA.md)).
