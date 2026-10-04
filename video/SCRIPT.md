# Fewer: demo video script (target 2:45, never over 2:45; organizer hard cap 3:00)

Hackathon: Build Personal Agents Hack, San Francisco, 2026-10-04.
Recording window opens 3:40 PM PT. Upload to YouTube by 4:18 PM PT.

**One-line pitch:** Most agents help you do more. Fewer helps you do less, on purpose.

## Ground rules (keep it true)

- Everything on screen is the demo persona and demo inboxes. Nothing real is booked or sent outside them.
  Keep a small corner badge on screen for the whole video: `DEMO PERSONA - DEMO INBOXES`.
- No numbers we did not measure. No "users", no "customers", no "live product", no "production".
  It was built today. "Always on" describes the Fly worker; it is not a usage claim.
- Never say "just arrived" or "live" about the four asks. `demo:prep` sends them before the take.
  Say "four asks" and show the inbox as it is.
- Say only the verdicts that are on screen (see "Pre-flight truth table"). The LLM parse and the Exa
  results can change which verdict an ask gets. Rules are deterministic; inputs are not.
- Say "summary email" for the approval email (the repo and the Desk call it the "brief"). The morning
  brief at 8:00 is a different email. Say the number of replies only if you read it off the banner.
- Label every wait cut and every demo shortcut on screen:
  `WAIT CUT (LLM + Exa)`, `DEMO: SKIPPED TO TOMORROW`, `DEMO RUN` (proactive button), `ASKS SENT BEFORE RECORDING`.
- Assume muted viewing. Every beat has an on-screen caption (large, top-center) and the SRT words (bottom).
  Never cover the approval code or the banner with a caption.
- Never on screen: `.env.local`, the Desk password or the /login form being filled, `fly secrets list`,
  Mastra access token pages, Neon connection strings, AgentMail API keys, `fly logs` (it can print email text).

## Timing budget (final cut, 2:45)

| Time | Length | Section | Screen |
|---|---|---|---|
| 0:00-0:04 | 4 s | Title card | `title-card/renders/title-card.mp4` (voiceover starts on it) |
| 0:04-0:30 | 26 s | Hook (word for word below) | Desk top, agent inbox, four verdicts, summary email, Approve |
| 0:30-0:44 | 14 s | Sent once, second try refused | Receipt, demo host inbox, "Not sent" email |
| 0:44-1:02 | 18 s | How it decides | YES card (rule + evidence), SMALLER card, BLOCKED card |
| 1:02-1:12 | 10 s | Always on | `fly status`, Desk on fewer-rk.fly.dev |
| 1:12-1:42 | 30 s | Proactive | skip to tomorrow, check-in, rating, morning brief (demo run), learned preference |
| 1:42-2:20 | 38 s | Under the hood | Mastra traces, Neon, AgentMail, Exa, assistant-ui, tests |
| 2:20-2:40 | 20 s | Close | GitHub repo, PROVENANCE.md |
| 2:40-2:45 | 5 s | End card | `end-card/renders/end-card.mp4` |

Round-1 judges may watch only 60-75 s, often muted. By 1:15 the viewer must have seen: two ways in, four
verdicts with the rule and the evidence, one summary email with a code, Approve, replies sent once, a
second try refused, "always on" on Fly, and the "Was it worth it?" check-in starting. Sections after 1:15
add depth; they are not where the story first appears.

If the cut runs long, drop in this order: learned-preference beat (1:34-1:42, keep 3 s of the Outcomes
panel), chat beat (assistant-ui, keep 3 s), tests beat (keep 3 s), Mastra trace (keep 5 s).

---

## First 30 seconds (word for word)

Voiceover pace about 2.3 words per second. 70 words in total. Captions: the "On-screen caption" lines are
the large top-center text added in the editor; the SRT (`CAPTIONS.srt`) is the spoken words, burned in at the
bottom. Lead channel is the email inbox (the burst of four asks is the strongest single shot); the web paste
box is shown in the same opening frame and used live later (1:34).

Start recording each take on the Desk tab (T1, scrolled to the top) so beat 0:04 is already in frame.

### 0:00-0:04 Title card (4 s)

