/* ═══════════════════════════════════════════════════════════════════════════
   STARTERS — heuristic cuts for when no agent is connected.
   Deliberately not clever: this exists so the page is useful standalone, and
   so the difference between a keyword guess and an agent that actually read
   the transcript is obvious when you play them back to back.
   ═══════════════════════════════════════════════════════════════════════════ */
const Starters = (() => {
  const ANGLES = [
    { title: "The hard part", desc: "Doubt, setbacks, the bit nobody puts on a poster.",
      seeds: ["hard", "difficult", "failed", "failure", "rejected", "doubt", "scared", "afraid", "struggle", "gave up", "didn't think", "nervous", "wrong"] },
    { title: "The turn", desc: "The moment it changed — the call, the yes, the click.",
      seeds: ["moment", "called", "phone", "selected", "realized", "suddenly", "changed", "first time", "finally", "decided", "remember when"] },
    { title: "What they'd tell you", desc: "Advice, straight to camera.",
      seeds: ["advice", "tell people", "if you", "you have to", "my advice", "keep going", "don't give up", "believe", "apply", "anyone can", "just start"] },
  ];

  // A line has to stand alone in a short: long enough to mean something,
  // short enough to keep momentum, and ideally a complete sentence.
  const quotable = (s) => {
    const w = s.text.split(/\s+/).length;
    const d = s.end - s.start;
    if (w < 7 || w > 32 || d < 2 || d > 13) return 0;
    let n = 1;
    if (/[.!?]$/.test(s.text)) n += 1.5;
    if (/\b(I|we|my|me|you)\b/i.test(s.text)) n += 1;
    if (/^(and|but|so|um|uh|yeah|okay|right)\b/i.test(s.text)) n -= 1;
    return n;
  };

  function build(angle, segments, want = 6) {
    const scored = segments.map((s) => {
      const t = s.text.toLowerCase();
      const hits = angle.seeds.filter((k) => t.includes(k)).length;
      return { s, score: hits * 3 + quotable(s) * (hits ? 1 : 0.35) };
    }).filter((r) => r.score > 1.2).sort((a, b) => b.score - a.score);

    // Spread the picks across the recording — a short built from one stretch
    // plays like an excerpt, not a story.
    const picked = [];
    const minGap = 45;
    for (const r of scored) {
      if (picked.length >= want) break;
      if (picked.every((p) => Math.abs(p.s.start - r.s.start) > minGap)) picked.push(r);
    }
    return picked
      .sort((a, b) => a.s.start - b.s.start)
      .map((r) => ({
        start: r.s.start, end: r.s.end, text: r.s.text,
        why: angle.seeds.find((k) => r.s.text.toLowerCase().includes(k)) || "reads as a standalone line",
      }));
  }

  return {
    suggest() {
      const segs = Store.state.segments;
      if (!segs.length) return 0;
      let made = 0;
      for (const a of ANGLES) {
        const spans = build(a, segs);
        if (spans.length < 3) continue;
        Store.proposeCut({ title: a.title, desc: a.desc, spans });
        made++;
      }
      return made;
    },
  };
})();
