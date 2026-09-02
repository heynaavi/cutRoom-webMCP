/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS — the editorial craft, encoded.

   Three things a good editor does that keyword search cannot:

   1. Hears where the energy is. The most clippable moment in an hour is rarely
      the smartest sentence; it's where someone's voice lifts. We have the RMS
      envelope of the real audio, so we can find that — and an agent reading a
      transcript has no other way to know it happened.
   2. Cuts on breath. A splice mid-word or mid-breath sounds broken no matter
      how good the line is.
   3. Checks the joins. A clip opening "and he said that" is half a sentence
      with no antecedent — fine in the episode, meaningless in a short.
   ═══════════════════════════════════════════════════════════════════════════ */
const Analysis = (() => {
  const P = () => window.PEAKS || null;
  const D = () => Store.state.source.durationSec || 0;
  const idxAt = (t) => { const p = P(); return p ? Math.max(0, Math.min(p.length - 1, Math.floor((t / D()) * p.length))) : 0; };
  const secPer = () => { const p = P(); return p ? D() / p.length : 0.11; };

  /* ── energy ─────────────────────────────────────────────────────────────── */
  // Level relative to the LOCAL baseline, not the whole file. A quiet speaker
  // getting animated matters as much as a loud one; what we want is the lift,
  // not the absolute volume.
  function energyProfile() {
    const p = P();
    if (!p) return null;
    const sp = secPer();
    const win = Math.round(45 / sp);                 // ±45s of context
    const out = new Float32Array(p.length);
    let sum = 0, n = 0;
    // running mean via prefix sums, so this stays cheap over 21k buckets
    const pre = new Float64Array(p.length + 1);
    for (let i = 0; i < p.length; i++) pre[i + 1] = pre[i] + p[i];
    for (let i = 0; i < p.length; i++) {
      const a = Math.max(0, i - win), b = Math.min(p.length, i + win);
      const base = (pre[b] - pre[a]) / (b - a);
      out[i] = base > 0.01 ? p[i] / base : 1;
      sum += out[i]; n++;
    }
    return { rel: out, mean: sum / n, sp };
  }

  /* Passages where the voice lifts above its own local baseline. */
  function energyMoments({ limit = 12, minSec = 2.5, maxSec = 14 } = {}) {
    const prof = energyProfile();
    if (!prof) return [];
    const { rel, sp } = prof;
    const THRESH = 1.14;                             // 14% above local baseline
    const runs = [];
    let start = -1;
    for (let i = 0; i < rel.length; i++) {
      if (rel[i] >= THRESH) { if (start < 0) start = i; }
      else if (start >= 0) {
        const secs = (i - start) * sp;
        if (secs >= 1.2) runs.push({ i0: start, i1: i, secs });
        start = -1;
      }
    }
    return runs
      .map((r) => {
        let peak = 0;
        for (let k = r.i0; k < r.i1; k++) peak = Math.max(peak, rel[k]);
        // widen to the transcript lines the run touches, so it's a sayable unit
        const t0 = r.i0 * sp, t1 = r.i1 * sp;
        const segs = Store.state.segments.filter((s) => s.end > t0 && s.start < t1);
        if (!segs.length) return null;
        const start = segs[0].start, end = segs[segs.length - 1].end;
        if (end - start < minSec || end - start > maxSec) return null;
        return {
          startSec: +start.toFixed(2), endSec: +end.toFixed(2),
          lift: +peak.toFixed(2),
          text: segs.map((s) => s.text).join(" "),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.lift - a.lift)
      .slice(0, limit);
  }

  /* ── breath ─────────────────────────────────────────────────────────────── */
  // Quiet stretches long enough to be a pause rather than a gap between words.
  function breaths() {
    const p = P();
    if (!p) return [];
    const sp = secPer();
    const sorted = [...p].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.18)];   // quietest fifth
    const out = [];
    let run = -1;
    for (let i = 0; i < p.length; i++) {
      if (p[i] <= floor) { if (run < 0) run = i; }
      else if (run >= 0) {
        if ((i - run) * sp >= 0.16) out.push({ start: run * sp, end: i * sp, mid: ((run + i) / 2) * sp });
        run = -1;
      }
    }
    return out;
  }

  /* Nearest pause to a time — where a cut will sound deliberate. */
  function nearestBreath(t, maxDrift = 1.4) {
    let best = null, bd = Infinity;
    for (const b of breaths()) {
      const d = Math.abs(b.mid - t);
      if (d < bd) { bd = d; best = b; }
    }
    return best && bd <= maxDrift ? +best.mid.toFixed(2) : null;
  }

  /* ── flow ───────────────────────────────────────────────────────────────── */
  const DANGLING = /^(and |but |so |then |because |which |that'?s |he |she |it |they |this |that |those |these |there )/i;
  const NAMEY = /\b([A-Z][a-z]{2,})\b/;

  /* Everything wrong with the cut as it stands, in the order it matters. */
  function checkFlow() {
    const clips = Store.live();
    const issues = [];
    if (!clips.length) return issues;
    const breathList = breaths();

    // The hook decides everything. A first clip that needs setup is a dead clip.
    const first = clips[0];
    if (DANGLING.test(first.text)) {
      issues.push({ clipIndex: 0, severity: "high", kind: "weak-hook",
        detail: `The cut opens on “${first.text.slice(0, 48)}…” — it starts mid-thought, so the first three seconds ask the viewer to catch up.`,
        fix: "Open on a line that stands alone, or trim this clip's head to the start of its sentence." });
    }
    if (first.end - first.start > 9) {
      issues.push({ clipIndex: 0, severity: "medium", kind: "slow-hook",
        detail: `The opening clip runs ${(first.end - first.start).toFixed(1)}s before anything else happens.`,
        fix: "Trim it, or lead with a shorter line and let this one land second." });
    }

    clips.forEach((c, i) => {
      // Pronoun with nothing to point at inside the cut.
      const m = /^(he|she|they|it|that|this|those)\b/i.exec(c.text.trim());
      if (m && i > 0) {
        const before = clips.slice(0, i).map((x) => x.text).join(" ");
        if (!NAMEY.test(before)) {
          issues.push({ clipIndex: i, severity: "medium", kind: "dangling-reference",
            detail: `Clip ${i + 1} opens with “${m[1]}” but nothing before it in the cut says who that is.`,
            fix: "Add a line that names them, or trim this clip's head past the pronoun." });
        }
      }
      // Sentence sheared off at either end.
      if (!/[.!?]["'’”)]?$/.test(c.text.trim())) {
        issues.push({ clipIndex: i, severity: "low", kind: "unfinished",
          detail: `Clip ${i + 1} ends mid-sentence: “…${c.text.slice(-42)}”`,
          fix: "Extend the tail to the end of the sentence with trimClip." });
      }
      // A clean in-point has a pause ending just before it. Asking "is there
      // speech here" flags everything, since clips start on word onsets.
      const preceded = breathList.some((b) => b.end > c.start - 0.45 && b.end <= c.start + 0.12);
      if (!preceded) {
        issues.push({ clipIndex: i, severity: "low", kind: "hard-in",
          detail: `Clip ${i + 1} cuts in mid-flow — there's no pause immediately before it, so the join will sound abrupt.`,
          fix: `Call snapToBreath on clip ${i + 1}.` });
      }
    });

    const total = Store.reelDur(), target = Store.state.targetSec;
    if (total > target) {
      issues.push({ clipIndex: null, severity: "high", kind: "over-budget",
        detail: `The cut is ${Math.round(total)}s against a ${target}s target.`,
        fix: `Drop the weakest clip or trim ${Math.ceil(total - target)}s across several.` });
    }
    if (clips.length > 1 && Store.spread() < 0.12) {
      issues.push({ clipIndex: null, severity: "medium", kind: "narrow-spread",
        detail: "Every clip comes from the same stretch of the episode, so this plays as an excerpt rather than a story.",
        fix: "Replace one or two clips with moments from elsewhere in the recording." });
    }
    const order = { high: 0, medium: 1, low: 2 };
    return issues.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /* ── tidy ───────────────────────────────────────────────────────────────── */
  // Fillers only matter at the EDGES of a clip. Mid-sentence "you know" is how
  // people talk; a clip that opens on "Um, so" wastes the three seconds that
  // decide whether anyone watches.
  const FILLER = /^(um|uh|er|ah|hmm|so|and|but|like|okay|ok|yeah|right|well|i mean|you know|sort of|kind of)$/i;

  function tidyEdges(clip) {
    const ws = Store.state.words.filter((w) => w.start >= clip.start - 0.05 && w.end <= clip.end + 0.05);
    if (ws.length < 4) return null;
    const clean = (w) => w.word.replace(/[^a-z']/gi, "").toLowerCase();
    let a = 0, b = ws.length - 1;
    while (a < b - 2 && FILLER.test(clean(ws[a]))) a++;
    while (b > a + 2 && FILLER.test(clean(ws[b]))) b--;
    if (a === 0 && b === ws.length - 1) return null;
    return { start: ws[a].start, end: ws[b].end, dropped: [
      ...ws.slice(0, a).map((w) => w.word), ...ws.slice(b + 1).map((w) => w.word)] };
  }

  /* ── phrases ────────────────────────────────────────────────────────────── */
  // Transcript lines are an artefact of how the words were grouped, not a unit
  // of meaning. The sayable thing is often a phrase inside one line, or a run
  // that straddles two. Word timings mean we can address any of it exactly.
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();

  /* Locate a phrase in the recording and return its exact word boundaries. */
  function findPhrase(phrase, { nearSec = null, limit = 5 } = {}) {
    const words = Store.state.words;
    if (!words.length) return [];
    const want = norm(phrase).split(" ").filter(Boolean);
    if (!want.length) return [];
    const flat = words.map((w) => norm(w.word));
    const hits = [];
    for (let i = 0; i + want.length <= flat.length; i++) {
      let ok = true;
      for (let k = 0; k < want.length; k++) {
        if (flat[i + k] !== want[k]) { ok = false; break; }
      }
      if (ok) {
        const a = words[i], b = words[i + want.length - 1];
        hits.push({
          startSec: +a.start.toFixed(2), endSec: +b.end.toFixed(2),
          durationSec: +(b.end - a.start).toFixed(2),
          text: words.slice(i, i + want.length).map((w) => w.word).join(" "),
        });
      }
    }
    if (nearSec != null) hits.sort((x, y) => Math.abs(x.startSec - nearSec) - Math.abs(y.startSec - nearSec));
    return hits.slice(0, limit);
  }

  /* Word boundaries for an arbitrary time range — used when a person
     drag-selects text and we need the span that actually contains it. */
  function spanForWords(wi0, wi1) {
    const w = Store.state.words;
    const a = w[Math.max(0, Math.min(w.length - 1, wi0))];
    const b = w[Math.max(0, Math.min(w.length - 1, wi1))];
    if (!a || !b) return null;
    return { start: +Math.min(a.start, b.start).toFixed(2), end: +Math.max(a.end, b.end).toFixed(2) };
  }

  /* Slack inside a clip: hesitation words if the transcript kept them, and
     over-long pauses whether it did or not.

     Transcription models usually strip "um" and "uh" — whisper removed every
     one from this recording — so a word-based filler remover is inert on a
     clean transcript. The hesitation is still THERE in the audio, as dead air.
     Reading the envelope catches it either way, which is the point of having
     the audio at all. */
  const MID_FILLER = /^(um|uh|er|erm|ah|hmm|mhm)$/i;

  function slackIn(clip, { keepSec = 0.28 } = {}) {
    const cuts = [];
    const ws = Store.state.words.filter((w) => w.start >= clip.start && w.end <= clip.end);

    for (const w of ws) {
      if (MID_FILLER.test(w.word.replace(/[^a-z]/gi, ""))) {
        cuts.push({ start: Math.max(clip.start, w.start - 0.04), end: Math.min(clip.end, w.end + 0.06), why: w.word });
      }
    }

    // Dead air between words, trimmed back to a natural beat rather than removed
    // outright — cutting every pause makes people sound like machines.
    for (const b of breaths()) {
      if (b.start <= clip.start + 0.15 || b.end >= clip.end - 0.15) continue;
      const len = b.end - b.start;
      if (len <= keepSec + 0.22) continue;
      cuts.push({ start: +(b.start + keepSec / 2).toFixed(2), end: +(b.end - keepSec / 2).toFixed(2),
                  why: `${len.toFixed(1)}s pause` });
    }
    return cuts.sort((a, b) => a.start - b.start);
  }

  /* ── stammers ───────────────────────────────────────────────────────────── */
  // "I— I mean" and "that uh that" are the same event: a false start, then the
  // real one. Keeping the second attempt and cutting the first is what an
  // editor does by ear; the tell in the data is a word repeating within a beat.
  function stammersIn(from, to) {
    const ws = Store.state.words.filter((w) => w.start >= from && w.end <= to);
    const bare = (w) => w.word.toLowerCase().replace(/[^a-z']/g, "");
    const out = [];
    for (let i = 1; i < ws.length; i++) {
      const a = bare(ws[i - 1]), b = bare(ws[i]);
      if (!a || a.length > 6) continue;
      const gap = ws[i].start - ws[i - 1].end;
      if (a === b && gap < 0.9) {
        // drop the FIRST attempt, keep the clean one
        out.push({ start: +ws[i - 1].start.toFixed(2), end: +ws[i].start.toFixed(2), why: `repeated “${ws[i - 1].word}”` });
      }
    }
    // "we were in—" style false starts: a dash or a trailing cut-off word
    for (const w of ws) {
      if (/[—–-]$/.test(w.word) && w.word.length > 1) {
        out.push({ start: +w.start.toFixed(2), end: +Math.min(to, w.end + 0.05).toFixed(2), why: `false start “${w.word}”` });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /* Every occurrence of a phrase across the whole recording. */
  function findAll(phrase) { return findPhrase(phrase, { limit: 500 }); }

  return { energyMoments, breaths, nearestBreath, checkFlow, tidyEdges, findPhrase,
           findAll, spanForWords, slackIn, stammersIn, norm };
})();