- **Screen:** title card MP4 ("Fewer - fewer yeses, better ones." Twelve dots, ten fade, two stay).
- **Voiceover (start 0:00.3, 11 words):** "Most agents help you do more. Fewer helps you do less."
- **On-screen caption:** none; the card carries the line.

### 0:04-0:15 Two ways in, four asks (11 s)

- **Screen, in order:**
  1. 0:04-0:10.5, T1 Desk at scroll top, address bar visible (`fewer-rk.fly.dev`). Frame holds the
     "Email asks to `fewer-sf@agentmail.to`" pill (top) and the "Add an ask" box (right). Move the cursor
     from the pill to the box once. Corner tag: `ASKS SENT BEFORE RECORDING`.
  2. 0:10.5-0:15, T2 agent inbox (AgentMail console, `fewer-sf@agentmail.to`). Four messages in the list:
     "Tuesday night at SF Tech Week: AI Agents Builder Night?", "Coffee Tuesday at 10am?",
     "Join our panel next week?", "Feature idea and a quick question". Cursor touches the rows in that
     order, in step with the voiceover (invite, coffee, panel, hijack attempt). Do not open any message.
- **Voiceover (25 words):** "On purpose. It has its own inbox, or I can paste on the Desk. Four asks: an invite,
  a coffee, a panel, a hijack attempt."
- **On-screen captions:**
  - 0:04-0:10.5 `Two ways in: email its own inbox, or paste on the Desk`
  - 0:10.5-0:15 `Four asks. One is a hijack attempt.`

### 0:15-0:23.4 Weigh, check, decide (8.4 s)

- **Screen, in order:**
  1. 0:15-0:18, T1 at 100% zoom, scroll top: Journeys panel (the 3 goals) in the left column, cards on the right.
  2. 0:18-0:21.3, T1: the YES card (Builder Night) header with its rule label (`R3 · TOP-TWO GOAL`) and the
     evidence chips (domains marked "verified"). Hover one chip so its claim shows.
  3. 0:21.3-0:23.4, T1: zoom the browser to 80% (Ctrl-minus twice) so all four card headers (verdict chip +
     rule label) are in frame. If they do not fit, one slow scroll down the four cards. Chips in view:
     YES, SMALLER, ASK ONE, BLOCKED.
- **Voiceover (19 words):** "It weighs them against my three goals, checks who's asking, and plain rules decide:
  yes, smaller, ask one, blocked."
- **On-screen captions:**
  - 0:15-0:18 `Weighed against my 3 goals`
  - 0:18-0:21.3 `Exa: "verified" needs 2+ independent sites`
  - 0:21.3-0:23.4 `YES / SMALLER / ASK ONE / BLOCKED, with the rule that fired`

### 0:23.4-0:30 One summary email, one code, Approve (6.6 s)

- **Screen, in order:**
  1. 0:23.4-0:26.4, T3 approver inbox: the one summary email from `fewer-sf@agentmail.to`; the code is
     highlighted (select it). Reset browser zoom to 100% before this beat.
  2. 0:26.4-0:30, T1 Desk banner: "1 brief awaiting your yes", the single-use code, the countdown by the
     hourglass, the button "Approve & send N replies". Before you click, copy the code (select it, Ctrl+C):
     you need it at 0:37. Click "Approve & send N replies" at about 0:28.5. The receipt
     ("Sent N replies · time · code used") appears and holds about 2.5 s into the next beat.
- **Voiceover (15 words):** "One summary email, one single-use code. I approve once; each reply goes out exactly once."
- **On-screen captions:**
  - 0:23.4-0:26.4 `One summary email. One single-use code.`
  - 0:26.4-0:30 `Approve once. Each reply sent exactly once.`

---

## 0:30-0:44 Sent once, second try refused (14 s)

- **Screen, in order (pick-up clip, recorded right after the Approve click in the same take):**
  1. 0:30-0:33, T1: leave the receipt in frame, then the cards' stage rail reading "Sent".
  2. 0:33-0:37, T4 demo host inbox: refresh. The replies from `fewer-sf@agentmail.to`: one per ask, none
     for "Feature idea and a quick question".
  3. 0:37-0:44, T3 approver inbox: open the summary email, Reply, type `YES ` and paste the copied code,
     Send (show the send for 2 s). Cut the wait (`WAIT CUT`), then show Fewer's answer starting "Not sent:"
     with its reason text readable for 3 s.
