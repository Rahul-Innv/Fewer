// Assemble: title card + recorded clip + end card -> one 1920x1080 30 fps H.264 yuv420p MP4 with a silent
// AAC track, a corner "DEMO PERSONA - DEMO INBOXES" badge over the clip, optional on-screen labels for
// sped-up / time-skipped ranges, and burned-in captions from an SRT written in FINAL-TIMELINE seconds.
//
// Usage (from the repo root):
//   node video/tools/assemble.mjs --clip video/out/backup-desk.webm --ss 6 --to 77.5 \
//     --srt video/out/draft-cut.srt --out video/out/draft-cut.mp4
// Options:
//   --clip <file>       recorded clip (webm/mp4), any size; scaled to 1920x1080
//   --ss <s> --to <s>   trim range inside the clip (seconds)
//   --speed <file>      optional JSON [{ "from": 20, "to": 35, "factor": 4, "label": "4x - LLM wait cut" }]
//                       (source-clip seconds); those ranges are sped up and labelled on screen
//   --label "<a>-<b>|TEXT"  extra on-screen label (final-timeline seconds), repeatable,
//                       e.g. --label "40-46|DEMO: TIME SKIPPED TO TOMORROW"
//   --srt <file>        captions in final-timeline time (title card starts at 0)
//   --title/--end <f>   override card files; --no-badge; --max <s> (default 170)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.resolve(here, "..");

function parseArgs(argv) {
  const o = { label: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (k === "label") o.label.push(v);
    else o[k] = v;
  }
  return o;
}
const o = parseArgs(process.argv.slice(2));
const TITLE = path.resolve(o.title ?? path.join(VIDEO, "title-card/renders/title-card.mp4"));
const END = path.resolve(o.end ?? path.join(VIDEO, "end-card/renders/end-card.mp4"));
const CLIP = o.clip ? path.resolve(o.clip) : null;
const OUT = path.resolve(o.out ?? path.join(VIDEO, "out/draft-cut.mp4"));
const SRT = o.srt ? path.resolve(o.srt) : null;
const MAX = Number(o.max ?? 170);
if (!CLIP) throw new Error("--clip is required");

function probe(f) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" });
  return Number(r.stdout.trim());
}
const titleD = probe(TITLE);
const endD = probe(END);
const clipFull = probe(CLIP);
const ss = Number(o.ss ?? 0);
const to = Number(o.to ?? clipFull);

// Speed ranges (source seconds) -> piecewise segments.
const speeds = o.speed ? JSON.parse(fs.readFileSync(path.resolve(o.speed), "utf8")) : [];
const pieces = [];
{
  let cur = ss;
  for (const s of [...speeds].sort((a, b) => a.from - b.from)) {
    if (s.from > cur) pieces.push({ from: cur, to: Math.min(s.from, to), factor: 1 });
    pieces.push({ from: Math.max(s.from, ss), to: Math.min(s.to, to), factor: s.factor, label: s.label });
    cur = s.to;
  }
  if (cur < to) pieces.push({ from: cur, to, factor: 1 });
}
let t = titleD;
const autoLabels = [];
for (const p of pieces) {
  const len = (p.to - p.from) / p.factor;
  if (p.label) autoLabels.push({ a: t, b: t + len, text: p.label });
  t += len;
}
const clipD = t - titleD;
const total = titleD + clipD + endD;
if (total > MAX) throw new Error(`total ${total.toFixed(2)} s exceeds --max ${MAX} s; trim the clip`);

const labels = [
  ...autoLabels,
  ...o.label.map((s) => {
    const m = /^([\d.]+)-([\d.]+)\|(.+)$/.exec(s);
    if (!m) throw new Error(`bad --label ${s}`);
    return { a: Number(m[1]), b: Number(m[2]), text: m[3] };
  }),
];

// drawtext needs ':' and '\'' escaped inside quoted text; keep labels plain.
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
const FONT = "fontfile='C\\:/Windows/Fonts/arialbd.ttf'";
const norm = "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF3F1EC,fps=30,setsar=1,format=yuv420p";

const f = [];
f.push(`[0:v]${norm},trim=duration=${titleD},setpts=PTS-STARTPTS[t]`);
pieces.forEach((p, i) => {
  f.push(`[1:v]trim=start=${p.from}:end=${p.to},setpts=(PTS-STARTPTS)/${p.factor},${norm}[c${i}]`);
});
f.push(`${pieces.map((_, i) => `[c${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0[clip]`);
f.push(`[2:v]${norm},trim=duration=${endD},setpts=PTS-STARTPTS[e]`);
f.push(`[t][clip][e]concat=n=3:v=1:a=0[cat]`);
let last = "cat";
const chain = [];
const clipA = titleD.toFixed(3);
const clipB = (titleD + clipD).toFixed(3);
if (!o["no-badge"]) {
  // Bottom-left badge (also covers the Next.js dev indicator in local recordings).
  chain.push(`drawbox=x=0:y=978:w=600:h=102:color=0xF3F1EC@1:t=fill:enable='between(t,${clipA},${clipB})'`);
  chain.push(
    `drawtext=${FONT}:text='DEMO PERSONA - DEMO INBOXES':fontsize=30:fontcolor=white:box=1:boxcolor=0x1B1D21@0.92:boxborderw=14:x=28:y=1080-th-34:enable='between(t,${clipA},${clipB})'`,
  );
}
for (const l of labels) {
  chain.push(
    `drawtext=${FONT}:text='${esc(l.text)}':fontsize=40:fontcolor=black:box=1:boxcolor=0xFFC400@0.97:boxborderw=16:x=(w-tw)/2:y=40:enable='between(t,${l.a.toFixed(3)},${l.b.toFixed(3)})'`,
  );
}
let srtName = null;
if (SRT) {
  srtName = path.basename(SRT);
  chain.push(
    `subtitles=${srtName}:force_style='FontName=Arial,FontSize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00141414,BackColour=&H00141414,BorderStyle=3,Outline=3,Shadow=0,MarginV=34,MarginL=60,MarginR=60,Alignment=2'`,
  );
}
if (chain.length) {
  f.push(`[${last}]${chain.join(",")},format=yuv420p[v]`);
  last = "v";
}

const args = [
  "-y", "-v", "error", "-nostats",
  "-i", TITLE,
  "-i", CLIP,
  "-i", END,
  "-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
  "-filter_complex", f.join(";"),
  "-map", `[${last}]`, "-map", "3:a",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "128k",
  "-movflags", "+faststart",
  "-t", total.toFixed(3),
  OUT,
];
console.log(`title ${titleD}s + clip ${clipD.toFixed(2)}s + end ${endD}s = ${total.toFixed(2)}s`);
const r = spawnSync("ffmpeg", args, { stdio: "inherit", cwd: SRT ? path.dirname(SRT) : process.cwd() });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("wrote", OUT, "duration", probe(OUT).toFixed(2), "s");
