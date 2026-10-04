// Narrated assembly: title card + shots from record-vo.mjs + end card, each narration line placed at
// its shot start (adelay), shots padded (last frame held) so every line fits, UI waits sped up with an
// on-screen "sped up" label, burned-in captions matching the spoken lines, loudness -16 LUFS.
// Usage: node video/tools/assemble-vo.mjs --take video/out/final-take --out video/out/fewer-final.mp4 [--drive video/out/fewer-final-drive.mp4] [--banner "DRY RUN"]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.resolve(here, "..");
const OUTDIR = path.join(VIDEO, "out");
const VO = path.join(OUTDIR, "vo");
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const TAKE = path.resolve(opt("take", path.join(OUTDIR, "final-take")));
const OUT = path.resolve(opt("out", path.join(OUTDIR, "fewer-final.mp4")));
const DRIVE = opt("drive") ? path.resolve(opt("drive")) : null;
const BANNER = opt("banner", null);
const VOICE = opt("voice", "en-US-AndrewMultilingualNeural");
const TITLE = path.join(VIDEO, "title-card/renders/logo-title.mp4");
const END = path.join(VIDEO, "end-card/renders/end-card.mp4");
const probe = (f) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());

const data = JSON.parse(fs.readFileSync(`${TAKE}.shots.json`, "utf8"));
const CLIP = `${TAKE}.webm`;
const lines = fs.readFileSync(path.join(VO, "lines.txt"), "utf8").split(/\r?\n/).filter(Boolean);
const capText = Object.fromEntries(lines.map((l, i) => [i + 1, l]));

