# Deploying Fewer to Fly.io

One image, two process groups, one password gate.

| Process group | Command (from `fly.toml`) | Public? | Machines |
|---|---|---|---|
| `web` | `npm run start -- -p 3000 -H 0.0.0.0` (the Desk + `/api/*`) | yes, `https://<app>.fly.dev` | 1 |
| `worker` | `npx tsx scripts/worker.ts` (AgentMail listener, triage, brief) | no, no `[services]` | **exactly 1** |

Files: `Dockerfile`, `.dockerignore`, `fly.toml`, `src/proxy.ts` (password gate),
`src/app/login/*` and `src/app/api/login/route.ts` (the gate UI).

Nothing here has been run against your Fly account. Every command below is yours to run.

## Read this first: exactly ONE worker

The worker is the only thing that consumes the inbox. `listenInbox` dedupes by message id in memory,
per process, so two listeners would both handle every email: double LLM and Exa spend, and a risk of
duplicate briefs and approval codes.

- Keep `worker=1`. Never `worker=2`.
- **Stop the local worker (`npm run worker`) before the Fly worker goes live**, and keep it stopped
  while Fly's is running. Do not send test asks during the swap.
- `fly.toml` uses the `rolling` deploy strategy, which replaces the worker machine in place. Do not
  switch it to `bluegreen` or `canary`; those briefly run two workers.

## Steps

`fly` and `flyctl` are the same binary. If `fly` is not on your PATH, use
`& "$env:USERPROFILE\.fly\bin\fly.exe"` (PowerShell) or `~/.fly/bin/fly.exe` (Git Bash).

### 1. Log in (opens the browser)

```
fly auth login
```

### 2. Claim the $500 credits

Redeem the hackathon code or link from the organizers in the Fly dashboard (Billing). Fly needs a
payment method on file before it will create apps. Do this before step 4.

### 3. Create the app

App names are global on Fly. If `fewer` is taken, pick another and put it in `fly.toml`
(`app = "<name>"`).

```
fly apps create <name>
```

### 4. Secrets (names only are shown; values never print)

`.env.local` is never baked into the image. Fly injects these as environment variables at runtime.

The names the app uses, from `.env.example`:
`DATABASE_URL`, `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`, `ANTHROPIC_API_KEY` (optional),
`AGENTMAIL_API_KEY`, `EXA_API_KEY`, `FEWER_INBOX`, `FEWER_APPROVER`, `FEWER_HOST_DEMO`,
`FEWER_OWNER_NAME`, `FEWER_TZ`, `FEWER_MODEL_FAST`, `FEWER_MODEL_DRAFT`, `FEWER_ALLOW_SEND`.

Import them (the filter skips comments and blank values, which `fly secrets import` should not get):

```powershell
# PowerShell ("<" redirection does not exist there)
Get-Content .env.local | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=.+' } | fly secrets import
```

```bash
# Git Bash / cmd-style shells
grep -E '^[A-Za-z_][A-Za-z0-9_]*=.+' .env.local | fly secrets import
```

Check `FEWER_ALLOW_SEND` is not `false` unless you want the Fly copy to dry-run outbound mail.

Then add the Desk password. **Do not put `DESK_PASSWORD` in `.env.local`**: Next would load it locally
and gate your recording session. Unset in development, the gate is a no-op. Unset in production, the
Desk is locked: every route answers `503` until you set it, unless you also set `DESK_GATE=off` on purpose.

```powershell
$b = New-Object byte[] 18; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$pw = [Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]',''
$pw                                    # write this down: it is what you type at /login
fly secrets set DESK_PASSWORD=$pw
```

(Or `fly secrets set DESK_PASSWORD="a long passphrase"`.) Verify the names landed: `fly secrets list`.

### 5. Deploy

```
fly deploy --ha=false
```

`--ha=false` keeps the first deploy to one machine per process group (Fly's default would start two
web machines). Fly builds the image remotely; you do not need Docker locally.

### 6. Pin the counts

```
fly scale count web=1 worker=1
```

### 7. Stop the local worker

Ctrl+C the terminal running `npm run worker` (or kill that process). Do it before the Fly worker
finishes starting if you can. The local Desk (`npm run dev`) is unaffected and can stay up.

### 8. Verify

```
fly status
fly logs
```

In the logs, look for `[worker HH:MM:SS] schema ready` and `listening on <your inbox>`.

```
curl -sI https://<name>.fly.dev/login                                  # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<name>.fly.dev/api/desk   # 401 (the gate is on)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://<name>.fly.dev/   # 307, goes to /login
```

Then open `https://<name>.fly.dev`, sign in with the `DESK_PASSWORD`, and email the inbox one test ask.
The ask should appear on the Desk and the brief should arrive from the Fly worker.

## The password gate (what it does)

- `DESK_PASSWORD` set: every page and `/api/*` route needs a signed cookie, except `/login`,
  `/api/login`, `/_next/static`, `/_next/image` and `/favicon.ico`. Pages redirect to `/login`;
  `/api/*` answers `401 {"ok":false,"error":"Sign in required."}`.
- `DESK_PASSWORD` unset in development: complete no-op (local dev, recording).
- `DESK_PASSWORD` unset in production: fails closed. Every route answers
  `503 {"ok":false,"error":"The Desk is locked: ..."}`, unless `DESK_GATE=off` is set on purpose.
- Cookie `fewer_desk`: expiry plus HMAC-SHA256 signed with `DESK_PASSWORD`; HttpOnly, SameSite=Lax,
  Secure in production, 12 hours, enforced server-side. Changing `DESK_PASSWORD` logs everyone out.
- After 12 hours an open Desk tab's polling gets 401s; reload the page to sign in again.
- Judges need the password. Unsetting it does not open the Desk; it locks it (see above).
- Opening the Desk to anyone (`fly secrets unset DESK_PASSWORD` plus `fly secrets set DESK_GATE=off`)
  is not recommended. It removes the gate from every route, including `/api/chat`, `/api/asks` and the
  approve buttons, so anyone could have the agent's inbox send a drafted email to any address.
- `fly.toml`'s health check polls `/login`, the one route the gate leaves open.

## Rollback and pause

```
fly scale count worker=0        # stop Fly's worker (then restart the local one if you want mail handled)
fly scale count web=0           # take the public Desk down
fly scale count web=1 worker=1  # bring both back
fly releases                    # list releases
fly deploy --image <image>      # redeploy an earlier image from `fly releases --image`
```

Never run the local worker and `worker=1` at the same time.

## Notes and tradeoffs

- **devDependencies stay in the runtime image** (hackathon): the worker is TypeScript run by `tsx`, a
  devDependency. The cleaner follow-up is to move `tsx` to `dependencies` and `npm prune --omit=dev`
  after `npm run build`; that needs a `package.json` change, so it was not done here. The image built
  locally at about 2.2 GB, so expect the first remote build and push to take several minutes.
- The image runs as the non-root `node` user and contains no env values or secrets.
- `kill_signal = "SIGTERM"`: both `next start` and `scripts/worker.ts` shut down cleanly on it.
- VM size is `shared-cpu-1x` with 1 GB per group; Next plus Mastra plus the AI SDK are too heavy for
  the 256 MB default.
- Schema migrations run inside the worker on boot (`runMigrate`), so no `release_command` is needed.
- Machines in the `web` group are pinned on (`auto_stop_machines = "off"`, `min_machines_running = 1`)
  so the demo URL never cold-starts.
