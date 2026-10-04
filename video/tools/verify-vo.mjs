// Probe a narrated cut and pull one frame per shot midpoint into <out>/final-frames (or --frames dir).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
const OUT = path.resolve(argv[0]);
const FR = path.resolve(argv[1] ?? path.join(path.dirname(OUT), "final-frames"));
fs.mkdirSync(FR, { recursive: true });
const tl = JSON.parse(fs.readFileSync(OUT.replace(/\.mp4$/, ".timeline.json"), "utf8"));
const p = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate,pix_fmt,sample_rate", "-of", "compact", OUT], { encoding: "utf8" });
console.log(p.stdout);
const starts = Object.entries(tl.shotStarts).map(([n, a]) => [Number(n), a]).sort((x, y) => x[1] - y[1]);
const pts = [];
starts.forEach(([n, a], i) => pts.push([`shot${n}`, (a + (i + 1 < starts.length ? starts[i + 1][1] : tl.clipEnd)) / 2]));
pts.unshift(["title", tl.titleLen / 2]);
pts.push(["end", tl.clipEnd + tl.endLen / 2]);
for (const [name, t] of pts) {
  spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", OUT, "-frames:v", "1", "-vf", "scale=1280:-1", path.join(FR, `${name}.png`)]);
  console.log(name, t.toFixed(2));
}
