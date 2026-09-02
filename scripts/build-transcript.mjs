// Turn a YouTube json3 auto-caption file into the app's transcript shape.
// json3 gives word-level offsets; we flatten to words, then group words into
// sentence-ish segments on punctuation or a speech gap.
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
const j = JSON.parse(readFileSync(inPath, "utf8"));

// ── words ────────────────────────────────────────────────────────────────────
const words = [];
for (const ev of j.events ?? []) {
  if (!ev.segs) continue;
  for (const s of ev.segs) {
    const text = (s.utf8 ?? "").replace(/\n/g, " ");
    if (!text.trim()) continue;
    const start = (ev.tStartMs + (s.tOffsetMs ?? 0)) / 1000;
    words.push({ word: text.trim(), start });
  }
}
words.sort((a, b) => a.start - b.start);
// De-dupe: rolling auto-captions repeat the tail of the previous cue.
const uniq = [];
for (const w of words) {
  const prev = uniq[uniq.length - 1];
  if (prev && prev.word === w.word && Math.abs(prev.start - w.start) < 0.01) continue;
  uniq.push(w);
}
// End time = next word's start, capped so a pause doesn't stretch a word.
uniq.forEach((w, i) => {
  const next = uniq[i + 1];
  w.end = next ? Math.min(next.start, w.start + 1.2) : w.start + 0.4;
  w.wi = i;
});

// ── segments ─────────────────────────────────────────────────────────────────
// Break on sentence punctuation, on a >0.6s gap, or after 26 words.
const GAP = 0.6, MAX_WORDS = 26;
const segments = [];
let cur = [];
const flush = () => {
  if (!cur.length) return;
  segments.push({
    start: +cur[0].start.toFixed(2),
    end: +cur[cur.length - 1].end.toFixed(2),
    text: cur.map((w) => w.word).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
    wi0: cur[0].wi,
    wi1: cur[cur.length - 1].wi,
  });
  cur = [];
};
uniq.forEach((w, i) => {
  cur.push(w);
  const next = uniq[i + 1];
  const gap = next ? next.start - w.end : Infinity;
  if (/[.!?]$/.test(w.word) || gap > GAP || cur.length >= MAX_WORDS) flush();
});
flush();

const duration = uniq.length ? +(uniq[uniq.length - 1].end).toFixed(2) : 0;
const out = {
  words: uniq.map((w) => ({ wi: w.wi, word: w.word, start: +w.start.toFixed(2), end: +w.end.toFixed(2) })),
  segments,
  durationSec: duration,
};
writeFileSync(outPath, JSON.stringify(out));
console.log(`words=${out.words.length} segments=${segments.length} duration=${(duration / 60).toFixed(1)}min`);
const medLen = segments.map((s) => s.text.split(" ").length).sort((a, b) => a - b)[Math.floor(segments.length / 2)];
console.log(`median segment: ${medLen} words`);
console.log(`sample @20min:`, segments.find((s) => s.start > 1200)?.text.slice(0, 90));