- **Gate:** if no "Not sent" email shows within 30 s, do not claim the refusal. Skip step 3, hold on the
  receipt's "code used", and say the fallback line below instead.
- **Voiceover (26 words):** "Each reply goes out once, from its own inbox. Nothing goes to the hijack attempt. Reply with
  the same code again, and it refuses: not sent."
- **Fallback last sentence:** "And the code works once."
- **Captions:** `Each reply sent once, from its own inbox` (0:30-0:37) / `Same code again: refused. Nothing sent.`
  (0:37-0:44)

## 0:44-1:02 How it decides (18 s)

- **Screen, in order (T1; expand each card if it is collapsed):**
  1. 0:44-0:50, YES card: rule label `R3 · TOP-TWO GOAL`, the goal it advances, the evidence chips
     (domains marked "verified"); hover a chip to show the claim.
  2. 0:50-0:56, SMALLER card: `R1 · ABSOLUTE BOUNDARY`, the reasons (the Tuesday deep-work block is
     absolute), the smaller offer. Read the real wording off the card.
  3. 0:56-1:02, BLOCKED card: `R0 · QUARANTINE`; no draft, no evidence chips, "nothing sent".
- **Voiceover (39 words):** "The model only suggests. Plain code decides, and each card shows which rule fired. A coffee
  inside my Tuesday deep-work block gets a smaller offer, not a no. And an email giving orders is quarantined:
  not researched, not obeyed."
- **Captions:** `Model suggests. Plain rules decide.` (0:44-0:47) / `Verified = 2+ independent sites quote it`
  (0:47-0:50) / `Not "no". "Smaller."` (0:50-0:56) / `Orders in an email: quarantined, never obeyed` (0:56-1:02)

## 1:02-1:12 Always on (10 s)

- **Screen, in order:**
  1. 1:02-1:06, Terminal at the repo root: `fly status` already typed, press Enter, hold 3 s. Web and worker
     machines show as started. (If `fly` is not on PATH, use `~/.fly/bin/fly.exe status`. Test it before the
     take. Fallback: Fly dashboard > fewer-rk > Machines.)
  2. 1:06-1:12, T1 Desk with the address bar readable (`fewer-rk.fly.dev`) and the agent-status pill under
     the header.
- **Voiceover (22 words):** "It doesn't live on my laptop. The worker runs on Fly.io, always on, so it keeps working when
  my laptop is closed." (Say "Fly dot I O".)
- **Captions:** `Always on: worker + Desk on Fly.io` (1:02-1:07) / `Password-gated: fewer-rk.fly.dev` (1:07-1:12)

## 1:12-1:42 Proactive (30 s)

- **Screen, in order:**
  1. 1:12-1:16, T1: scroll the left column to the Proactive panel. Hold on "Once an approved yes has ended,
     Fewer asks 'Was it worth it?' by itself."
  2. 1:16-1:20, T1: click "Demo: skip to tomorrow". The `time-skip (demo)` badge appears. Overlay
     `DEMO: SKIPPED TO TOMORROW`.
  3. 1:20-1:26, T3 approver inbox: the check-in "Was it worth it? 1 to 5" (cut the wait, `WAIT CUT`).
     Reply `2 - too loud, left early` (demo persona) and send.
  4. 1:26-1:34, T1 left column: Outcomes panel shows the rating (cut the wait). Click "Run proactive check now
     (demo)". Overlay `DEMO RUN`. Hold on the note "Morning brief emailed (demo run)." and the panel line
     "Latest morning brief ... demo run".
  5. 1:34-1:42, T1: scroll to "Add an ask". Paste the panel text (prepared from
     `npm run seed -- --print --panel2`), leave "Who's asking?" empty, click Decide. Cut the wait
     (`WAIT CUT`). Zoom on the new card's reason line that cites the rating ("You rated a ... 2/5 on ...").
