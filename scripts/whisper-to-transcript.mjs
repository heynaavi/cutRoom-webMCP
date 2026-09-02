// whisper.cpp -ml 1 output → Cutroom transcript.
// Tokens arrive one per entry with punctuation as its own token, so glue
// punctuation back onto the preceding word before grouping into lines.
import { readFileSync, writeFileSync } from "node:fs";
const [, , inPath, outPath, title, credit] = process.argv;
const j = JSON.parse(readFileSync(inPath, "utf8"));

const words = [];
for (const e of j.transcription ?? []) {
  const src = e.text ?? "";
  const raw = src.replace(/\s+/g, " ").trim();
  if (!raw || raw === "[BLANK_AUDIO]") continue;
  const start = (e.offsets?.from ?? 0) / 1000;
  const end = (e.offsets?.to ?? 0) / 1000;
  const prev = words[words.length - 1];
  // whisper.cpp emits one TOKEN per entry, not one word. A token that does not
  // begin with a space is a subword continuation ("Ir"+"vine", "Ch"+"esh"+"ire")
  // and must be glued on, or the transcript reads as gibberish. Same for
  // punctuation, which always arrives as its own token.
  const isPunct = /^[,.!?;:'’”)\]]+$/.test(raw);
  const isContinuation = !/^\s/.test(src);
  if (prev && (isPunct || isContinuation)) { prev.word += raw; prev.end = end; continue; }
  words.push({ word: raw, start, end });
}
words.forEach((w, i) => { w.wi = i; if (w.end <= w.start) w.end = w.start + 0.12; });

// Group into lines that can stand alone: sentence end, a real pause, or length.
const GAP = 0.55, MAX = 26;
const segments = [];
let cur = [];
const flush = () => {
  if (!cur.length) return;
  const text = cur.map((w) => w.word).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
  if (text) segments.push({ start: +cur[0].start.toFixed(2), end: +cur[cur.length - 1].end.toFixed(2), text });
  cur = [];
};
words.forEach((w, i) => {
  cur.push(w);
  const gap = words[i + 1] ? words[i + 1].start - w.end : Infinity;
  if (/[.!?]["'’”)]?$/.test(w.word) || gap > GAP || cur.length >= MAX) flush();
});
flush();

const out = {
  title: title || "Untitled",
  credit: credit || "",
  durationSec: +(words.length ? words[words.length - 1].end : 0).toFixed(2),
  words: words.map((w) => ({ wi: w.wi, word: w.word, start: +w.start.toFixed(2), end: +w.end.toFixed(2) })),
  segments,
};
writeFileSync(outPath, JSON.stringify(out));
const lens = segments.map((s) => s.text.split(" ").length).sort((a, b) => a - b);
console.log(`words=${out.words.length} lines=${segments.length} duration=${(out.durationSec/60).toFixed(1)}min median=${lens[Math.floor(lens.length/2)]}w`);
console.log("early :", segments.find(s=>s.start>60)?.text.slice(0,88));
console.log("mid   :", segments.find(s=>s.start>1100)?.text.slice(0,88));
console.log("late  :", segments.find(s=>s.start>2000)?.text.slice(0,88));
