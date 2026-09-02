/* ═══════════════════════════════════════════════════════════════════════════
   WEBMCP — the tools an agent gets.
   Design rules:
     · The agent proposes; the human disposes. Nothing an agent calls silently
       replaces a human choice — new clips land pending until kept.
     · Reads return what the HUMAN just did, not just numbers. An agent that
       can see "they muted clip 3 and replayed 4–6 twice" can act on taste.
     · Every call is logged to a visible ledger, so the human always knows.
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
  // Painted after the DOM exists — this file runs in <head> on purpose.
  const whenDom = (fn) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn());
  const el = (id) => document.getElementById(id);

  // The spec has churned (provideContext was removed in March 2026; the object
  // moved from navigator to document), and different runtimes sit on different
  // snapshots. So: find EVERY surface present, register on each distinct one,
  // and use the older bulk call too if it exists. Then say exactly what was
  // found, in the UI, so a runtime that registers-but-never-bridges can be
  // diagnosed from a screenshot rather than guessed at.
  const surfaces = [];
  const seen = new Set();
  // Walk own properties AND the prototype chain, stopping before
  // Object.prototype. Chrome's modelContext is a class instance (methods on a
  // prototype); another runtime may hand back a plain object (methods as own
  // properties). Looking only at the prototype found Object.prototype on the
  // latter and reported hasOwnProperty/toString/valueOf as its "API" —
  // useless, and it hid what the runtime actually offers.
  const methodsOf = (obj) => {
    const out = new Set();
    for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (k === "constructor") continue;
        let v; try { v = obj[k]; } catch { continue; }   // getters can throw
        if (typeof v === "function") out.add(k);
      }
    }
    return [...out];
  };
  collect();
  function collect() {
    surfaces.length = 0; seen.clear();
    const found = [];
    const doc = globalThis.document?.modelContext;
    if (doc) found.push(["document", doc]);
    // Only consult navigator when document has nothing: reading it emits a
    // deprecation warning, and where both exist they're the same object.
    else {
      const nav = globalThis.navigator?.modelContext;
      if (nav) found.push(["navigator", nav]);
    }
    for (const [where, obj] of found) {
      if (!obj || seen.has(obj)) continue;
      seen.add(obj);
      surfaces.push({ where, obj, methods: methodsOf(obj),
        kind: Object.getPrototypeOf(obj) === Object.prototype ? "plain object" : (obj.constructor?.name || "unknown") });
    }
    return surfaces.length;
  }

  const mc = surfaces[0]?.obj;

  // We now look for modelContext in <head>, which is as early as possible —
  // and that creates a hole: a runtime that INJECTS modelContext after page
  // load would find us having checked once, found nothing, and given up
  // forever. So if nothing is there yet, keep watching. Cheap, bounded, and
  // stops as soon as a surface appears.
  if (!surfaces.length) {
    let tries = 0;
    const look = () => {
      if (globalThis.document?.modelContext || (!globalThis.document?.modelContext && globalThis.navigator?.modelContext)) {
        clearInterval(iv);
        removeEventListener("visibilitychange", look);
        register();               // re-run the whole flow with the surface present
        return true;
      }
      if (++tries > 40) { clearInterval(iv); removeEventListener("visibilitychange", look); }
      return false;
    };
    var iv = setInterval(look, 500);           // ~20s of watching
    addEventListener("visibilitychange", look); // and whenever the tab is focused
    addEventListener("pageshow", look);
  }
  const diag = surfaces.length
    ? surfaces.map((s) => `${s.where}.modelContext [${s.kind}] {${s.methods.join(", ")}}`).join(" · ")
    : "no modelContext on document or navigator";
  // navigator.modelContextTesting.listTools() is the console diagnostic some
  // runtimes expose; capture it too when present.
  const testing = globalThis.navigator?.modelContextTesting;
  globalThis.__cutroomDiag = {
    surfaces: surfaces.map((s) => ({ where: s.where, kind: s.kind, methods: s.methods })),
    testingApi: testing ? Object.getOwnPropertyNames(Object.getPrototypeOf(testing) || {}).filter((k) => k !== "constructor") : null,
    registeredAt: "head",
    ua: navigator.userAgent,
  };

  /* "1 cuts", "0 clip(s)" — small things, but an agent quotes these back to the
     person verbatim, so they end up in the product's voice. */
  const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const secs = (n) => (n >= 0.05 ? `${n.toFixed(1)}s` : "under a tenth of a second");

  const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
  const note = (t) => ({ content: [{ type: "text", text: t }] });

  const TOOLS = [
    {
      name: "getSource",
      description: "Describe the loaded recording: title, duration, credit, and how many transcript lines it has. Call this first to know what you are cutting.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        Store.logTool("getSource", "");
        const s = Store.state.source;
        return ok({
          title: s.title, durationSec: s.durationSec, credit: s.credit,
          lineCount: Store.state.segments.length,
          hasAudio: !Store.state.textOnly,
          note: Store.state.textOnly
            ? "Transcript only — no audio is loaded, so playReel and renderVideo won't work. Everything else does: you can still search, build the cut, and return exact timestamps. Tell them they can drop the media file on the page to add sound."
            : "Audio is loaded, so you can play cuts back to them.",
        });
      },
    },
    {
      name: "searchTranscript",
      description: "Find candidate lines anywhere in the recording. Returns transcript lines with their exact start/end seconds, which you pass to addSpan or proposeCut. Search by topic, phrase, or emotion — e.g. 'self doubt', 'the moment he got the call', 'rejection'. Use minSec/maxSec to filter by line length so you only get lines that can stand alone in a short.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words or phrase to look for." },
          limit: { type: "number", description: "Max results (default 25)." },
          minSec: { type: "number", description: "Only lines at least this long." },
          maxSec: { type: "number", description: "Only lines at most this long." },
        },
        additionalProperties: false,
        required: ["query"],
      },
      async execute({ query, limit = 25, minSec = 0, maxSec = 1e9 }) {
        Store.logTool("searchTranscript", `“${query}”`);
        const hits = Store.search(query, { limit, minSec, maxSec });
        return ok(hits.map((s) => ({ startSec: +s.start.toFixed(2), endSec: +s.end.toFixed(2), durationSec: +(s.end - s.start).toFixed(2), text: s.text })));
      },
    },
    {
      name: "readTranscript",
      description: "Read a stretch of the transcript in order, to understand context around a moment. Prefer searchTranscript when hunting; use this to check what comes before or after a line you like.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          fromSec: { type: "number", description: "Start of the window, in seconds." },
          toSec: { type: "number", description: "End of the window, in seconds." },
        },
        additionalProperties: false,
        required: ["fromSec", "toSec"],
      },
      async execute({ fromSec, toSec }) {
        Store.logTool("readTranscript", `${Math.round(fromSec)}s–${Math.round(toSec)}s`);
        return ok(Store.state.segments
          .filter((s) => s.end > fromSec && s.start < toSec)
          .map((s) => ({ startSec: +s.start.toFixed(2), endSec: +s.end.toFixed(2), text: s.text })));
      },
    },
    {
      name: "getReelState",
      description: "See the current cut AND every signal the human has given you about it: humanVote and humanNote on individual clips (a thumbs-down is them telling you that specific line is wrong), humanAsked with the steers they clicked in their own words, which clips they muted, what they starred, how far over the 60-second budget they are, and how much of the episode the cut spans. ALWAYS read this before proposing a revision — the whole point is that you are working to their taste, not your own.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        Store.logTool("getReelState", "");
        const st = Store.reelState();
        st.starred = Store.state.starred.map((i) => {
          const s = Store.state.segments[i];
          return { startSec: +s.start.toFixed(2), endSec: +s.end.toFixed(2), text: s.text };
        });
        return ok(st);
      },
    },
    {
      name: "proposeCut",
      description: "Propose a complete short as a named candidate — the main way to help. Give it a title and a one-line angle, plus 4-10 spans drawn from ANYWHERE in the recording (a good short usually jumps across the episode rather than taking one continuous stretch). Give every span a short 'why' so the human can see your reasoning on the clip. The cut lands as pending clips the human can play, keep, or drop — it never overwrites their work silently. Propose two or three contrasting angles rather than one 'best' answer.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          title: { type: "string", description: "Short name for this angle, e.g. 'The rejection arc'." },
          description: { type: "string", description: "One line on what makes this cut work." },
          spans: {
            type: "array",
            description: "The clips, in playback order.",
            items: {
              type: "object",
              properties: {
                startSec: { type: "number" },
                endSec: { type: "number" },
                why: { type: "string", description: "Why this line earns its place, in a few words." },
              },
        additionalProperties: false,
              required: ["startSec", "endSec"],
            },
          },
        },
        required: ["title", "spans"],
      },
      async execute({ title, description, spans }) {
        Store.logTool("proposeCut", `“${title}” · ${spans.length} clips`);
        const c = Store.proposeCut({
          title, desc: description || "",
          spans: spans.map((s) => ({ start: s.startSec, end: s.endSec, why: s.why || null })),
        });
        Store.applyCandidate(c.id, { asGhost: true });
        Store.setTab("cands");
        const total = c.spans.reduce((n, s) => n + (s.end - s.start), 0);
        return note(`Proposed “${title}” — ${c.spans.length} clips, ${total.toFixed(1)}s. It's on the reel as pending clips; the human can play it with Space and keep or drop each one. Ask them how it sounds.`);
      },
    },
    {
      name: "addSpan",
      description: "Add one line to the reel, at the end or at a given position. Use this for surgical edits — swapping a weak line, adding a beat the human asked for — rather than rebuilding the whole cut.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          why: { type: "string", description: "Why it belongs, in a few words." },
          atIndex: { type: "number", description: "Position in the reel; omit to append." },
        },
        additionalProperties: false,
        required: ["startSec", "endSec"],
      },
      async execute({ startSec, endSec, why, atIndex }) {
        Store.logTool("addSpan", `${Math.round(startSec)}s (+${(endSec - startSec).toFixed(1)}s)`);
        const c = Store.addSpan({ start: startSec, end: endSec, why, ghost: true, at: atIndex });
        return note(`Added as pending: “${c.text.slice(0, 80)}”`);
      },
    },
    {
      name: "removeClip",
      description: "Remove a clip from the reel by its index (0-based, as returned by getReelState).",
      annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: { index: { type: "number" } }, additionalProperties: false, required: ["index"] },
      async execute({ index }) {
        const c = Store.state.reel[index];
        if (!c) return note(`No clip at index ${index}.`);
        Store.logTool("removeClip", `#${index + 1}`);
        Store.removeClip(c.id);
        return note(`Removed “${c.text.slice(0, 60)}”.`);
      },
    },
    {
      name: "reorderClip",
      description: "Move a clip to a different position in the reel. Order is most of what makes a short work — the same lines in a different sequence tell a different story.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { fromIndex: { type: "number" }, toIndex: { type: "number" } },
        required: ["fromIndex", "toIndex"],
      },
      async execute({ fromIndex, toIndex }) {
        const c = Store.state.reel[fromIndex];
        if (!c) return note(`No clip at index ${fromIndex}.`);
        Store.logTool("reorderClip", `#${fromIndex + 1} → #${toIndex + 1}`);
        Store.move(c.id, toIndex);
        return note(`Moved to position ${toIndex + 1}.`);
      },
    },
    {
      name: "loadTranscript",
      description: "Load a different recording's transcript into Cutroom, replacing the demo. Use this when the human wants to cut THEIR material and you already have the transcript — paste it in as timed lines and the page becomes a cutting surface for their recording. Audio is optional: without it the human still gets the full reel, search and ordering, just no playback. If they have the media locally, tell them to drop the file onto the page — it never leaves their browser.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          title: { type: "string", description: "Name of the recording." },
          credit: { type: "string", description: "Source or attribution, if any." },
          mediaUrl: { type: "string", description: "Optional direct URL to the audio/video. Must be CORS-readable; omit if unsure — without it the page runs in text mode, which still does everything except play sound." },
          segments: {
            type: "array",
            description: "The transcript as timed lines, in order.",
            items: {
              type: "object",
              properties: {
                startSec: { type: "number" },
                endSec: { type: "number" },
                text: { type: "string" },
              },
        additionalProperties: false,
              required: ["startSec", "endSec", "text"],
            },
          },
        },
        required: ["title", "segments"],
      },
      async execute({ title, credit, mediaUrl, segments }) {
        Store.logTool("loadTranscript", `“${title}” · ${segments.length} lines`);
        const data = Ingest.normalise({
          title, credit,
          segments: segments.map((s) => ({ start: s.startSec, end: s.endSec, text: s.text })),
        });
        UI.loadSource(data, mediaUrl || null);
        return note(
          `Loaded “${title}” — ${plural(data.segments.length, "line")}, ${data.durationSec < 90
             ? plural(Math.round(data.durationSec), "second")
             : plural(Math.round(data.durationSec / 60), "minute")}.` +
          (mediaUrl ? " Audio attached." : " No audio: the human can drop the media file onto the page to hear cuts, or work silently from the text.")
        );
      },
    },
    {
      name: "trimClip",
      description: "Nudge a clip's in and out points, in seconds. Negative headSec starts EARLIER, positive starts later; negative tailSec ends earlier, positive ends later. This is most of what makes a cut tight — a clip that starts half a word late or runs two seconds past the point is the difference between sharp and slack. Boundaries snap to the nearest word so you never cut mid-syllable. Use small values (0.3-1.5s) and play it back.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Clip position from getReelState (0-based)." },
          headSec: { type: "number", description: "Move the start. Negative = start earlier." },
          tailSec: { type: "number", description: "Move the end. Negative = end earlier." },
        },
        additionalProperties: false,
        required: ["index"],
      },
      async execute({ index, headSec = 0, tailSec = 0 }) {
        const c = Store.state.reel[index];
        if (!c) return note(`No clip at index ${index}.`);
        Store.logTool("trimClip", `#${index + 1} ${headSec >= 0 ? "+" : ""}${headSec}/${tailSec >= 0 ? "+" : ""}${tailSec}`);
        const r = Store.trim(c.id, { headSec, tailSec });
        if (!r) return note("That would leave the clip too short to be a clip.");
        return note(`Clip ${index + 1} is now ${(r.end - r.start).toFixed(1)}s: “${r.text.slice(0, 90)}”`);
      },
    },
    {
      name: "getCandidates",
      description: "See every cut proposed so far in this session, which one is currently loaded on the reel, and how the human reacted to each. Read this before proposing again — repeating an angle they already rejected wastes their time, and knowing what they kept tells you what they actually want.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        Store.logTool("getCandidates", "");
        return ok(Store.state.candidates.map((c) => ({
          title: c.title,
          description: c.desc,
          clipCount: c.spans.length,
          durationSec: +c.spans.reduce((n, s) => n + (s.end - s.start), 0).toFixed(1),
          loadedOntoReel: Store.state.activeCand === c.id,
          triedByHuman: !!c.appliedAt,
        })));
      },
    },
    {
      name: "exportCut",
      description: "Hand the finished cut to the human as a file they can take into an editor. 'edl' gives timecoded in/out points against the source, 'json' gives the raw spans and text, 'srt' gives captions timed against the FINISHED cut (so they burn straight onto the exported video), 'text' gives a readable script. Offer this once they sound happy — a cut that can't leave the browser is a toy.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { format: { type: "string", enum: ["edl", "json", "srt", "text"], description: "Defaults to json." } },
      },
      async execute({ format = "json" }) {
        const l = Store.live();
        if (!l.length) return note("The reel is empty — nothing to export.");
        Store.logTool("exportCut", format);
        const name = UI.exportCut(format);
        // Report the extension that came back, not the one that was asked for.
        // An unrecognised format falls through to JSON, and claiming otherwise
        // would have the agent telling them a file exists that doesn't.
        const got = (name.split(".").pop() || "file").toUpperCase();
        return note(`Exported ${plural(l.length, "clip")} as ${got} — the file “${name}” is downloading for them now.`);
      },
    },
    {
      name: "undoLastChange",
      description: "Undo the last change to the reel. Use this immediately if the human says a change made it worse — it restores what was there before rather than making them rebuild by hand.",
      annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const what = Store.undo();
        if (!what) return note("Nothing to undo.");
        Store.logTool("undo", what);
        return note(`Undid “${what}”. The reel is back to what it was.`);
      },
    },
    {
      name: "findEnergyMoments",
      description: "Find where the speaker's voice LIFTS — the passages carrying the most energy relative to their own baseline. This reads the actual audio, not the transcript, so it surfaces things no text search can: someone getting animated, a laugh, a moment of real feeling. The best clip in an hour is usually not the smartest sentence, it's the one with the most life in it. Use this alongside searchTranscript, not instead of it: search finds the topic, this finds the delivery. `lift` is how far above their normal level that passage sits.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many moments to return (default 12)." },
          minSec: { type: "number", description: "Shortest moment worth returning." },
          maxSec: { type: "number", description: "Longest moment worth returning." },
        },
        additionalProperties: false,
      },
      async execute({ limit = 12, minSec = 2.5, maxSec = 14 }) {
        Store.logTool("findEnergyMoments", `top ${limit}`);
        const m = Analysis.energyMoments({ limit, minSec, maxSec });
        if (!m.length) return note("No clear energy peaks found — this recording is fairly level throughout.");
        return ok(m);
      },
    },
    {
      name: "checkFlow",
      description: "Review the cut as an editor would and report what's wrong with it: a hook that starts mid-thought, a clip opening on a pronoun with nothing to point at, sentences sheared off, joins that land on speech instead of in a pause, over-budget, or every clip drawn from one stretch. Call this before telling the human the cut is done — it catches the things that make a short feel broken even when every line is good. Each issue names the clip and suggests the fix.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        Store.logTool("checkFlow", "");
        const issues = Analysis.checkFlow();
        if (!issues.length) return note("The cut reads clean: the hook stands alone, every clip resolves, the joins land in pauses, and it's inside budget.");
        return ok({ issueCount: issues.length, issues });
      },
    },
    {
      name: "snapToBreath",
      description: "Move a clip's in and out points to the nearest natural pause, using the audio rather than the transcript. A splice that lands on top of a word sounds broken however good the line is; one that lands in a breath sounds deliberate. Use it after trimClip, or whenever checkFlow reports a hard join.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Clip position from getReelState (0-based)." },
          edge: { type: "string", enum: ["in", "out", "both"], description: "Which end to move. Defaults to both." },
        },
        additionalProperties: false,
        required: ["index"],
      },
      async execute({ index, edge = "both" }) {
        const c = Store.state.reel[index];
        if (!c) return note(`No clip at index ${index}.`);
        const inB = edge !== "out" ? Analysis.nearestBreath(c.start) : null;
        const outB = edge !== "in" ? Analysis.nearestBreath(c.end) : null;
        if (inB === null && outB === null) return note(`No pause close enough to clip ${index + 1}'s edges — the speech runs continuously there.`);
        Store.logTool("snapToBreath", `#${index + 1} ${edge}`);
        const r = Store.trim(c.id, {
          headSec: inB !== null ? inB - c.start : 0,
          tailSec: outB !== null ? outB - c.end : 0,
          snap: false,
        });
        if (!r) return note("That would leave the clip too short.");
        return note(`Clip ${index + 1} now cuts on breath — ${(r.end - r.start).toFixed(1)}s: “${r.text.slice(0, 80)}”`);
      },
    },
    {
      name: "setClipRole",
      description: "Tag a clip with the job it does in the story: hook (earns the first three seconds), setup (gives the context the payoff needs), turn (the moment it changes), payoff (the thing worth staying for), or button (the line that lets it end). The reel then shows the shape of the story rather than a list of clips, and getReelState reports which roles are missing — a cut with no payoff is the most common way a short fails.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number" },
          role: { type: "string", enum: ["hook", "setup", "turn", "payoff", "button", "none"] },
        },
        additionalProperties: false,
        required: ["index", "role"],
      },
      async execute({ index, role }) {
        const c = Store.state.reel[index];
        if (!c) return note(`No clip at index ${index}.`);
        Store.logTool("setClipRole", `#${index + 1} → ${role}`);
        Store.setRole(c.id, role === "none" ? null : role);
        const have = [...new Set(Store.state.reel.map((x) => x.role).filter(Boolean))];
        const missing = ["hook", "turn", "payoff"].filter((r) => !have.includes(r));
        return note(`Clip ${index + 1} is the ${role}.` + (missing.length ? ` Still missing: ${missing.join(", ")}.` : " The arc is complete."));
      },
    },
    {
      name: "tidyClip",
      description: "Clean up a clip's edges: drop leading and trailing filler words (\"Um, so…\", \"…you know\") and land the cut in a pause. A clip that opens on \"Um\" wastes the three seconds that decide whether anyone watches. Fillers in the middle are left alone — that's just how people talk.",
      annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: { index: { type: "number" } }, additionalProperties: false, required: ["index"] },
      async execute({ index }) {
        const c = Store.state.reel[index];
        if (!c) return note(`No clip at index ${index}.`);
        const t = Analysis.tidyEdges(c);
        if (!t) return note(`Clip ${index + 1}'s edges are already clean.`);
        Store.logTool("tidyClip", `#${index + 1}`);
        Store.trim(c.id, { headSec: t.start - c.start, tailSec: t.end - c.end, snap: false });
        return note(`Dropped “${t.dropped.join(" ")}” from clip ${index + 1}. Now: “${Store.state.reel[index].text.slice(0, 80)}”`);
      },
    },
    {
      name: "fitToBudget",
      description: "Trim the whole cut down to a target length, taking the time off clip tails in proportion. Use it when checkFlow says you're over — but play it back afterwards, because proportional trimming is blunt and may clip a line you cared about.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { targetSec: { type: "number", description: "Target length. Defaults to the reel's 60s target." } },
      },
      async execute({ targetSec }) {
        const t = targetSec || Store.state.targetSec;
        const r = Store.fitToBudget(t);
        if (!r) return note("The reel is empty.");
        Store.logTool("fitToBudget", `${t}s`);
        if (!r.changed) return note(`Already inside budget at ${r.durationSec}s.`);
        return note(`Trimmed ${r.changed} clips to ${r.durationSec}s. Play it back — proportional trimming is blunt.`);
      },
    },
    {
      name: "playCandidate",
      description: "Play a previously proposed cut WITHOUT loading it onto the reel, so the human can compare two angles back to back without losing the one they're working on. Use it when they ask 'what did the other one sound like?'.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { title: { type: "string", description: "Title of the candidate, from getCandidates." } },
        required: ["title"],
      },
      async execute({ title }) {
        const c = Store.state.candidates.find((x) => x.title.toLowerCase() === String(title).toLowerCase());
        if (!c) return note(`No proposed cut called “${title}”. Call getCandidates to see the list.`);
        Store.logTool("playCandidate", `“${c.title}”`);
        const started = await Player.playSequence(c.spans.map((s) => ({ start: s.start, end: s.end })));
        if (!started) return note("The browser blocked playback — ask them to press play once first.");
        return note(`Playing “${c.title}” without touching the reel. Ask which they prefer.`);
      },
    },
    {
      name: "renderVideo",
      description: "Render the cut as an actual vertical video file with burned-in captions and a waveform, and save it to the human's machine. This is the end of the job — everything else produces a decision, this produces something they can post. It records in real time (a 40-second cut takes about 40 seconds and plays out loud while it works), so tell them that before you start, and only do it once they're happy with the cut.",
      annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        if (!Store.live().length) return note("The reel is empty — nothing to render.");
        if (Store.state.textOnly) return note("No audio is loaded, so there's nothing to render. Offer them getCutManifest instead — exact timestamps plus an ffmpeg command they can run against their own file.");
        Store.logTool("renderVideo", `${Math.round(Store.reelDur())}s`);
        const r = await UI.renderVideo();
        if (!r?.ok) return note(`Couldn't render: ${r?.error || "unknown error"}`);
        return note(`Rendered “${r.name}” — ${r.seconds}s, ${r.mb} MB, 1080×1920 with burned-in captions. It's saved to their downloads.`);
      },
    },
    {
      name: "findPhrase",
      description: "Locate an exact phrase in the recording and get its precise word-level start and end. Transcript lines are an artefact of how words were grouped, not units of meaning — the sayable thing is often a few words inside a line, or a run that straddles two. Use this when you want to cut to a specific wording rather than to a whole line: pass the words as you'd say them and you get back timings accurate to the word.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          phrase: { type: "string", description: "The words to find, e.g. 'the phone rings a little differently'." },
          nearSec: { type: "number", description: "If the phrase occurs more than once, prefer the one nearest this time." },
        },
        additionalProperties: false,
        required: ["phrase"],
      },
      async execute({ phrase, nearSec }) {
        Store.logTool("findPhrase", `“${String(phrase).slice(0, 34)}”`);
        const hits = Analysis.findPhrase(phrase, { nearSec: nearSec ?? null });
        if (!hits.length) return note(`Couldn't find “${phrase}” — the transcript is machine-generated, so try fewer words, or searchTranscript to see the actual wording.`);
        return ok(hits);
      },
    },
    {
      name: "addPhrase",
      description: "Add a clip that starts and ends on exact words rather than at line boundaries. This is how you cut precisely: instead of taking a whole transcript line and trimming it, say what you want the clip to SAY. Give the opening words, and optionally the closing words — the clip runs from the first to the end of the second.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          startPhrase: { type: "string", description: "Words the clip should start on." },
          endPhrase: { type: "string", description: "Words the clip should end on. Omit to run to the end of that sentence." },
          nearSec: { type: "number", description: "Disambiguate a repeated phrase by time." },
          why: { type: "string", description: "Why this earns its place." },
        },
        additionalProperties: false,
        required: ["startPhrase"],
      },
      async execute({ startPhrase, endPhrase, nearSec, why }) {
        const a = Analysis.findPhrase(startPhrase, { nearSec: nearSec ?? null })[0];
        if (!a) return note(`Couldn't find “${startPhrase}”.`);
        let end = a.endSec;
        if (endPhrase) {
          const b = Analysis.findPhrase(endPhrase, { nearSec: a.startSec }).filter((h) => h.endSec > a.startSec)[0];
          if (!b) return note(`Found the start, but not “${endPhrase}” after it.`);
          end = b.endSec;
        } else {
          const seg = Store.state.segments.find((s) => s.end > a.startSec);
          if (seg) end = Math.max(a.endSec, seg.end);
        }
        Store.logTool("addPhrase", `“${String(startPhrase).slice(0, 26)}…”`);
        const c = Store.addSpan({ start: a.startSec, end, why, ghost: true });
        return note(`Added ${(end - a.startSec).toFixed(1)}s starting on “${a.text}”: “${c.text.slice(0, 100)}”`);
      },
    },
    {
      name: "reshapeClip",
      description: "Change where an existing clip starts or ends, by naming the words rather than guessing seconds. Use it when the human says something like 'start it from where he says the phone rings' — far more reliable than nudging with trimClip until it sounds right.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Clip position from getReelState." },
          startPhrase: { type: "string", description: "New opening words." },
          endPhrase: { type: "string", description: "New closing words." },
        },
        additionalProperties: false,
        required: ["index"],
      },
      async execute({ index, startPhrase, endPhrase }) {
        const c = Store.state.reel[index];
        if (!c) return note(`No clip at index ${index}.`);
        let start = c.start, end = c.end;
        if (startPhrase) {
          const h = Analysis.findPhrase(startPhrase, { nearSec: c.start })[0];
          if (!h) return note(`Couldn't find “${startPhrase}”.`);
          start = h.startSec;
        }
        if (endPhrase) {
          const h = Analysis.findPhrase(endPhrase, { nearSec: c.end })[0];
          if (!h) return note(`Couldn't find “${endPhrase}”.`);
          end = h.endSec;
        }
        if (end - start < 0.4) return note("Those boundaries leave nothing between them.");
        Store.logTool("reshapeClip", `#${index + 1}`);
        Store.trim(c.id, { headSec: start - c.start, tailSec: end - c.end, snap: false });
        return note(`Clip ${index + 1} is now ${(end - start).toFixed(1)}s: “${Store.state.reel[index].text.slice(0, 100)}”`);
      },
    },
    {
      name: "listCapabilities",
      description: "What this page can do, and the order it's usually worth doing it in. Call it first if you've just arrived and want your bearings — it's cheaper than reading every tool description, and it tells you which tools read the AUDIO rather than the transcript, which is where this page can do things you can't do yourself.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        Store.logTool("listCapabilities", "");
        return ok({
          whatThisIs: "A cutting surface for turning a long recording into a short. You do the finding and proposing; the person listening does the judging. Nothing you do is final until they keep it.",
          // Every one of these bottoms out in the RMS envelope in analysis.js.
          // Kept as a list rather than a count so the number can't drift away
          // from the truth — the demo and the write-up both read it from here.
          readsTheAudioNotTheTranscript: [
            "findEnergyMoments — where the voice lifts above its own baseline",
            "snapToBreath — move an edit point into a real pause",
            "tightenClip — dead air out of the middle, audio closed up behind it",
            "cleanUpCut — the same pass across every clip at once",
            "checkFlow — flags joins that land on speech instead of in a breath",
          ],
          suggestedOrder: [
            "getSource — what am I cutting",
            "searchTranscript + findEnergyMoments — topic and delivery; the best clips are where they overlap",
            "proposeCut ×2-3 — contrasting angles, not one best answer",
            "playReel — a cut nobody hears is worthless",
            "getReelState — read their votes, notes, mutes before revising",
            "checkFlow — what an editor would flag",
            "trimClip / reshapeClip / snapToBreath / removeFillers — fix it",
            "renderVideo or exportCut — hand them something they can use",
          ],
          precisionNote: "Transcript lines are how words got grouped, not units of meaning. Prefer findPhrase/addPhrase/reshapeClip to cut on words. Clips can also have stretches omitted from the middle — see tightenClip and omitPhrase.",
          theHumanTalksBack: "humanVote, humanNote and humanAsked in getReelState are them steering you. Read them.",
          toolCount: TOOLS.length,
        });
      },
    },
    {
      name: "tightenClip",
      description: "Take the slack out of the MIDDLE of a clip and close the audio up behind it, the way a text-based editor does — hesitation words if the transcript kept them, and over-long pauses whether it did or not. Transcription usually strips 'um' and 'uh', but the hesitation is still there in the audio as dead air, and this reads the audio. Different from tidyClip, which only trims the edges. Use it on a clip that says the right thing but drags.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { index: { type: "number", description: "Clip position, or omit to clean every clip." } },
      },
      async execute({ index }) {
        const targets = index == null ? Store.state.reel : [Store.state.reel[index]].filter(Boolean);
        if (!targets.length) return note("No clip there.");
        const before = Store.reelDur();
        let n = 0; const what = [];
        for (const c of targets) {
          for (const f of Analysis.slackIn(c)) { Store.omit(c.id, f.start, f.end); what.push(f.why); n++; }
        }
        if (!n) return note("Nothing slack to take out — these clips are already tight.");
        Store.logTool("tightenClip", `${n} cuts`);
        const saved = (before - Store.reelDur()).toFixed(1);
        return note(`Took out ${plural(n, "stretch", "stretches")} (${what.slice(0, 6).join(", ")}${what.length > 6 ? "…" : ""}), saving ${secs(+saved)}. The cut is now ${Math.round(Store.reelDur())}s. Play it back — closing up audio can occasionally sound clipped.`);
      },
    },
    {
      name: "omitPhrase",
      description: "Cut a specific run of words out of the MIDDLE of a clip, keeping what's either side. Use it when a line is nearly right but carries a tangent, a stumble, or a name that means nothing out of context — the sort of thing you'd delete in a text editor and expect the audio to close up behind.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Clip position from getReelState." },
          phrase: { type: "string", description: "The words to take out." },
        },
        additionalProperties: false,
        required: ["index", "phrase"],
      },
      async execute({ index, phrase }) {
        const c = Store.state.reel[index];
        if (!c) return note(`No clip at index ${index}.`);
        const hit = Analysis.findPhrase(phrase, { nearSec: c.start })
          .find((h) => h.startSec >= c.start - 0.1 && h.endSec <= c.end + 0.1);
        if (!hit) return note(`“${phrase}” isn't inside clip ${index + 1}. Its text is: “${c.text}”`);
        Store.logTool("omitPhrase", `“${String(phrase).slice(0, 26)}”`);
        Store.omit(c.id, hit.startSec, hit.endSec);
        return note(`Took out “${hit.text}”. Clip ${index + 1} now says: “${Store.state.reel[index].text.slice(0, 120)}”`);
      },
    },
    {
      name: "redactPhrase",
      description: "Mark material that must not ship — the brand-review case: a comms team comes back with 'take out the bit about the lawsuit' and it has to be gone from every cut, not just the current one. Removes every occurrence across the recording and keeps a standing redaction so it can't creep back into a later cut. Report what you removed; never redact silently.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          phrase: { type: "string", description: "Words to remove everywhere they occur." },
          reason: { type: "string", description: "Why, e.g. 'comms review' — kept on the record and in the export." },
        },
        additionalProperties: false,
        required: ["phrase"],
      },
      async execute({ phrase, reason }) {
        const hits = Analysis.findAll(phrase);
        if (!hits.length) return note(`“${phrase}” doesn't appear in this recording.`);
        Store.logTool("redactPhrase", `“${String(phrase).slice(0, 24)}” ×${hits.length}`);
        let touched = 0;
        for (const h of hits) touched += Store.redact(h.startSec, h.endSec, reason).touched;
        return note(`Redacted ${hits.length} occurrence${hits.length > 1 ? "s" : ""} of “${phrase}”${reason ? ` (${reason})` : ""}. ${touched ? `${plural(touched, "clip")} in the current cut ${touched === 1 ? "was" : "were"} affected.` : "None are in the current cut, but it can't be used in a later one either."} The redaction is on the record and shows in the export.`);
      },
    },
    {
      name: "redactRange",
      description: "Mark a whole stretch of the recording as unusable — for when a review says 'nothing from 12:00 to 14:30 can go out'. Same standing effect as redactPhrase.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { fromSec: { type: "number" }, toSec: { type: "number" }, reason: { type: "string" } },
        required: ["fromSec", "toSec"],
      },
      async execute({ fromSec, toSec, reason }) {
        Store.logTool("redactRange", `${Math.round(fromSec)}–${Math.round(toSec)}s`);
        const r = Store.redact(fromSec, toSec, reason);
        return note(`Marked ${(toSec - fromSec).toFixed(0)}s unusable${reason ? ` (${reason})` : ""}. ${plural(r.touched, "clip")} in the current cut ${r.touched === 1 ? "was" : "were"} affected.`);
      },
    },
    {
      name: "cleanUpCut",
      description: "One pass over the whole cut: remove stammers and false starts (a word repeated within a beat, or a cut-off word), take out hesitations, and close up dead air — across every clip at once. This is the 'clean the script' pass an editor does last, before anyone hears it. Say what you removed and tell them to play it back.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          stammers: { type: "boolean", description: "Remove repeated words and false starts. Default true." },
          slack: { type: "boolean", description: "Remove hesitations and over-long pauses. Default true." },
        },
        additionalProperties: false,
      },
      async execute({ stammers = true, slack = true }) {
        const before = Store.reelDur();
        const found = [];
        for (const c of Store.state.reel) {
          const cuts = [
            ...(stammers ? Analysis.stammersIn(c.start, c.end) : []),
            ...(slack ? Analysis.slackIn(c) : []),
          ].sort((a, b) => a.start - b.start);
          for (const x of cuts) { Store.omit(c.id, x.start, x.end); found.push(x.why); }
        }
        if (!found.length) return note("Nothing to clean — the cut is already tight.");
        Store.logTool("cleanUpCut", `${found.length} cuts`);
        const saved = (before - Store.reelDur()).toFixed(1);
        return note(`Made ${plural(found.length, "cut")} (${[...new Set(found)].slice(0, 6).join("; ")}${found.length > 6 ? "…" : ""}), saving ${secs(+saved)}. Now ${Math.round(Store.reelDur())}s. Play it back — closing up audio can occasionally clip a word.`);
      },
    },
    {
      name: "getCutManifest",
      description: "The precise, machine-usable description of the finished cut: every span with in and out to the hundredth of a second, in playback order, including omissions inside clips, plus a ready-to-run ffmpeg command that produces the file. This is the real deliverable — a 60-second short is often ten or more separate spans, and a vague timestamp is useless downstream. Give it to them when they're done, or when they ask 'what are the actual timestamps'.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { format: { type: "string", enum: ["json", "ffmpeg", "edl"], description: "Defaults to json." } },
      },
      async execute({ format = "json" }) {
        const spans = Store.playSpans();
        if (!spans.length) return note("The reel is empty.");
        Store.logTool("getCutManifest", format);
        const tc = (x) => { const t = Math.floor(x); return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}.${String(Math.round((x % 1) * 1000)).padStart(3, "0")}`; };
        const total = spans.reduce((n, s) => n + (s.end - s.start), 0);
        if (format === "ffmpeg") {
          const f = spans.map((s) => `between(t\,${s.start.toFixed(3)}\,${s.end.toFixed(3)})`).join("+");
          return ok({
            spanCount: spans.length, durationSec: +total.toFixed(2),
            command: `ffmpeg -i INPUT -vf "select='${f}',setpts=N/FRAME_RATE/TB" -af "aselect='${f}',asetpts=N/SR/TB" OUTPUT.mp4`,
            note: "Single-pass select filter. For frame-exact cuts on long sources, cutting each span separately and concat-demuxing is more reliable.",
          });
        }
        if (format === "edl") {
          let rec = 0;
          return ok({ spanCount: spans.length, durationSec: +total.toFixed(2),
            edl: spans.map((s, i) => { const d = s.end - s.start; const line = `${String(i + 1).padStart(3, "0")}  AX  AA/V  C  ${tc(s.start)} ${tc(s.end)} ${tc(rec)} ${tc(rec + d)}`; rec += d; return line; }) });
        }
        let at = 0;
        return ok({
          title: Store.state.source.title, credit: Store.state.source.credit,
          spanCount: spans.length, durationSec: +total.toFixed(2),
          redactionsApplied: Store.state.redactions.length,
          spans: spans.map((s, i) => {
            const row = { n: i + 1, sourceInSec: +s.start.toFixed(2), sourceOutSec: +s.end.toFixed(2),
                          durationSec: +(s.end - s.start).toFixed(2),
                          timelineInSec: +at.toFixed(2), sourceIn: tc(s.start), sourceOut: tc(s.end),
                          text: Store.textBetween(s.start, s.end) };
            at += s.end - s.start;
            return row;
          }),
        });
      },
    },
    {
      name: "getWorkflowState",
      description: "Where this session has got to and what's worth doing next. Cutting a short is a sequence — find, propose, listen, react, tighten, ship — and the useful next move depends on which stage they're at. Call it when you're unsure what to do, or when picking up a session you didn't start.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const S = Store.state, live = Store.live(), d = Store.reelDur();
        const cands = S.candidates.length, votes = S.reel.filter((c) => c.vote).length;
        const pending = S.reel.filter((c) => c.ghost).length;
        const issues = Analysis.checkFlow();
        const played = S.log.some((l) => l.tool === "playReel");
        const omissions = S.reel.reduce((n, c) => n + (c.cuts || []).length, 0);

        let stage = "empty", next;
        if (!live.length) { stage = "empty"; next = ["searchTranscript and findEnergyMoments to see what's here", "proposeCut with two or three contrasting angles"]; }
        else if (!played) { stage = "drafted"; next = ["playReel — they haven't heard it yet, and nothing else matters until they have"]; }
        else if (pending) { stage = "awaiting-verdict"; next = ["Ask which pending clips they want to keep", "getReelState to see what they've already reacted to"]; }
        else if (!votes && !S.notes.length) { stage = "listened"; next = ["Ask what they'd change — a vote or a steer tells you far more than another proposal"]; }
        else if (issues.some((i) => i.severity === "high")) { stage = "needs-work"; next = ["checkFlow and fix the high-severity items", "trimClip / reshapeClip / snapToBreath"]; }
        else if (!omissions) { stage = "polishing"; next = ["cleanUpCut to take out stammers and dead air", "tidyClip on any clip that opens on a filler"]; }
        else { stage = "ready"; next = ["getCutManifest for the exact timestamps", "renderVideo or exportCut to hand it over"]; }

        return ok({
          stage,
          suggestedNext: next,
          clips: live.length, durationSec: +d.toFixed(1), targetSec: S.targetSec,
          candidatesProposed: cands, clipsPendingApproval: pending,
          humanReactions: votes, humanSteers: S.notes.map((n) => n.text),
          omissionsMade: omissions, redactions: S.redactions.length,
          openIssues: issues.length, highSeverity: issues.filter((i) => i.severity === "high").length,
          hasBeenPlayed: played,
        });
      },
    },
    {
      name: "playReel",
      description: "Play the current cut out loud for the human, so they can judge it. Do this after proposing — a cut nobody hears is worthless — then ask what they'd change.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { fromIndex: { type: "number", description: "Clip to start from; omit for the top." } },
      },
      async execute({ fromIndex = 0 }) {
        const l = Store.live();
        if (!l.length) return note("The reel is empty — nothing to play.");
        if (Store.state.textOnly) return note("There's no audio loaded — this transcript came without media, so nothing can be played. The cut is still real: use getCutManifest for exact timestamps, and tell them they can drop the media file onto the page to hear it.");
        Store.logTool("playReel", `${l.length} clips`);
        const started = await Player.playSequence(Store.playSpans());
        const total = l.reduce((n, c) => n + (c.end - c.start), 0);
        if (!started) {
          return note(
            `The browser blocked playback — it won't let a page start audio until the person has ` +
            `interacted with it. The cut is loaded and ready (${l.length} clips, ${total.toFixed(1)}s). ` +
            `Ask them to press Space or hit play once; after that I can start playback for them.`
          );
        }
        return note(`Playing ${l.length} clips, ${total.toFixed(1)}s. Ask them what they'd change once it finishes.`);
      },
    },
  ];

  function register() {
    // recompute surfaces — the point of re-entry is that they changed
    if (!collect()) return;
    const jobs = [];
    for (const s of surfaces) {
      if (typeof s.obj.registerTool === "function") jobs.push(...TOOLS.map((t) => Promise.resolve(s.obj.registerTool(t))));
      if (typeof s.obj.provideContext === "function") jobs.push(Promise.resolve(s.obj.provideContext({ tools: TOOLS })));
    }
    Promise.all(jobs).then(() => {
      window.__agentLive = true;
      globalThis.__cutroomDiag.registered = TOOLS.length;
      globalThis.__cutroomDiag.lateAttach = true;
      whenDom(() => {
        const dot = el("agentDot"), label = el("agentLabel"), empty = el("logEmpty");
        dot.classList.add("live");
        label.textContent = `${TOOLS.length} tools live`;
        empty.innerHTML = `<b>${TOOLS.length} tools registered.</b> The agent attached after page load and they were registered then.`;
      });
    }).catch(() => {});
  }

  if (!mc || typeof mc.registerTool !== "function") {
    whenDom(() => {
      el("agentLabel").textContent = "no WebMCP";
      el("agentDot").title = `${diag}\n\nOpen in ChatGPT's browser, or Chrome 149+ with chrome://flags/#enable-webmcp-testing.`;
      el("logEmpty").innerHTML = `<b>This browser has no WebMCP.</b> The page still works by hand — everything an agent can do, you can do here. ` +
        `To hand it to an agent, open it in ChatGPT's browser, or Chrome&nbsp;149+ with <code>chrome://flags/#enable-webmcp-testing</code>. ` +
        `<code class="diag">${diag}</code>`;
    });
    return;
  }

  // Register on every distinct surface; also hand the full list to the older
  // bulk API wherever it still exists. Harmless where it doesn't.
  const jobs = [];
  for (const s of surfaces) {
    if (typeof s.obj.registerTool === "function") jobs.push(...TOOLS.map((t) => Promise.resolve(s.obj.registerTool(t))));
    if (typeof s.obj.provideContext === "function") jobs.push(Promise.resolve(s.obj.provideContext({ tools: TOOLS })));
  }
  Promise.all(jobs)
    .then(() => {
      window.__agentLive = true;      // steer chips become asks, not local edits
      globalThis.__cutroomDiag.registered = TOOLS.length;
      whenDom(() => {
      const dot = el("agentDot"), label = el("agentLabel"), empty = el("logEmpty");
      dot.classList.add("live");
      label.textContent = `${TOOLS.length} tools live`;
      dot.title = `Registered on: ${diag}\n\n${TOOLS.map((t) => t.name).join(", ")}`;
      empty.innerHTML =
        `<b>${TOOLS.length} tools registered on this page.</b> Nothing has called one yet. ` +
        `<code class="diag">${diag}</code> ` +
        `<span class="hint">In ChatGPT's browser: pick <b>GPT-5.6 Sol</b> or <b>Terra</b> in the model menu — ` +
        `earlier models don't see site tools — then check <b>Site tools</b> in the address bar lists them. ` +
        `Every call lands here.</span>`;
      });
    })
    .catch((err) => {
      globalThis.__cutroomDiag.error = String(err);
      whenDom(() => {
        el("agentLabel").textContent = "registration failed";
        el("agentDot").title = String(err);
        el("logEmpty").innerHTML = `<b>Tool registration failed.</b> ${String(err).slice(0, 160)}`;
      });
      console.error("[cutroom] tool registration failed", err);
    });
})();