- **Gate:** narrate the last sentence only if that card shows the rating in its reasons. The check-in
  (step 3) only goes out for an approved YES or WILDCARD. If the card does not cite the rating, replace
  step 5 with 3 s of the Outcomes panel and the golden test "learned panel dislike" in
  `fixtures/asks.golden.json`, and say: "A low rating lowers the next ask of that kind."
- **Voiceover (60 words):** "After an event ends, it asks by itself. Here I skip ahead to tomorrow, and it asks: was it worth
  it, one to five. I answer two. Every morning at eight it also emails me a brief; this one is a demo run. A low
  rating counts: paste a similar ask on the Desk, and the card cites my rating."
- **Captions:** `After an event, it asks by itself` (1:12-1:16) / `DEMO: skip to tomorrow` (1:16-1:20) /
  `"Was it worth it? 1-5"  ->  I answer 2` (1:20-1:26) / `Morning brief at 8:00 (this is a demo run)` (1:26-1:34) /
  `A 2/5 changes the next decision` (1:34-1:42)

## 1:42-2:20 Under the hood (38 s)

Intro 3 s, then 5-7 s per piece with one real thing on screen, then 7 s on the tests. Keep keys and tokens
off screen.

| Time | Tab / screen | Do | Voiceover | Caption |
|---|---|---|---|---|
| 1:42-1:45 | Editor or GitHub: repo tree (`src/core`, `src/server`, `src/components`) | Static, slow scroll | "Under the hood: five tools, plus Fly." (7 words) | `Under the hood` |
| 1:45-1:52 | T5 Mastra Platform traces | Open the latest "fewer: parse ask" (email in, JSON out, model span), then "fewer: draft reply" | "Mastra runs the agents, and its platform traces every parse and every draft." (13) | `Mastra: agent runs, traced` |
| 1:52-1:58 | T6 Neon console | Tables view with `actions` open (one row per approval and draft). No connection string. | "Neon: Postgres for every send, plus one gateway credential for Claude Haiku and Sonnet." (14) | `Neon: Postgres + AI Gateway` |
| 1:58-2:03 | T2 AgentMail console | The agent inbox thread list (sent replies visible) | "AgentMail gives it a real inbox, and every send is idempotent." (11) | `AgentMail: its own inbox` |
| 2:03-2:08 | T1 | Back on the YES card: evidence chips, hover one for the claim | "Exa checks who's asking; the quote must be on the page." (11) | `Exa: who's asking, quote on the page` |
| 2:08-2:13 | T1 | Click "Ask Fewer", type `Why was the coffee smaller?`, Enter (cut the wait, `WAIT CUT`) | "assistant-ui builds the Desk and this chat. Ask Fewer why." (10) | `assistant-ui: the Desk + "Ask Fewer"` |
| 2:13-2:20 | Terminal | `npm test` green (needs no keys, DB or network). Read the real count off the screen; say no number. Only if green at record time | "The rules are plain TypeScript with golden-case tests, so every decision repeats." (12) | `Rules = plain code + tests` |

Mastra traces need `MASTRA_PLATFORM_ACCESS_TOKEN` and `MASTRA_PROJECT_ID` on the Fly worker (see
`docs/MASTRA.md`). Check a trace exists for this take's asks before 3:40. If none, show Mastra Studio
(`npm run studio`, localhost:4111, same Postgres) and keep the same voiceover.

## 2:20-2:40 Close (20 s)

- **Screen:** 2:20-2:27 T7 GitHub repo page top (README header, Apache-2.0 badge). 2:27-2:40 scroll to
  PROVENANCE.md (the three-row table).
- **Voiceover (39 words), 2:20-2:27:** "Fewer: fewer yeses, better ones. Built today, open source under Apache 2.0."
  Then 2:27-2:40, slowly: "Patterns ported from my earlier MIT projects; see PROVENANCE.md. Demo inboxes: nothing
  real was booked. I'm building Euzena, to help people make clearer decisions and follow through."
- **On-screen caption 1 (2:20-2:36, exact):**
  `Built today. Open source (Apache-2.0). Patterns ported from my earlier MIT projects (see PROVENANCE.md). Demo inboxes; nothing real was booked.`
- **On-screen caption 2 (2:36-2:40, exact):** `Rahul Krishna, building Euzena: clearer decisions, real follow-through.`
- That is the only Euzena line. No users, no launch, no "live product".

