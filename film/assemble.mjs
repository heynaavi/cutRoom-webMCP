/**
 * Cut the film together.
 *
 *   1. every segment normalised to 1920×1080 / 30fps / yuv420p
 *   2. the rendered vertical short composited into its plate
 *   3. one xfade chain, so the whole thing is a single continuous edit
 *   4. an audio bed with cues placed against the real segment offsets
 *
 * CRF 18 and yuv420p, not the defaults: these frames are flat colour and
 * hard-edged type, and default compression leaves visible mosquito noise around
 * the mono labels — on a file YouTube is going to re-encode again anyway.
 *
 *   node assemble.mjs <workDir> <outFile>
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [W, OUT] = process.argv.slice(2);
const CLIPS = join(W, "clips");
mkdirSync(CLIPS, { recursive: true });

const ff = (args, label) => {
  try { execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { console.error(`\n[${label}] failed:\n${e.stderr?.toString().slice(-1800)}`); throw e; }
};
const dur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
  "-of", "default=nw=1:nk=1", f]).toString().trim();

const FADE = 0.4;          // dip between segments
const beats = JSON.parse(readFileSync(join(W, "app", "beats.json"), "utf8"));
const beatFps = Object.fromEntries(beats.map((b) => [b.name, b.fps]));

/* ── the edit ──────────────────────────────────────────────────────────────
   `cues` are sound events in seconds from the START of that segment, so the
   timings survive a segment being retimed or moved. */
const EDIT = [
  { id: "s1",      kind: "card", cues: [["mark", 0.15]] },
  { id: "s2",      kind: "card", cues: [["swish", 0.2], ["tick", 1.6], ["tick-2", 2.1],
                                        ["land", 4.0], ["swish-soft", 5.2]] },
  { id: "s3",      kind: "card", cues: [["swish", 0.2], ["tick-3", 1.7]] },
  { id: "arrive",  kind: "app",  cues: [["tick", 0.5], ["tick-2", 2.2]] },
  { id: "s5",      kind: "card", cues: [["swish", 0.2], ["confirm", 3.1]] },
  { id: "energy",  kind: "app",  cues: [["tick-3", 0.4]] },
  { id: "propose", kind: "app",  cues: [["land", 0.6]] },
  { id: "s8",      kind: "card", cues: [["swish", 0.2], ["tick", 1.2], ["tick-2", 1.35], ["tick-3", 1.5]] },
  { id: "playing", kind: "app",  cues: [["swish-soft", 0.2]] },
  { id: "check",   kind: "app",  cues: [["tick", 0.5]] },
  { id: "clean",   kind: "app",  cues: [["cut", 0.9], ["cut", 1.15], ["cut", 1.42], ["cut", 1.7]] },
  { id: "s12",     kind: "card", cues: [["swish", 0.2], ["tick", 1.7], ["confirm", 3.4]] },
  { id: "output",  kind: "output", cues: [] },        // carries the real cut audio
  { id: "s13",     kind: "card", cues: [["resolve", 0.2]] },
];

/* ── 1 · normalise every segment ───────────────────────────────────────── */
// The screencast frames are JPEG, which decodes as full-range, and libx264
// happily carries that through as yuvj420p — which players and social
// re-encoders then read as limited range and wash out. Converting the levels
// explicitly (not just tagging them) is what keeps the paper the same colour
// in a card and in a screenshot of the app.
const V = "scale=1920:1080:force_original_aspect_ratio=decrease:in_range=full:out_range=tv,"
        + "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf1f0ec,setsar=1,format=yuv420p";
const ENC = ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
             "-color_range", "tv", "-colorspace", "bt709",
             "-color_primaries", "bt709", "-color_trc", "bt709", "-r", "30", "-an"];

