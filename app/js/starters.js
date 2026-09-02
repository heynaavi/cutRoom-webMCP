/* ═══════════════════════════════════════════════════════════════════════════
   STARTERS — heuristic cuts for when no agent is connected.

   This is the control condition. It reads only the text, and it is honest about
   that: no audio, no understanding, just shape and keywords. But "not clever"
   was never an excuse for "bad" — a proposal that opens on a dangling pronoun
   or a half-question makes the whole page look broken, and a judge with no
   WebMCP browser sees this and nothing else.

   So the rules here are the ones an editor applies before taste even starts:
   a clip has to stand alone, resolve, and not be the host talking.
   ═══════════════════════════════════════════════════════════════════════════ */
const Starters = (() => {
  /* Three angles, and they differ by more than a word list. "The arc" is
     positional — earliest, middle, latest — because a life story is told in
     order. The other two lean on vocabulary, which is all a keyword search has.
     Any angle that can't fill itself honestly returns nothing rather than
     padding. */
  const ANGLES = [
    { title: "The arc", desc: "Where it started, what turned it, where it landed.",
      seeds: [] },
    { title: "The hard part", desc: "Doubt, setbacks, the bit nobody puts on a poster.",
      seeds: ["hard", "difficult", "tough", "failed", "failure", "rejected", "reject", "doubt",
              "scared", "afraid", "fear", "nervous", "shaking", "cried", "struggle", "gave up",
              "give up", "didn't think", "didn't know", "couldn't", "wrong", "no idea", "mistake",
              "pressure", "terrified"] },
    { title: "What they'd tell you", desc: "Advice and intent, straight to camera.",
      seeds: ["advice", "tell you", "tell people", "if you", "you have to", "you can", "my advice",
              "keep going", "don't give up", "believe", "apply", "applied", "anyone can", "just start",
              "would tell", "my goal", "hoping", "hope", "encourage", "instill", "learn", "teach"] },
  ];

  /* Show furniture: intros, sign-offs, plugs. A person throws these out first,
     so they never reach the scoring. */
  const BOILERPLATE = /\b(welcome to|this is the .*podcast|i'?m your host|will be your host|thanks for listening|thanks for joining|subscribe|follow us|social media|check out our|episode \d|you'?re listening to|find us on|show notes|that'?s all the time|we'?ll be right back)\b/i;

  /* No speaker labels in the transcript, so shape is the only tell. A short
     second-person question is the host nearly every time, and an answer read
     without its question is half a conversation. */
  const HOST_ASK = /^(so |and |now |okay,? )?(did|can|could|do|does|what|how|when|where|why|who|tell me|walk me|were|was|have|has|had|would|will|is|are)\b/i;

  /* The host, not the guest, even when it isn't phrased as a question. An
     interviewer talks *about* you; a guest talks about themselves. */
  const HOST_TELL = /\b(your bio|let'?s talk about|tell me about|tell us about|thanks for (joining|being|coming)|welcome (back )?to|read off|i'?m just going to read|you'?re (scheduled|going) to|you'?ve (also )?(worked|been|done|got|had)|you went (back|on|to)|before we (start|begin|wrap))\b/i;

  /* Opens on a reference to something the viewer never saw. checkFlow flags
     exactly this, so proposing it would be proposing our own bug report. */
  const DANGLING = /^(and |but |so |because |which |then )?\s*(he|she|it|they|them|him|her|that|this|those|these|there)\b/i;

  const HEDGE = /\b(kind of|sort of|you know|i guess|i mean|like,|whatever|or something|i don'?t know)\b/gi;
  const SOFT_OPEN = /^(um|uh|yeah|okay|right|well|and|but|so|plus|because)\b/i;

  /* Whisper punctuates. A line that starts lowercase started mid-sentence, and
     a line with no terminal stop hasn't finished one — either way you'd be
     cutting into the middle of a thought. This single test throws out more bad
     candidates than every heuristic below it put together. */
  const STARTS_CLEAN = /^["“(]?[A-Z]/;
  const ENDS_CLEAN = /[.!?]["”)]?$/;

  /* "that, that" · "you, you, you" — a stumble the speaker recovered from.
     Fine in conversation, unusable as the first line of a short. */
  const STUTTER = /\b(\w+)\b[,\s]+\1\b/gi;
  const DISFLUENCY = /\b(um|uh|er|erm)\b/gi;

  /* A number, a name, a place — something the ear can hold onto. */
  const CONCRETE = /(\b\d+\b|\b(?!I\b)[A-Z][a-z]{2,}\b)/;

  /* Does this line work with the sound off and the context gone?
     Returns 0 to reject outright, otherwise a quality score. */
  function shape(s) {
    const text = s.text.trim();
    const w = text.split(/\s+/).length;
    const d = s.end - s.start;

    if (!STARTS_CLEAN.test(text) || !ENDS_CLEAN.test(text)) return 0;
    if (BOILERPLATE.test(text) || HOST_TELL.test(text)) return 0;
    // Second person with no first person is the interviewer describing the
    // guest's life back to them. The guest, telling their own story, says "I".
    if (/\b(you|your|you'(ve|re|d|ll))\b/i.test(text) && !/\b(I|I'm|I'd|I've|my|we|our|me)\b/.test(text)) return 0;
    if (w < 8 || w > 34) return 0;                       // a fragment, or a paragraph
    if (d < 2.2 || d > 14) return 0;                     // too clipped to land, too long to hold
    if (/\?["”]?$/.test(text) && HOST_ASK.test(text)) return 0;  // the interviewer
    if (DANGLING.test(text)) return 0;                   // opens on something never shown
    if ((text.match(DISFLUENCY) || []).length > 1) return 0;
    if ((text.match(STUTTER) || []).length > 0) return 0;

    let n = 1;
    if (/\b(I|I'm|I've|my|we|our)\b/.test(text)) n += 1.2;     // first person, not narration
    if (CONCRETE.test(text.slice(1))) n += 0.8;          // something specific in it
    if (w >= 11 && w <= 26) n += 0.7;                    // the length that reads as a beat
    if (d >= 3.5 && d <= 9) n += 0.5;
    if (SOFT_OPEN.test(text)) n -= 0.8;                  // "And…" — fine mid-cut, weak cold
    if ((text.match(DISFLUENCY) || []).length) n -= 0.5;
    n -= Math.min(1.5, (text.match(HEDGE) || []).length * 0.6);
    return Math.max(0, n);
  }

  /* An opener has nothing before it, so it carries all its own context and has
     to earn the next four seconds cold. A closer has to resolve rather than
     hand off. Both are judged more harshly than the lines in between. */
  const hookScore = (s) => (SOFT_OPEN.test(s.text.trim()) ? 0 : shape(s));
  const closeScore = (s) => (/[.!]["”)]?$/.test(s.text.trim()) ? shape(s) : 0);

  function build(angle, segments, budgetSec, used) {
    const D = Store.state.source.durationSec || 1;
    // Skip the top-and-tail — intros and sign-offs live there and score noise.
    const body = segments.filter((s) => s.start > Math.min(75, D * 0.03) && s.end < D - 45);

    const scored = [];
    for (const s of body) {
      if (used.has(s.i)) continue;      // already spoken for by another angle
      const q = shape(s);
      if (!q) continue;
      const t = s.text.toLowerCase();
      const hits = angle.seeds.filter((k) => t.includes(k)).length;
      // A keyword is evidence of the angle; without one the line has to carry
      // itself on shape alone, which is a much higher bar.
      if (!hits && q < (angle.seeds.length ? 3.0 : 2.5)) continue;
      scored.push({ s, hits, q, score: hits * 2.6 + q });
    }
    if (scored.length < 4) return [];

    // Build an arc rather than a top-N list. The opener comes from early in the
    // hour and the closer from late, so the short travels the way the interview
    // did — the difference between a story and a highlights package.
    const best = (pool, key) => pool.slice().sort((a, b) => key(b.s) - key(a.s) || b.score - a.score)[0];
    // Draw the two ends from the two ends. Picking them purely on score put
    // both in the middle third and left no room between them for a middle.
    const hook = best(scored.filter((r) => r.s.start < D * 0.35 && hookScore(r.s) > 0), hookScore);
    const close = best(scored.filter((r) => r.s.start > D * 0.65 && closeScore(r.s) > 0), closeScore);
    if (!hook || !close || close.s.start <= hook.s.start) return [];

    // Fill between them, strongest first, spread out and inside the budget.
    const minGap = Math.max(40, D / 26);
    const picked = [hook, close];
    let total = (hook.s.end - hook.s.start) + (close.s.end - close.s.start);
    for (const r of scored.slice().sort((a, b) => b.score - a.score)) {
      if (picked.length >= 6) break;
      if (r.s.start <= hook.s.start || r.s.start >= close.s.start) continue;
      if (total + (r.s.end - r.s.start) > budgetSec) continue;
      if (picked.some((p) => Math.abs(p.s.start - r.s.start) < minGap)) continue;
      picked.push(r);
      total += r.s.end - r.s.start;
    }
    if (picked.length < 3) return [];

    picked.sort((a, b) => a.s.start - b.s.start);
    return picked.map((r, i) => ({
      start: r.s.start, end: r.s.end, text: r.s.text,
      why: i === 0 ? "opens cold and still makes sense"
         : i === picked.length - 1 ? "resolves — nothing dangles after it"
         : r.hits ? `matched “${angle.seeds.find((k) => r.s.text.toLowerCase().includes(k))}”`
         : "stands alone as a sentence",
    }));
  }

  return {
    suggest() {
      const segs = Store.state.segments;
      if (!segs.length) return 0;
      const budget = Store.state.targetSec || 60;
      let made = 0;
      // Three angles that share their best lines are one cut wearing three
      // hats. Each takes its picks off the table for the next, so what you get
      // back is three genuine alternatives — and the later ones are visibly
      // thinner, which is the truth about a keyword search with no ears.
      const used = new Set();
      for (const a of ANGLES) {
        const spans = build(a, segs, budget, used);
        if (spans.length < 3) continue;
        spans.forEach((sp) => { const m = segs.find((x) => x.start === sp.start); if (m) used.add(m.i); });
        Store.proposeCut({ title: a.title, desc: a.desc, spans });
        made++;
      }
      return made;
    },
  };
})();