## 2:40-2:45 End card (5 s)

`end-card/renders/end-card.mp4`: repo URL `github.com/Rahul-Innv/Fewer`, "Built with Neon, Mastra, AgentMail, Exa,
assistant-ui" as plain text. It does not list Fly.io (Fly is on screen at 1:02 and named in the voiceover
at 1:42). Optional voiceover: "github.com slash Rahul-Innv slash Fewer."

---

## Pre-flight truth table (do this before take 1, after `npm run demo:prep`)

Read the Desk. The intended set is YES / SMALLER / ASK ONE / BLOCKED. If a verdict differs, swap the matching
line below. Do not narrate a verdict that is not on screen.

| Ask (subject) | Intended | Why it can differ | If it differs, say |
|---|---|---|---|
| "Tuesday night at SF Tech Week: AI Agents Builder Night?" | YES (R3) | YES needs fit 2+ to a top-2 goal AND a claim confirmed on 2+ independent sites with the quote found. The event is real and public (partiful.com, garysguide.com, posthog.com). If Exa cannot confirm, it lands as NO | "The fit is there, but Exa couldn't confirm who's asking, so it says no. Unverified beats a guess." |
| "Coffee Tuesday at 10am?" | SMALLER (R1) | The email says 45 minutes. If the parse drops the length it becomes ASK ONE | "No length parsed, so it asks one question before it decides." |
| "Join our panel next week?" | ASK ONE (R2) | Stable: no date or time always asks | "No date, so it asks one question." |
| "Feature idea and a quick question" | BLOCKED (R0) | Stable if the parser flags the instruction aimed at the agent | (none) |

Other things to confirm:

- The Boundaries panel shows the Tuesday 9:00-12:00 deep-work block before you say it out loud.
- The banner shows the code, a running countdown and "Approve & send N replies". Read N. BLOCKED has no draft,
  so N is probably one less than the asks, but say no number.
- The invite card shows at least two evidence chips marked "verified" before you say "verified".
- At least one ask is an approved YES or WILDCARD, or the time skip sends no check-in. If not, seed one with
  `npm run seed -- --one "Subject|Body"` that you know will be a YES, then re-check the banner.
- The learned-preference beat only lands if the parser tags the pasted panel like the rated ask. Rehearse it
  once on a spare take and read the card; the golden test is the fallback visual.
- The code lasts 30 minutes from the brief. Start approving within about 5 minutes of `demo:prep` finishing.
  If you run late, run `demo:prep` again.
- The Proactive panel may still show an older morning brief before your click. Make sure the timestamp on screen
  is the fresh one before the 1:26-1:34 cut.

## Claims and where each one is true

| Claim in the video | Where it is true |
|---|---|
| Own inbox `fewer-sf@agentmail.to`; web paste | README "What it does"; Desk pill; `AskComposer.tsx` ("Add an ask" > Decide) |
| Rule that fired, evidence chips | `VerdictCard.tsx` (rule label, Evidence chips); `tokens.ts` RULE_NAMES |
| Summary email, single-use code, countdown, Approve & send N replies | `ApprovalBanner.tsx`; README "How it works" 6-7 |
| Each reply once; second try refused | `pipeline.ts` approveByCode ("approval already used or expired"); `actions` unique(approval_id, draft_id); "Not sent: ..." email |
| Always on, password-gated, `fewer-rk.fly.dev` | `fly.toml` (app `fewer-rk`, web + worker); `docs/DEPLOY.md`; `src/proxy.ts` |
| Asks "Was it worth it? 1-5" after an event; morning brief at 8:00 | README "Proactive mode"; `ProactivePanel.tsx`; skip and demo buttons are demo shortcuts |
| A 1 or 2 rating changes the next decision and the card cites it | README step 8; golden case in `fixtures/asks.golden.json` |
| Traces, Neon + AI Gateway (Haiku/Sonnet), AgentMail, Exa, assistant-ui | `docs/MASTRA.md`; README "Built with" |
| Open source, Apache-2.0; patterns from earlier MIT projects | `LICENSE`; `PROVENANCE.md` |
| Euzena | Owner statement; one sentence; no users or product claims |

---

## Takes checklist

