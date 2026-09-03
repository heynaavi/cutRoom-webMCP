/**
 * Synthesis primitives, reused from the VoiceDumps launch-film pipeline
 * (same author, MIT). Nothing here is downloaded and the noise source is a
 * seeded PRNG, so the score is as reproducible as the frames.
 *
 * Two signatures to watch, because getting them wrong fails silently rather
 * than loudly: makeLP/makeHP take (sample, cutoffHz) — omitting the cutoff
 * makes every sample NaN — and chord() takes voices as { f, g } objects, not
 * bare frequencies. Both produce a valid WAV file full of zeroes.
 */
/**
 * Shared DSP for the synthesised sound kits.
 *
 * Extracted so the film's tonal palette does not have to re-implement envelopes
 * and filters. Deliberately *not* imported by scripts/make-sfx.mjs: that script
 * produces the audio for four approved cuts, and the only way to guarantee those
 * renders stay byte-identical is to not touch the file at all.
 *
 * Everything here is deterministic. The noise source is a seeded PRNG rather than
 * Math.random, so a rebuild produces the same bytes and the audio is as
 * reproducible as the frames.
 */
export const RATE = 48000;

/** Deterministic PRNG (mulberry32), so "noise" is the same noise every run. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const len = (seconds) => Math.max(1, Math.round(seconds * RATE));

/** Raised-cosine window — for swells, which must not click at the edges. */
export function bell(i, n) {
  return 0.5 - 0.5 * Math.cos((i / Math.max(1, n - 1)) * Math.PI * 2);
}

/** One-pole low-pass. `cut` in Hz. */
export function makeLP() {
  let z = 0;
  return (x, cut) => {
    const c = Math.exp((-2 * Math.PI * cut) / RATE);
    z = x * (1 - c) + z * c;
    return z;
  };
}

/** One-pole high-pass, as input minus its low-passed self. */
export function makeHP() {
  const lp = makeLP();
  return (x, cut) => x - lp(x, cut);
}

/** Peak-normalise, then scale to `peak`. */
export function normalise(buf, peak = 0.9) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** A few milliseconds of fade at each end, so no cue starts with a DC step. */
export function deClick(buf, ms = 4) {
  const n = Math.round((ms / 1000) * RATE);
  for (let i = 0; i < n && i < buf.length; i++) {
    const g = i / n;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  return buf;
}

/**
 * A struck tone with a long decay — the film's core voice.
 *
 * Glass rather than piano: the partials are stretched slightly sharp of the true
 * harmonic series, which is what a struck solid actually does and what stops a
 * stack of sines from sounding like a test tone. The strike itself is a few
 * milliseconds of filtered noise, enough to imply a mallet without a click.
 *
 * Lower notes get longer decays, as they would on any real instrument.
 */
export function struckTone(freq, { seconds = 2.6, decay = 2.4, seed = 7, air = 0.05 } = {}) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp = makeLP();
  const buf = new Float32Array(n);

  // Stretched partials. The 1.002 exponent is the inharmonicity.
  const partials = [
    { mult: 1, g: 1.0, d: 1.0 },
    { mult: 2.004, g: 0.3, d: 1.5 },
    { mult: 3.012, g: 0.13, d: 2.1 },
    { mult: 4.02, g: 0.06, d: 2.8 },
    { mult: 5.9, g: 0.03, d: 3.4 },
  ];

  for (let i = 0; i < n; i++) {
    const t = i / n;
    // 9ms attack: soft enough to feel struck rather than clicked.
    const attack = Math.min(1, i / (0.009 * RATE));
    let s = 0;
    for (const p of partials) {
      s +=
        Math.sin((2 * Math.PI * freq * p.mult * i) / RATE) *
        p.g *
        Math.exp(-decay * p.d * t);
    }
    // The mallet.
    const strike = lp(rand() * 2 - 1, 2600) * Math.exp(-90 * t) * air;
    buf[i] = s * attack * 0.3 + strike;
  }
  return deClick(normalise(buf, 0.8), 3);
}

/**
 * A sustained bed. Slow filter and amplitude drift so it breathes instead of
 * sitting still, which is the difference between atmosphere and a sine wave.
 */
export function drone(root, { seconds = 9, seed = 3, voices = null, peak = 0.6 } = {}) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp = makeLP();
  const buf = new Float32Array(n);
  const stack = voices ?? [
    { f: root, g: 0.5 },
    { f: root * 2, g: 0.3 },
    { f: root * 3, g: 0.12 },
    { f: root * 4.5, g: 0.05 },
  ];

  for (let i = 0; i < n; i++) {
    const t = i / n;
    // Long fade in, longer fade out: the bed should never announce itself.
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.6);
    const wobble = 1 + 0.05 * Math.sin(t * 5.5) + 0.03 * Math.sin(t * 13.1);
    let s = 0;
    for (const v of stack) {
      s += Math.sin((2 * Math.PI * v.f * i) / RATE + Math.sin(t * 2.1) * 0.3) * v.g;
    }
    const air = lp(rand() * 2 - 1, 900 + 500 * Math.sin(t * 3.3)) * 0.05;
    buf[i] = (s * 0.3 + air) * shape * wobble;
  }
  return deClick(normalise(buf, peak), 60);
}