for (const seg of EDIT) {
  const out = join(CLIPS, `${seg.id}.mp4`);
  if (seg.kind === "card") {
    const dir = join(W, "frames", seg.id);
    ff(["-framerate", "30", "-i", join(dir, "%05d.png"), "-vf", V, ...ENC, out], seg.id);
  } else if (seg.kind === "app") {
    const dir = join(W, "app", seg.id);
    // The screencast ran at ~93fps; conform it to 30 rather than letting ffmpeg
    // assume the input was already 30 and stretch the beat to three times its
    // length.
    ff(["-framerate", String(beatFps[seg.id]), "-i", join(dir, "%05d.jpg"), "-vf", V, ...ENC, out], seg.id);
  } else if (seg.kind === "output") {
    // The app's own render, laid into the plate's slot. 540×960 at 1250,60 —
    // the rect is fixed in slot.html and must not drift from this.
    const short = join(W, "short.mp4");
    ff(["-loop", "1", "-i", join(W, "slot-bg.png"), "-i", short,
        "-filter_complex", "[1:v]scale=540:960,setsar=1[v];[0:v][v]overlay=1250:60:shortest=1[o]",
        "-map", "[o]", "-t", "18", ...ENC, out], seg.id);
  }
  seg.file = out;
  seg.dur = dur(out);
  console.log(`  ${seg.id.padEnd(9)} ${seg.dur.toFixed(2)}s`);
}

/* ── 2 · one xfade chain ───────────────────────────────────────────────── */
// Each segment overlaps the next by FADE, so the running offset is the sum of
// everything before it minus one fade per join already made.
let filter = "";
let prev = "0:v";
let offset = 0;
EDIT.forEach((seg, i) => {
  if (i === 0) { offset = seg.dur - FADE; return; }
  const label = i === EDIT.length - 1 ? "vout" : `x${i}`;
  filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[${label}];`;
  prev = label;
  offset += seg.dur - FADE;
});
const TOTAL = offset + FADE;
console.log(`\ntotal ${TOTAL.toFixed(2)}s (${Math.floor(TOTAL / 60)}:${String(Math.round(TOTAL % 60)).padStart(2, "0")})`);

const silent = join(W, "silent.mp4");
ff([...EDIT.flatMap((s) => ["-i", s.file]),
    "-filter_complex", filter.replace(/;$/, ""),
    "-map", "[vout]", ...ENC, silent], "xfade");

/* ── 3 · the audio ─────────────────────────────────────────────────────── */
// Segment start times on the FINISHED timeline, so a cue written as "1.6s into
// s2" lands where s2 actually begins after the fades have eaten into it.
const starts = {};
let at = 0;
EDIT.forEach((seg, i) => { starts[seg.id] = at; at += seg.dur - (i < EDIT.length - 1 ? FADE : 0); });
// Written out so the narration mix (mix-vo.py) places each line against the
// real segment starts rather than a copy of this table.
writeFileSync(join(W, "starts.json"), JSON.stringify(starts, null, 1));

const inputs = [];
const chains = [];
let n = 0;

// bed, looped under the whole film and ducked to almost nothing
inputs.push("-stream_loop", "-1", "-i", join(W, "sfx", "bed.wav"));
chains.push(`[${n}:a]atrim=0:${TOTAL.toFixed(2)},volume=0.9[a${n}]`);
const parts = [`[a${n}]`]; n++;

for (const seg of EDIT) {
  for (const [cue, t] of seg.cues) {
    const ms = Math.max(0, Math.round((starts[seg.id] + t) * 1000));
    inputs.push("-i", join(W, "sfx", `${cue}.wav`));
    chains.push(`[${n}:a]adelay=${ms}|${ms},volume=0.85[a${n}]`);
    parts.push(`[a${n}]`); n++;
  }
}

// The real cut, under the output segment. This is the only sound in the film
// that is not synthesised, and it is the whole point of the film.
const cutMs = Math.round(starts.output * 1000);
inputs.push("-i", join(W, "cut.m4a"));
chains.push(`[${n}:a]atrim=0:17.6,afade=t=in:st=0:d=0.35,afade=t=out:st=16.6:d=1.0,adelay=${cutMs}|${cutMs},volume=1.0[a${n}]`);
parts.push(`[a${n}]`); n++;

const amix = `${chains.join(";")};${parts.join("")}amix=inputs=${parts.length}:duration=longest:normalize=0,alimiter=limit=0.95,atrim=0:${TOTAL.toFixed(2)}[aout]`;
const audio = join(W, "score.m4a");
ff([...inputs, "-filter_complex", amix, "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", audio], "audio");

/* ── 4 · mux ───────────────────────────────────────────────────────────── */
ff(["-i", silent, "-i", audio, "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT], "mux");

console.log(`\n→ ${OUT}`);
console.log(execFileSync("ffprobe", ["-v", "error", "-show_entries",
  "format=duration,size:stream=codec_name,width,height,r_frame_rate", "-of", "default=nw=1", OUT]).toString());