Setup (3:20-3:40, before the window opens)

- [ ] `fly status` shows web and worker started. No terminal anywhere is running `npm run worker` or
      `tsx scripts/worker.ts`. Never start a local worker: the Fly worker handles all mail, and two workers
      double-process every email. A local `npm run dev` is not needed (use the Fly Desk); the local Desk is
      only a fallback if fewer-rk.fly.dev is down, and even then no local worker.
- [ ] OBS Display Capture 1920x1080 / 30 fps (Settings > Video: base and output 1920x1080; Output: MKV or
      hybrid MP4, then remux), or one browser window with tabs and OBS Window Capture.
- [ ] Tabs, in this order:
      T1 Desk `https://fewer-rk.fly.dev` (signed in beforehand; the password never on screen),
      T2 agent inbox (AgentMail console, `fewer-sf@agentmail.to`),
      T3 approver inbox (owner demo inbox),
      T4 demo host inbox (where the replies land),
      T5 Mastra Platform traces,
      T6 Neon console,
      T7 GitHub repo (PROVENANCE.md reachable).
      Terminal at the repo root with `fly status` typed but not run. Editor optional.
- [ ] Browser zoom 100% (80% only for the four-header shot), bookmarks bar hidden, notifications and Do Not
      Disturb on, desktop clean, no real email visible anywhere (inbox lists, tab titles, address bar).
- [ ] Panel text for the 1:34 paste ready on the clipboard or in a scratch file:
      `npm run seed -- --print --panel2` prints it without sending. Do NOT run `npm run seed -- --panel2`
      before the paste beat (that would email it instead of showing the web paste).
- [ ] Corner badge `DEMO PERSONA - DEMO INBOXES` ready (add in the editor if not live).
- [ ] Mic check: record 10 s, listen back. Close Slack/Teams/Discord. Plug in power.
- [ ] One dry `npm run demo:prep` finishes without errors and the four verdicts match the truth table.
- [ ] `npm run demo:prep` exists (it was not in `package.json` when this script was written). If it is still
      missing at 3:25, use the same three steps by hand: `npm run demo:reset -- --yes`, `npm run seed`, then
      wait on the Desk until the banner with the code appears.

Per take

- [ ] Run `npm run demo:prep` before every take, off camera. It resets the data (journeys and boundaries
      stay), sends the 4 seed asks from the demo host inbox, and waits for the summary email.
- [ ] Read the Desk against the truth table. Swap any voiceover line that no longer matches.
- [ ] Start recording on T1 at scroll top. Follow the beats in order. Approve within about 5 minutes of
      `demo:prep` finishing (the code lasts 30 minutes).
- [ ] Copy the code (Ctrl+C) before you click Approve at 0:28.5. Then record the 0:30-0:44 pick-up straight
      away: T4 replies, T3 reply `YES <code>`, wait for "Not sent".
- [ ] Wait cuts to label `WAIT CUT (LLM + Exa)`: the "Not sent" email, the check-in email, the rating
      showing on the Desk, the pasted ask's Decide, the Ask Fewer answer, a slow `npm test`.
- [ ] Demo shortcut labels: `DEMO: SKIPPED TO TOMORROW` (skip button), `DEMO RUN` (proactive button).
- [ ] Read the voiceover from this file. About 2.3 words per second. Pause on the chips and the code.
- [ ] Do not mention numbers, users, or "live". Do not read the code out loud, only show it.
- [ ] Between takes, run `demo:prep` again. Never reuse a spent code or an approved brief.

Time plan inside the 3:40-4:00 window

- 3:40-3:44 `demo:prep`, sign-in check, truth table, tabs ready.
- 3:44-3:50 take 1 (full run; waits marked for cutting; raw about 4-5 minutes).
- 3:50-3:52 `demo:prep` again if take 1 is unusable; otherwise record pick-ups (learned-preference paste,
      `npm test`, Mastra trace, Ask Fewer).
- 3:52-3:58 take 2 or pick-ups.
- 3:58-4:00 stop recording, copy the files to one folder, do not delete the raw takes.

## Assembly (after recording; commands run in Git Bash from the repo root)

Edit in any editor (Windows Clipchamp, DaVinci Resolve, CapCut). The ffmpeg route below keeps the voiceover
and the screen from one recording and drops the two cards on top.

