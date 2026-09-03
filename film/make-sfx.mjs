/**
 * Cutroom's score, synthesised.
 *
 * Generated rather than sourced for the reasons that matter to a hackathon
 * submission: nothing is downloaded, so there is no licence to track and no
 * third-party material in a video whose rules forbid exactly that; the noise
 * source is a seeded PRNG, so the audio is as reproducible as the frames; and a
 * cue that has to land on frame 214 is retuned by editing a number.
 *
 * The register is an interface, not a mood. This is a product demo: the sounds
 * are a mark being struck, a panel arriving, a tool returning, a cut landing.
 * Percussive, dry, quiet — the film is going to be narrated over, and a score
 * that competes with a voice is a score that gets muted.
 *
 * Tonal centre is A, and every pitched cue is a scale degree of A minor
 * pentatonic, so cues that overlap at a crossfade cannot clash.
 *
 *   node make-sfx.mjs <outDir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RATE, len, prng, normalise, deClick, makeLP, makeHP,
  struckTone, chord, writeWavBuffer,
} from "./lib/dsp.mjs";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const N = { A2: 110, E3: 164.81, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63,
            G4: 392, A4: 440, B4: 493.88, C5: 523.25, E5: 659.25 };

const mix = (...bufs) => {
  const n = Math.max(...bufs.map((b) => b.length));
  const out = new Float32Array(n);
  for (const b of bufs) for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
};
const gain = (b, g) => { const o = new Float32Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b[i] * g; return o; };
const delay = (b, seconds) => {
  const off = len(seconds);
  const o = new Float32Array(b.length + off);
  o.set(b, off);
  return o;
};

/* ── mark: the four bars of the logo being struck ───────────────────────────
   Four pentatonic degrees, 90ms apart, rising. It is the sound of the wordmark
   assembling and it is the only cue in the kit that is allowed to be pretty. */
function mark() {
  const notes = [N.A3, N.C4, N.E4, N.A4];
  const parts = notes.map((f, i) =>
    delay(gain(struckTone(f, { seconds: 2.2 - i * 0.15, decay: 3.2 + i * 0.5, seed: 11 + i, air: 0.03 }), 0.5 - i * 0.06), i * 0.09));
  return normalise(deClick(mix(...parts)), 0.62);
}

/* ── tick: a tool call returning ───────────────────────────────────────────
   40ms, no pitch to speak of, just a filtered click with a tiny body. The
   ledger fills with these and they must never become a rhythm you notice. */
function tick(seed = 21, tone = 2600) {
  const n = len(0.05);
  const rand = prng(seed);
  const hp = makeHP();
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 190);
    const noise = hp((rand() * 2 - 1) * 0.55, 900);   // cut in Hz — omitting it makes the filter return NaN
    const body = Math.sin(2 * Math.PI * tone * t) * 0.22 * Math.exp(-t * 320);
    buf[i] = (noise + body) * env;
  }
  return normalise(deClick(buf, 2), 0.34);
}

/* ── swish: a panel arriving ───────────────────────────────────────────────
   Filtered noise with a rising then falling cutoff. Short, so it reads as a
   move rather than as wind. */
function swish(seed = 33, seconds = 0.42) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp = makeLP();
  const hp = makeHP();
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * t) ** 1.7;
    let s = (rand() * 2 - 1);
    s = hp(s, 320);
    // The cutoff opens and closes across the gesture — a fixed one reads as a
    // hiss, a moving one reads as a move.
    const cut = 700 + 3600 * Math.sin(Math.PI * t);
    buf[i] = lp(s, cut) * env * 1.6;
  }
  return normalise(deClick(buf, 6), 0.30);
}

/* ── land: five clips arriving on the reel ─────────────────────────────────
   Five soft wooden taps, accelerating very slightly, because a metronome
   reads as machinery and this is meant to read as things being placed. */
function land() {
  const gaps = [0, 0.135, 0.26, 0.375, 0.48];
  const parts = gaps.map((g, i) =>
    delay(gain(struckTone([N.E3, N.A3, N.C4, N.D4, N.E4][i], { seconds: 0.9, decay: 9, seed: 41 + i, air: 0.02 }), 0.4), g));
  return normalise(deClick(mix(...parts)), 0.42);
}

/* ── cut: a word being removed ─────────────────────────────────────────────
   A short downward chirp. Four of these fire during the cleanup beat, one per
   hesitation struck out. */
function cutTick(seed = 77) {
  const n = len(0.09);
  const rand = prng(seed);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 1400 - 900 * (i / n);
    const env = Math.exp(-t * 60) * (1 - i / n);
    buf[i] = (Math.sin(2 * Math.PI * f * t) * 0.6 + (rand() * 2 - 1) * 0.12) * env;
  }
  return normalise(deClick(buf, 3), 0.30);
}

/* ── confirm: the manifest handed over ─────────────────────────────────────
   Two notes, a fifth apart, the resolution the film has been withholding. */
function confirm() {
  return normalise(deClick(mix(
    gain(struckTone(N.A4, { seconds: 1.6, decay: 4.5, seed: 5 }), 0.45),
    delay(gain(struckTone(N.E5, { seconds: 1.9, decay: 4.0, seed: 6 }), 0.36), 0.11),
  )), 0.46);
}

/* ── resolve: the end card ─────────────────────────────────────────────────
   A minor add9, held. Same tonal centre the mark struck at 0:00, so the film
   ends on the note it opened with. */
function resolve() {
  // chord() wants voices as { f, g } — handing it bare numbers makes every
  // sample NaN, which writes out as a silent file rather than an error.
  return normalise(deClick(chord([
    { f: N.A2, g: 1.00 }, { f: N.E3, g: 0.62 }, { f: N.A3, g: 0.52 },
    { f: N.C4, g: 0.40 }, { f: N.E4, g: 0.30 }, { f: N.B4, g: 0.16 },   // the add9
  ], { seconds: 5.2, attack: 0.22, decay: 1.5, seed: 17 })), 0.40);
}

/* ── bed: a room to sit the cues in ────────────────────────────────────────
   Barely audible. Its whole job is to stop the silences between cues sounding
   like the file has stopped. */
function bed(seconds = 30, seed = 101) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp1 = makeLP(), lp2 = makeLP(), lp3 = makeLP();
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = (rand() * 2 - 1);
    s = lp3(lp2(lp1(s, 220), 180), 140);   // three poles ≈ a room, not a hiss
    const t = i / RATE;
    const drift = 1 + 0.12 * Math.sin(t * 0.21) + 0.07 * Math.sin(t * 0.53);
    buf[i] = s * drift;
  }
  // fade both ends so it can be looped or butt-joined without a step
  const f = len(1.2);
  for (let i = 0; i < f; i++) { buf[i] *= i / f; buf[n - 1 - i] *= i / f; }
  return normalise(buf, 0.030);
}

const kit = {
  "mark.wav": mark(),
  "tick.wav": tick(21),
  "tick-2.wav": tick(22, 3100),
  "tick-3.wav": tick(23, 2150),
  "swish.wav": swish(33),
  "swish-soft.wav": swish(34, 0.55),
  "land.wav": land(),
  "cut.wav": cutTick(77),
  "confirm.wav": confirm(),
  "resolve.wav": resolve(),
  "bed.wav": bed(40),
};

for (const [name, buf] of Object.entries(kit)) {
  writeFileSync(join(OUT, name), writeWavBuffer(buf));
  console.log(`  ${name.padEnd(15)} ${(buf.length / RATE).toFixed(2)}s`);
}