// Line 3 follows what the Before view actually showed.
const W = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const T = { 2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety" };
const words = (n) => (n < 20 ? W[n] : T[Math.floor(n / 10)] + (n % 10 ? "-" + W[n % 10] : ""));
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const { total, clash } = data.facts ?? {};
if (total && clash) {
  const part = clash.h >= 17 ? "evening" : clash.h >= 12 ? "afternoon" : "morning";
  const spoken = `This is a real Tech Week calendar. ${cap(words(total))} invites, with ${words(clash.n)} events at the same time on Tuesday ${part}.`;
  capText[3] = `This is a real Tech Week calendar. ${total} invites, with ${clash.n} events at the same time on Tuesday ${part}.`;
  const f3 = path.join(VO, "l3.mp3");
  const prev = fs.existsSync(path.join(VO, "l3.txt")) ? fs.readFileSync(path.join(VO, "l3.txt"), "utf8") : "";
  if (prev !== spoken) {
    const r = spawnSync("python", ["-m", "edge_tts", "--voice", VOICE, "--text", spoken, "--write-media", f3], { encoding: "utf8" });
    if (r.status === 0) fs.writeFileSync(path.join(VO, "l3.txt"), spoken);
    else console.log("line 3 TTS failed, keeping old", r.stderr);
  }
  console.log("line 3:", spoken);
}
const voFile = (n) => path.join(VO, `l${n}.mp3`);
const voLen = (n) => probe(voFile(n));

// Which shots survive.
const used = data.shots.filter((s) => {
  if (s.skipped) return false;
  if (s.n === 5 && !data.dry && (/>\s*25|partial/.test(s.note) || (s.total ?? 0) > 20)) return false;
  if (s.n === 10 && /partial/.test(s.note)) return false;
  return true;
});
const dropped = data.shots.filter((s) => !used.includes(s)).map((s) => `${s.n} ${s.name} (${s.note || "skipped"})`);

const titleD = probe(TITLE), endD = probe(END);
const titleLen = Math.max(titleD, voLen(1) + 0.9);
const endLen = Math.max(endD, voLen(11) + 1.2);

// Build pieces.
const pieces = []; // {from,to,factor,pad,label,shot}
const shotStarts = {};
let t = titleLen;
const labels = [];
if (BANNER) labels.push({ a: titleLen, b: 9999, text: BANNER, top: false });
const srcMap = []; // {from,to,factor,fa}
for (let i = 0; i < used.length; i++) {
  const s = used[i];
  const a = i === 0 ? data.startAt : s.a;
  const b = s.b;
  shotStarts[s.n] = t;
  const sp = s.speed.filter((r) => r.to > r.from + 0.5).sort((x, y) => x.from - y.from);
  let cur = a;
  const mine = [];
  for (const r of sp) {
    const f0 = Math.max(cur, r.from), f1 = Math.min(b, r.to);
    if (f1 <= f0) continue;
    if (f0 > cur) mine.push({ from: cur, to: f0, factor: 1 });
    mine.push({ from: f0, to: f1, factor: r.factor, label: `sped up ${r.factor}x` });
    cur = f1;
  }
  if (cur < b) mine.push({ from: cur, to: b, factor: 1 });
  let len = 0;
  for (const p of mine) {
    p.fa = t + len;
    len += (p.to - p.from) / p.factor;
    if (p.label) labels.push({ a: p.fa, b: p.fa + (p.to - p.from) / p.factor, text: p.label });
    srcMap.push(p);
  }
  const need = voLen(s.n) + 0.6;
  if (len < need) { mine[mine.length - 1].pad = need - len; len = need; }
  for (const L of s.labels ?? []) {
    const p = mine.find((q) => L.from >= q.from && L.from <= q.to) ?? mine[0];
    const fa = p.fa + (L.from - p.from) / p.factor;
    labels.push({ a: fa, b: Math.min(fa + (L.to - L.from), t + len), text: L.text });
  }
  pieces.push(...mine);
  t += len;
}
const clipEnd = t;
const totalLen = clipEnd + endLen;

// Narration placement.
const place = [{ n: 1, at: 0.35 }];
const shotLen = {};
used.forEach((s, i) => { shotLen[s.n] = (i + 1 < used.length ? shotStarts[used[i + 1].n] : clipEnd) - shotStarts[s.n]; });
// Line 3 lands late in its shot so "Tuesday" is spoken while Tuesday's clash markers are on screen.
for (const s of used) place.push({ n: s.n, at: shotStarts[s.n] + (s.n === 3 ? Math.max(0.25, shotLen[3] - voLen(3) - 1.0) : 0.25) });
place.push({ n: 11, at: clipEnd + 0.35 });

// Captions: split each spoken line into short chunks timed by length.
const chunk = (s) => {
  const out = [];
  for (const sent of s.match(/[^.!?:]+[.!?:]?/g).map((x) => x.trim()).filter(Boolean)) {
    if (sent.length <= 64) { out.push(sent); continue; }
    const parts = sent.split(/,\s*/);
    let acc = "";
    for (const p of parts) {
      const next = acc ? `${acc}, ${p}` : p;
      if (next.length > 64 && acc) { out.push(acc + ","); acc = p; } else acc = next;
    }
    if (acc) out.push(acc);
  }
  for (let i = 0; i < out.length - 1; i++) if (out[i].length < 22 && (out[i] + out[i + 1]).length < 80) { out.splice(i, 2, `${out[i]} ${out[i + 1]}`); i--; }
  return out.map((c) => c.replace(/:$/, "").replace(/[–—]/g, ","));
};
const ts = (x) => {
  const ms = Math.max(0, Math.round(x * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const srt = [];
let k = 0;
for (const p of place) {
  const d = voLen(p.n);
  const cs = chunk(capText[p.n]);
  const tot = cs.reduce((x, c) => x + c.length, 0);
  let at = p.at;
  cs.forEach((c, i) => {
    const len = (d * c.length) / tot;
    const end = i === cs.length - 1 ? p.at + d + 0.35 : at + len;
    srt.push(`${++k}\n${ts(at)} --> ${ts(end)}\n${c}\n`);
    at += len;
  });
}
const SRTF = OUT.replace(/\.mp4$/, ".srt");
fs.writeFileSync(SRTF, srt.join("\n"));

// Filter graph.
const FONT = "fontfile='C\\:/Windows/Fonts/arialbd.ttf'";
const norm = "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF3F1EC,fps=30,setsar=1,format=yuv420p";
const clipW = Number(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", CLIP], { encoding: "utf8" }).stdout.trim());
const crop = clipW > 1300 ? "crop=1280:720:0:0," : "";
const f = [];
f.push(`[0:v]${norm},tpad=stop_mode=clone:stop_duration=${(titleLen - titleD + 0.1).toFixed(3)},trim=duration=${titleLen.toFixed(3)},setpts=PTS-STARTPTS[t]`);
pieces.forEach((p, i) => {
  const pad = p.pad ? `,tpad=stop_mode=clone:stop_duration=${p.pad.toFixed(3)}` : "";
  f.push(`[1:v]trim=start=${p.from.toFixed(3)}:end=${p.to.toFixed(3)},setpts=(PTS-STARTPTS)/${p.factor},${crop}${norm}${pad}[c${i}]`);
});
f.push(`${pieces.map((_, i) => `[c${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0[clip]`);
f.push(`[2:v]${norm},tpad=stop_mode=clone:stop_duration=${(endLen - endD + 0.1).toFixed(3)},trim=duration=${endLen.toFixed(3)},setpts=PTS-STARTPTS[e]`);
f.push(`[t][clip][e]concat=n=3:v=1:a=0[cat]`);
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
const chain = [];
// Cover the Next.js dev indicator (bottom-left) during the Desk footage.
chain.push(`drawbox=x=0:y=978:w=215:h=102:color=0xF3F1EC@1:t=fill:enable='between(t,${titleLen.toFixed(3)},${clipEnd.toFixed(3)})'`);
for (const l of labels) {
  const y = l.top === false ? "h-th-40" : "36";
  chain.push(`drawtext=${FONT}:text='${esc(l.text)}':fontsize=40:fontcolor=black:box=1:boxcolor=0xFFC400@0.97:boxborderw=16:x=(w-tw)/2:y=${y}:enable='between(t,${l.a.toFixed(3)},${Math.min(l.b, clipEnd).toFixed(3)})'`);
}
chain.push(`subtitles=${path.basename(SRTF)}:force_style='FontName=Arial,FontSize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00141414,BackColour=&H00141414,BorderStyle=3,Outline=3,Shadow=0,MarginV=30,MarginL=70,MarginR=70,Alignment=2'`);
f.push(`[cat]${chain.join(",")},format=yuv420p[v]`);
const aIn = place.map((p, i) => `[${3 + i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(p.at * 1000)}|${Math.round(p.at * 1000)}[a${i}]`);
f.push(...aIn);
f.push(`${place.map((_, i) => `[a${i}]`).join("")}amix=inputs=${place.length}:normalize=0:dropout_transition=0,apad,atrim=0:${totalLen.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

const args = ["-y", "-v", "error", "-nostats", "-i", TITLE, "-i", CLIP, "-i", END];
for (const p of place) args.push("-i", voFile(p.n));
args.push("-filter_complex", f.join(";"), "-map", "[v]", "-map", "[aout]",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", totalLen.toFixed(3), OUT);
console.log(`title ${titleLen.toFixed(2)} + clip ${(clipEnd - titleLen).toFixed(2)} + end ${endLen.toFixed(2)} = ${totalLen.toFixed(2)} s; dropped: ${dropped.join("; ") || "none"}`);
const r = spawnSync("ffmpeg", args, { stdio: "inherit", cwd: path.dirname(SRTF) });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("wrote", OUT, probe(OUT).toFixed(2), "s");
fs.writeFileSync(OUT.replace(/\.mp4$/, ".timeline.json"), JSON.stringify({ titleLen, shotStarts, clipEnd, endLen, totalLen, place, labels, dropped }, null, 2));

if (DRIVE) {
  const kbps = Math.floor((9.3 * 8 * 1000) / totalLen) - 72;
  const common = ["-i", OUT, "-vf", "scale=1280:720:flags=lanczos", "-c:v", "libx264", "-preset", "medium", "-b:v", `${kbps}k`, "-pix_fmt", "yuv420p", "-r", "30"];
  const pl = path.join(OUTDIR, "x264pass");
  spawnSync("ffmpeg", ["-y", "-v", "error", ...common, "-pass", "1", "-passlogfile", pl, "-an", "-f", "mp4", "NUL"], { stdio: "inherit" });
  spawnSync("ffmpeg", ["-y", "-v", "error", ...common, "-pass", "2", "-passlogfile", pl, "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", DRIVE], { stdio: "inherit" });
  console.log("drive", DRIVE, (fs.statSync(DRIVE).size / 1048576).toFixed(2), "MB", `(${kbps}k video)`);
}
