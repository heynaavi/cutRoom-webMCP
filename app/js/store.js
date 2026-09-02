/* ═══════════════════════════════════════════════════════════════════════════
   STORE — all app state, plus the search that the agent leans on.
   Deliberately plain: one object, one change event. Every mutation funnels
   through here so the UI, the player and the WebMCP tools can never disagree
   about what the reel currently is.
   ═══════════════════════════════════════════════════════════════════════════ */
const Store = (() => {
  const state = {
    source: { title: "", durationSec: 0, credit: "" },
    segments: [],          // {i, start, end, text}
    words: [],             // {wi, word, start, end}
    reel: [],              // {id, start, end, text, muted, ghost, why}
    starred: [],           // segment indices
    candidates: [],        // {id, title, desc, spans, appliedAt, verdict}
    activeCand: null,
    notes: [],             // {text, at} — what the human asked for, in their words
    targetSec: 60,
    tab: "transcript",
    query: "",
    log: [],               // {tool, arg, at}
  };

  const subs = [];
  const on = (fn) => subs.push(fn);
  const emit = (what) => subs.forEach((f) => f(what, state));

  let seq = 0;
  const nid = () => `c${++seq}`;

  // Undo exists because an agent can replace the whole reel in one call. A
  // person needs to be able to take that back without re-doing their work.
  const undoStack = [];
  const snapshot = (label) => {
    undoStack.push({ label, reel: state.reel.map((c) => ({ ...c })), at: Date.now() });
    if (undoStack.length > 30) undoStack.shift();
  };

  // ── derived ───────────────────────────────────────────────────────────────
  // Playback includes pending clips on purpose: a proposal you cannot hear is
  // worthless, and hearing it is exactly how the human decides whether to keep
  // it. Only muting removes a clip from playback. `ghost` is about provenance
  // (who put it there, is it accepted yet), never about audibility.
  const live = () => state.reel.filter((c) => !c.muted);
  const dur = (list) => list.reduce((n, c) => n + (c.end - c.start), 0);
  const reelDur = () => dur(live());

  // Spread: how much of the source the cut draws on. A short built entirely
  // from one stretch feels like a clip; one drawn from across the hour feels
  // like a story. Surfacing it makes that difference visible.
  const spread = () => {
    const l = live();
    if (l.length < 2) return 0;
    const lo = Math.min(...l.map((c) => c.start));
    const hi = Math.max(...l.map((c) => c.end));
    return (hi - lo) / state.source.durationSec;
  };

  // ── search ────────────────────────────────────────────────────────────────
  // No model here on purpose: the agent decides WHAT to look for, we only have
  // to find it fast. Scores exact phrase > all terms > some terms, and nudges
  // toward segments long enough to stand alone in a cut.
  const search = (q, opts = {}) => {
    const { limit = 60, minSec = 0, maxSec = 1e9 } = opts;
    const terms = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    let out = state.segments.filter((s) => {
      const d = s.end - s.start;
      return d >= minSec && d <= maxSec;
    });
    if (!terms.length) return out.slice(0, limit);
    const phrase = terms.join(" ");
    return out
      .map((s) => {
        const t = s.text.toLowerCase();
        let score = 0;
        if (t.includes(phrase)) score += 12;
        for (const w of terms) if (t.includes(w)) score += 3;
        const hits = terms.filter((w) => t.includes(w)).length;
        if (!hits) return { s, score: 0 };     // no match is no result, never a filler hit
        if (hits === terms.length) score += 5;
        const wc = s.text.split(/\s+/).length;
        if (wc >= 8 && wc <= 34) score += 2;   // stands alone as a line
        return { s, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.s.start - b.s.start)
      .slice(0, limit)
      .map((r) => r.s);
  };

  // ── mutations ─────────────────────────────────────────────────────────────
  const api = {
    state, on, emit, live, reelDur, spread, search,

    load(data) {
      state.source = { title: data.title, durationSec: data.durationSec, credit: data.credit || "" };
      state.words = data.words || [];
      state.segments = (data.segments || []).map((s, i) => ({ ...s, i }));
      emit("load");
    },

    snapshot,
    canUndo: () => undoStack.length > 0,
    undo() {
      const prev = undoStack.pop();
      if (!prev) return null;
      state.reel = prev.reel;
      emit("reel");
      return prev.label;
    },

    addSpan({ start, end, text, why, ghost = false, at = null }) {
      snapshot("add clip");
      const clip = { id: nid(), start, end, text: text || api.textBetween(start, end),
                     muted: false, ghost, why: why || null, vote: null, note: null };
      if (at == null || at >= state.reel.length) state.reel.push(clip);
      else state.reel.splice(Math.max(0, at), 0, clip);
      emit("reel");
      return clip;
    },

    removeClip(id) {
      snapshot("remove clip");
      const n = state.reel.length;
      state.reel = state.reel.filter((c) => c.id !== id);
      if (state.reel.length !== n) emit("reel");
    },

    toggleMute(id) {
      const c = state.reel.find((x) => x.id === id);
      if (!c) return;
      c.muted = !c.muted;
      emit("reel");
    },

    keepGhost(id) {
      const c = state.reel.find((x) => x.id === id);
      if (!c || !c.ghost) return;
      c.ghost = false;
      emit("reel");
    },

    keepAllGhosts() {
      let n = 0;
      state.reel.forEach((c) => { if (c.ghost) { c.ghost = false; n++; } });
      if (n) emit("reel");
      return n;
    },

    dropGhosts() {
      const n = state.reel.length;
      state.reel = state.reel.filter((c) => !c.ghost);
      if (state.reel.length !== n) emit("reel");
    },

    move(id, to) {
      const from = state.reel.findIndex((c) => c.id === id);
      if (from < 0) return;
      const [c] = state.reel.splice(from, 1);
      state.reel.splice(Math.max(0, Math.min(state.reel.length, to)), 0, c);
      emit("reel");
    },

    clear() { snapshot("clear reel"); state.reel = []; state.activeCand = null; emit("reel"); },

    /* Nudge a clip's in/out points. Snaps to word boundaries when we have word
       timings — cutting mid-word is the difference between a clip and a clip
       that sounds broken. */
    trim(id, { headSec = 0, tailSec = 0, snap = true } = {}) {
      const c = state.reel.find((x) => x.id === id);
      if (!c) return null;
      snapshot("trim clip");
      let start = Math.max(0, c.start + headSec);
      let end = Math.min(state.source.durationSec, c.end + tailSec);
      if (end - start < 0.4) return null;                 // refuse to nuke a clip
      if (snap && state.words.length) {
        // Seeding a reduce with the target itself makes distance 0 unbeatable,
        // so nothing ever snapped. Track the best candidate explicitly.
        const nearest = (t, key) => {
          let best = null, bestD = Infinity;
          for (const w of state.words) {
            const d = Math.abs(w[key] - t);
            if (d < bestD) { bestD = d; best = w[key]; }
          }
          return bestD < 0.45 ? best : t;
        };
        start = nearest(start, "start");
        end = nearest(end, "end");
      }
      c.start = +start.toFixed(2);
      c.end = +end.toFixed(2);
      c.text = api.textBetween(c.start, c.end);
      emit("reel");
      return c;
    },

    /* A reaction on one clip — the most specific taste signal there is. */
    react(id, vote, note) {
      const c = state.reel.find((x) => x.id === id);
      if (!c) return null;
      c.vote = c.vote === vote && !note ? null : vote;
      if (note !== undefined) c.note = note || null;
      emit("reel");
      return c;
    },

    /* What the human asked for, in the words they used. */
    addNote(text) {
      state.notes.unshift({ text, at: Date.now() });
      state.notes = state.notes.slice(0, 12);
      emit("notes");
      return text;
    },

    // Replace the whole reel — how an agent proposes a complete cut. Everything
    // lands as a ghost so nothing the human chose is silently overwritten.
    proposeCut({ title, desc, spans }) {
      const cand = {
        id: nid(), title: title || "Untitled cut", desc: desc || "",
        spans: spans.map((s) => ({ ...s, text: s.text || api.textBetween(s.start, s.end) })),
      };
      state.candidates.unshift(cand);
      emit("cands");
      return cand;
    },

    applyCandidate(id, { asGhost = true } = {}) {
      const c = state.candidates.find((x) => x.id === id);
      if (!c) return null;
      snapshot(`load “${c.title}”`);
      c.appliedAt = Date.now();
      state.reel = c.spans.map((s) => ({
        id: nid(), start: s.start, end: s.end, text: s.text,
        muted: false, ghost: asGhost, why: s.why || null, vote: null, note: null,
      }));
      state.activeCand = id;
      emit("reel"); emit("cands");
      return c;
    },

    star(i) {
      const at = state.starred.indexOf(i);
      if (at >= 0) state.starred.splice(at, 1); else state.starred.push(i);
      state.starred.sort((a, b) => a - b);
      emit("starred");
      return at < 0;
    },

    setTab(t) { state.tab = t; emit("tab"); },
    setQuery(q) { state.query = q; emit("query"); },

    logTool(tool, arg) {
      state.log.unshift({ tool, arg, at: Date.now() });
      state.log = state.log.slice(0, 60);
      emit("log");
    },

    // ── helpers ─────────────────────────────────────────────────────────────
    textBetween(start, end) {
      const ws = state.words.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05);
      if (ws.length) return ws.map((w) => w.word).join(" ").replace(/\s+([,.!?;:])/g, "$1");
      const s = state.segments.find((x) => x.start <= start && x.end >= start);
      return s ? s.text : "";
    },

    segmentAt(sec) { return state.segments.find((s) => sec >= s.start && sec < s.end) || null; },

    // What the agent gets back when it asks what's going on. Not a number —
    // a description of what the human just did, which is the whole point.
    reelState() {
      return {
        clips: state.reel.map((c, i) => ({
          index: i, startSec: +c.start.toFixed(2), endSec: +c.end.toFixed(2),
          durationSec: +(c.end - c.start).toFixed(2),
          text: c.text, muted: !!c.muted, pending: !!c.ghost, why: c.why,
          humanVote: c.vote, humanNote: c.note,
        })),
        durationSec: +reelDur().toFixed(1),
        targetSec: state.targetSec,
        overBudget: reelDur() > state.targetSec,
        spreadPct: Math.round(spread() * 100),
        starredCount: state.starred.length,
        pendingCount: state.reel.filter((c) => c.ghost).length,
        // The important half: what the person has told you, explicitly and
        // implicitly. Read this before proposing anything new.
        humanAsked: state.notes.map((n) => n.text),
        keptCount: state.reel.filter((c) => !c.ghost).length,
        mutedCount: state.reel.filter((c) => c.muted).length,
        canUndo: undoStack.length > 0,
      };
    },
  };
  return api;
})();
