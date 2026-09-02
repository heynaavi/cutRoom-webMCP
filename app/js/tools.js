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
  const mc = globalThis.document?.modelContext || globalThis.navigator?.modelContext;
  const dot = document.getElementById("agentDot");
  const label = document.getElementById("agentLabel");

  const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
  const note = (t) => ({ content: [{ type: "text", text: t }] });

  const TOOLS = [
    {
      name: "getSource",
      description: "Describe the loaded recording: title, duration, credit, and how many transcript lines it has. Call this first to know what you are cutting.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        Store.logTool("getSource", "");
        const s = Store.state.source;
        return ok({ title: s.title, durationSec: s.durationSec, credit: s.credit, lineCount: Store.state.segments.length });
      },
    },
    {
      name: "searchTranscript",
      description: "Find candidate lines anywhere in the recording. Returns transcript lines with their exact start/end seconds, which you pass to addSpan or proposeCut. Search by topic, phrase, or emotion — e.g. 'self doubt', 'the moment he got the call', 'rejection'. Use minSec/maxSec to filter by line length so you only get lines that can stand alone in a short.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words or phrase to look for." },
          limit: { type: "number", description: "Max results (default 25)." },
          minSec: { type: "number", description: "Only lines at least this long." },
          maxSec: { type: "number", description: "Only lines at most this long." },
        },
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
      inputSchema: {
        type: "object",
        properties: {
          fromSec: { type: "number", description: "Start of the window, in seconds." },
          toSec: { type: "number", description: "End of the window, in seconds." },
        },
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
      inputSchema: { type: "object", properties: {} },
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
      inputSchema: {
        type: "object",
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
      inputSchema: {
        type: "object",
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          why: { type: "string", description: "Why it belongs, in a few words." },
          atIndex: { type: "number", description: "Position in the reel; omit to append." },
        },
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
      inputSchema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] },
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
      inputSchema: {
        type: "object",
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
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Name of the recording." },
          credit: { type: "string", description: "Source or attribution, if any." },
          mediaUrl: { type: "string", description: "Optional direct URL to the audio/video. Must be CORS-readable; omit if unsure." },
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
          `Loaded “${title}” — ${data.segments.length} lines, ${Math.round(data.durationSec / 60)} minutes.` +
          (mediaUrl ? " Audio attached." : " No audio: the human can drop the media file onto the page to hear cuts, or work silently from the text.")
        );
      },
    },
    {
      name: "trimClip",
      description: "Nudge a clip's in and out points, in seconds. Negative headSec starts EARLIER, positive starts later; negative tailSec ends earlier, positive ends later. This is most of what makes a cut tight — a clip that starts half a word late or runs two seconds past the point is the difference between sharp and slack. Boundaries snap to the nearest word so you never cut mid-syllable. Use small values (0.3-1.5s) and play it back.",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Clip position from getReelState (0-based)." },
          headSec: { type: "number", description: "Move the start. Negative = start earlier." },
          tailSec: { type: "number", description: "Move the end. Negative = end earlier." },
        },
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
      inputSchema: { type: "object", properties: {} },
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
      description: "Hand the finished cut to the human as a file they can take into an editor. 'edl' gives timecoded in/out points, 'json' gives the raw spans and text, 'text' gives a readable script. Offer this once they sound happy — a cut that can't leave the browser is a toy.",
      inputSchema: {
        type: "object",
        properties: { format: { type: "string", enum: ["edl", "json", "text"], description: "Defaults to json." } },
      },
      async execute({ format = "json" }) {
        const l = Store.live();
        if (!l.length) return note("The reel is empty — nothing to export.");
        Store.logTool("exportCut", format);
        const name = UI.exportCut(format);
        return note(`Exported ${l.length} clips as ${format.toUpperCase()} — the file “${name}” is downloading for them now.`);
      },
    },
    {
      name: "undoLastChange",
      description: "Undo the last change to the reel. Use this immediately if the human says a change made it worse — it restores what was there before rather than making them rebuild by hand.",
      inputSchema: { type: "object", properties: {} },
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
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many moments to return (default 12)." },
          minSec: { type: "number", description: "Shortest moment worth returning." },
          maxSec: { type: "number", description: "Longest moment worth returning." },
        },
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
      inputSchema: { type: "object", properties: {} },
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
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Clip position from getReelState (0-based)." },
          edge: { type: "string", enum: ["in", "out", "both"], description: "Which end to move. Defaults to both." },
        },
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
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number" },
          role: { type: "string", enum: ["hook", "setup", "turn", "payoff", "button", "none"] },
        },
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
      inputSchema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] },
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
      inputSchema: {
        type: "object",
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
      inputSchema: {
        type: "object",
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
      inputSchema: { type: "object", properties: {} },
      async execute() {
        if (!Store.live().length) return note("The reel is empty — nothing to render.");
        Store.logTool("renderVideo", `${Math.round(Store.reelDur())}s`);
        const r = await UI.renderVideo();
        if (!r?.ok) return note(`Couldn't render: ${r?.error || "unknown error"}`);
        return note(`Rendered “${r.name}” — ${r.seconds}s, ${r.mb} MB, 1080×1920 with burned-in captions. It's saved to their downloads.`);
      },
    },
    {
      name: "playReel",
      description: "Play the current cut out loud for the human, so they can judge it. Do this after proposing — a cut nobody hears is worthless — then ask what they'd change.",
      inputSchema: {
        type: "object",
        properties: { fromIndex: { type: "number", description: "Clip to start from; omit for the top." } },
      },
      async execute({ fromIndex = 0 }) {
        const l = Store.live();
        if (!l.length) return note("The reel is empty — nothing to play.");
        Store.logTool("playReel", `${l.length} clips`);
        const started = await Player.playSequence(l.slice(Math.max(0, fromIndex)));
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

  const empty = document.getElementById("logEmpty");

  if (!mc || typeof mc.registerTool !== "function") {
    label.textContent = "no WebMCP";
    dot.title = "This browser doesn't expose document.modelContext. Open in ChatGPT's browser, or Chrome 149+ with chrome://flags/#enable-webmcp-testing.";
    empty.innerHTML = "<b>This browser has no WebMCP.</b> The page still works by hand — everything an agent can do, you can do here. To hand it to an agent, open it in ChatGPT's browser, or Chrome&nbsp;149+ with <code>chrome://flags/#enable-webmcp-testing</code>.";
    return;
  }

  Promise.all(TOOLS.map((t) => mc.registerTool(t)))
    .then(() => {
      dot.classList.add("live");
      window.__agentLive = true;      // steer chips become asks, not local edits
      label.textContent = `${TOOLS.length} tools live`;
      dot.title = TOOLS.map((t) => t.name).join(", ");
      empty.innerHTML =
        `<b>${TOOLS.length} tools registered on this page.</b> Nothing has called one yet — ` +
        `the browser exposes them, but an agent has to be the thing that uses them. ` +
        `Ask ChatGPT (or whatever agent you're running here) for a cut, and every call it makes lands in this list.`;
    })
    .catch((err) => {
      label.textContent = "registration failed";
      dot.title = String(err);
      empty.innerHTML = `<b>Tool registration failed.</b> ${String(err).slice(0, 160)}`;
      console.error("[cutroom] tool registration failed", err);
    });
})();