1. Cut `main.mp4` to 2:45 or less so that the first 4 s is a throwaway screen and the last 5 s is a
   throwaway screen; the cards cover them. The voiceover audio is kept as recorded.
2. Burn the captions. The SRT covers 0:00-0:30 (the spoken words). Add the top-center caption lines and the
   badges (`WAIT CUT`, `DEMO: SKIPPED TO TOMORROW`, `DEMO RUN`, `ASKS SENT BEFORE RECORDING`) in the editor,
   and the SRT-style spoken captions for the rest if time allows.

```bash
cd video
ffmpeg -i ../main.mp4 -vf "subtitles=CAPTIONS.srt:force_style='FontName=Arial,FontSize=20,Bold=1,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,BorderStyle=3,Outline=2,Shadow=0,MarginV=60,Alignment=2'" -c:v libx264 -pix_fmt yuv420p -c:a copy ../main-captioned.mp4
cd ..
```

(Tested earlier on a synthetic 30 s clip: the captions render, and the card overlay below shows the title card
at the start, the screen in the middle, and the end card at the end. `main.mp4` is your recording, saved in the
repo root. The SRT was retimed for the new opening; it was not re-run through ffmpeg.)

3. Overlay the title card (first 4 s) and end card (last 5 s):

```bash
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 main-captioned.mp4)
S=$(awk -v d="$D" 'BEGIN{printf "%.3f", d-5}')
ffmpeg -i main-captioned.mp4 -i video/title-card/renders/title-card.mp4 -itsoffset "$S" -i video/end-card/renders/end-card.mp4 \
  -filter_complex "[0:v]scale=1920:1080,fps=30,format=yuv420p[m];[m][1:v]overlay=0:0:enable='lt(t,4)':eof_action=pass[a];[a][2:v]overlay=0:0:enable='gte(t,$S)':eof_action=pass[v]" \
  -map "[v]" -map 0:a -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k fewer-demo-final.mp4
```

Check `fewer-demo-final.mp4` runs 2:45 or less (never over 3:00) and that the first frame is the title card.

## Upload checklist (YouTube, done by 4:18)

- [ ] Upload starts by 4:08 at the latest (a 2:45 1080p file is small, but processing takes minutes).
- [ ] Visibility: Unlisted or Public (match what the hackathon form asks for). Not Private.
- [ ] Title: `Fewer: an agent that helps you do less, on purpose (Build Personal Agents Hack)`
- [ ] Description:
      ```
      Most agents help you do more. Fewer helps you do less, on purpose.
      Fewer has its own AgentMail inbox (fewer-sf@agentmail.to) and an "Add an ask" box on its web Desk. It weighs each ask against the owner's 3 goals, Exa checks who is asking, and plain rules decide YES / SMALLER / ASK ONE / BLOCKED / NO, showing the rule that fired. One summary email carries a single-use code; approve once and each reply goes out exactly once. It runs as an always-on worker on Fly.io, asks "Was it worth it? 1-5" after an event, and sends a morning brief at 8:00. A low rating changes later decisions.
      Stack: Neon (Postgres + AI Gateway), Mastra, AgentMail, Exa, assistant-ui, Fly.io.
      Repo (Apache-2.0): https://github.com/Rahul-Innv/Fewer
      Built today at the Build Personal Agents Hack, San Francisco. Patterns ported from my earlier MIT projects (see PROVENANCE.md in the repo). Demo persona and demo inboxes; nothing real was booked. The skip-to-tomorrow and the proactive check in the video are demo shortcuts.
      ```
- [ ] Audience: "No, it's not made for kids." Upload CAPTIONS.srt only if it matches the final timing
      (the burned-in captions already cover muted viewing).
- [ ] Thumbnail: use `video/title-card/stills/title-card.png` (1920x1080).
- [ ] Open the link in an incognito window: video plays, shows 1080p after processing, sound works, the
      description and repo link are visible. Paste that incognito URL into the submission.
- [ ] Repo `https://github.com/Rahul-Innv/Fewer` opens in the same incognito window (public), PROVENANCE.md and
      the Apache-2.0 LICENSE visible.