/** A chord that arrives and is allowed to sit. */
export function chord(freqs, { seconds = 4, attack = 0.13, decay = 1.5, seed = 11 } = {}) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp = makeLP();
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = Math.min(1, i / (attack * RATE));
    const e = a * Math.exp(-decay * t);
    let s = 0;
    for (const f of freqs) {
      s +=
        Math.sin((2 * Math.PI * f.f * i) / RATE + Math.sin(t * 1.1) * 0.05) * f.g +
        Math.sin((2 * Math.PI * f.f * 2.003 * i) / RATE) * f.g * 0.1;
    }
    const air = lp(rand() * 2 - 1, 2400) * 0.04 * a * Math.exp(-2.2 * t);
    buf[i] = s * e * 0.3 + air;
  }
  return deClick(normalise(buf, 0.82), 14);
}

export function writeWavBuffer(buf) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * A drone whose pitch slides from one root to another.
 *
 * Older Than Writing needs the bed to descend continuously across twenty seconds as the
 * year counter runs backwards, so the audience feels the fall into deep time without
 * being told about it. A glissando rather than discrete steps is the whole difference
 * between reading as *distance* and reading as *loss* — steps are what Unfinished uses
 * for lost thoughts, and these two films must not sound like each other.
 *
 * The slide is exponential in frequency, which is linear in perceived pitch. A linear
 * frequency ramp spends most of its time sounding like it has already arrived.
 */
export function droneGlide(rootStart, rootEnd, { seconds = 20, seed = 5, peak = 0.5 } = {}) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp = makeLP();
  const buf = new Float32Array(n);
  const ratios = [1, 2, 3, 4.5];
  const gains = [0.5, 0.3, 0.12, 0.05];

  // Phase has to be integrated rather than computed from t, because the frequency is
  // changing: `sin(2π f(t) t)` produces audible discontinuities, `∫f dt` does not.
  const phases = new Float32Array(ratios.length);

  for (let i = 0; i < n; i++) {
    const t = i / n;
    const root = rootStart * Math.pow(rootEnd / rootStart, t);
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.55);
    const wobble = 1 + 0.04 * Math.sin(t * 6.1);

    let s = 0;
    for (let v = 0; v < ratios.length; v++) {
      phases[v] += (2 * Math.PI * root * ratios[v]) / RATE;
      s += Math.sin(phases[v]) * gains[v];
    }
    const air = lp(rand() * 2 - 1, 700 + 400 * Math.sin(t * 3.1)) * 0.045;
    buf[i] = (s * 0.3 + air) * shape * wobble;
  }
  return deClick(normalise(buf, peak), 60);
}

/**
 * A drier, woodier struck tone. Wood rather than glass.
 *
 * Write-Only sounds the same note forty times, and `struckTone`'s stretched partials and
 * long air tail are lovely once but turn to soup under that much repetition. This has
 * fewer partials, no inharmonicity to speak of, and a fast decay — closer to a
 * woodblock with a pitch than to a bell. It survives being played over and over, which
 * is the only thing it has to do.
 */
export function woodTone(freq, { seconds = 0.9, decay = 7, seed = 41 } = {}) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp = makeLP();
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const attack = Math.min(1, i / (0.003 * RATE));
    const body =
      Math.sin((2 * Math.PI * freq * i) / RATE) * Math.exp(-decay * t) +
      Math.sin((2 * Math.PI * freq * 2 * i) / RATE) * 0.18 * Math.exp(-decay * 2.2 * t);
    const knock = lp(rand() * 2 - 1, 1800) * Math.exp(-70 * t) * 0.28;
    buf[i] = (body * 0.4 + knock) * attack;
  }
  return deClick(normalise(buf, 0.75), 2);
}

/**
 * A granular rush — a page riffled, not a whoosh.
 *
 * For the moment an hour of speech arrives as text at once. Band-limited noise with a
 * fast irregular amplitude grain, swelling and falling. A conventional filtered-sweep
 * whoosh reads as a transition; this needs to read as *quantity*.
 */
export function riffle({ seconds = 2.6, seed = 909, peak = 0.5 } = {}) {
  const n = len(seconds);
  const rand = prng(seed);
  const lp = makeLP();
  const hp = makeHP();
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // Grain rate climbs through the swell: more pages, faster.
    const rate = 30 + 90 * t;
    const grain = 0.45 + 0.55 * Math.abs(Math.sin(t * seconds * rate));
    const noise = hp(lp(rand() * 2 - 1, 2600 + 2200 * t), 700);
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.7);
    buf[i] = noise * grain * shape;
  }
  return deClick(normalise(buf, peak), 10);
}
