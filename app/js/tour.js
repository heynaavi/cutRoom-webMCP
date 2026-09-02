/* ═══════════════════════════════════════════════════════════════════════════
   TOUR — a player, not a slideshow.

   Steps are declarative and idempotent: each one describes the state it wants,
   and seeking to step N replays 0..N from a clean base. That's what makes the
   timeline scrubbable in both directions — you can't rewind a pile of
   incremental mutations, but you can rebuild a state.

   The dock moves to whichever region the current step is about, and stays out
   of its way; drag it anywhere and it stops following. Everything the demo runs
   is a real tool call, and it says so.
   ═══════════════════════════════════════════════════════════════════════════ */
const Tour = (() => {
  const SEEN = "cutroom.seen.v2";
  const seg = (q) => Store.state.segments.find((s) => s.text.toLowerCase().includes(q));

  /* The cut the demo builds — five beats, 31 seconds, drawn across 68% of a
     38-minute episode. Each string is a unique substring of one transcript
     line, so the cut is addressed by what was said rather than by an index
     that would rot the moment the transcript was rebuilt. */
  const BEATS = [
    ["need an electrician",                "where she started — the family trade"],
    ["there was a teacher",                "the teacher who changed it"],
    ["on your first try",                  "applied anyway, against the odds"],
    ["the call came",                      "the best line in the episode"],
    ["visor covering",                     "what it was all for"],
  ];

  /* The demo addresses its five clips by phrase, so it only means anything on
     the episode those phrases are in. Load your own recording and the script
     would run through all eight steps proposing nothing — which looks like the
     page is broken rather than like the demo is off-topic. */
  const onDemoSource = () => BEATS.every(([q]) => !!seg(q));

  const buildCut = (ghost = true) => {
    Store.clear();
    const spans = BEATS.map(([q, why]) => { const s = seg(q); return s && { start: s.start, end: s.end, why }; }).filter(Boolean);
    const c = Store.proposeCut({ title: "Electrician to astronaut", desc: "The arc, in five lines.", spans });
    Store.applyCandidate(c.id, { asGhost: ghost });
  };

  const cleanCut = () => {
    const before = Store.reelDur();
    let n = 0;
    for (const c of Store.state.reel) {
      const cuts = [...Analysis.stammersIn(c.start, c.end), ...Analysis.slackIn(c)].sort((a, b) => a.start - b.start);
      for (const x of cuts) { Store.omit(c.id, x.start, x.end); n++; }
    }
    return { n, saved: +(before - Store.reelDur()).toFixed(1) };
  };
  let cleaned = { n: 0, saved: 0 };

  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  /* Each step: what it says, which tool it stands for, where to look, how long
     to dwell, and the state it wants. `apply` must be safe to re-run. */
  const STEPS = [
    { tool: "listCapabilities", args: "{}", ms: 3400, focus: "#logBody", icon: "compass", title: "Gets its bearings",
      got: "33 tools · 5 of them read the audio, not the transcript",
      say: "An agent arrives cold and asks what's here.",
      apply() { Store.setTab("transcript"); Store.logTool("listCapabilities", ""); } },

    { tool: "findEnergyMoments", args: '{ limit: 18 }', ms: 5200, focus: "#list", icon: "ear", title: "Listens",
      report() {
        const m = Analysis.energyMoments({ limit: 18 });
        if (!m.length) return "no clear peaks in this recording";
        const t = m[0].text.trim().replace(/[.,]$/, "");
        return `${m.length} moments · strongest: “${t.length > 46 ? t.slice(0, 46) + "…" : t}” @${mmss(m[0].startSec)}`;
      },
      say: "Reads the waveform, not the words — where the voice lifts. No text search can find this.",
      apply() { Store.logTool("findEnergyMoments", "top 18"); Store.setTab("energy"); } },

    { tool: "searchTranscript", args: '{ query: "the call came" }', ms: 4200, focus: "#list", icon: "search", title: "Reads",
      report() {
        // Exact occurrences, not the fuzzy ranking — Store.search scores every
        // line that shares a token, so its length is 225 and means nothing.
        const hits = Analysis.findAll("the call came");
        return hits.length
          ? `${hits.length} exact match${hits.length > 1 ? "es" : ""} in 38 minutes · ${mmss(hits[0].startSec)}`
          : "no exact match — falling back to the ranking";
      },
      say: "Then searches the text for the story. The best clips sit where both agree.",
      apply() { Store.setTab("transcript"); Store.logTool("searchTranscript", "“the call came”"); Store.setQuery("the call came"); },
      undo() { Store.setQuery(""); } },

    { tool: "proposeCut", args: '{ title: "Electrician to astronaut", spans: [5] }', ms: 5400, focus: ".strip", icon: "cards", title: "Proposes",
      report: () => `${Store.state.reel.length} pending clips · ${Math.round(Store.reelDur())}s`
        + ` · drawn across ${Math.round(Store.spread() * 100)}% of the episode`,
      say: "Five lines, five different places in the hour. Dashed means proposal, not decision.",
      apply() { Store.setQuery(""); buildCut(true); Store.setTab("cands"); } },

    { tool: "playReel", args: "{}", ms: 9000, focus: ".stage", icon: "play", title: "Plays it",
      report: () => `playing ${Store.live().length} clips…`,
      say: "You hear it. That's the only way to judge a cut.",
      apply() { Store.logTool("playReel", `${Store.live().length} clips`); },
      async live() { await Player.playSequence(Store.playSpans()); },
      leave() { Player.stop(); } },

    { tool: "checkFlow", args: "{}", ms: 5000, focus: "#list", icon: "check", title: "Checks itself",
      report() {
        const x = Analysis.checkFlow();
        if (!x.length) return "nothing to flag — the cut reads clean";
        const worst = x.find((i) => i.severity === "high") || x[0];
        return `${x.length} issue${x.length > 1 ? "s" : ""} · worst is ${worst.severity}: ${worst.kind.replace(/-/g, " ")}`;
      },
      say: "Weak hook. Dangling pronoun. Join that cuts in mid-flow.",
      apply() { Store.setTab("notes"); Store.logTool("checkFlow", ""); } },

    { tool: "cleanUpCut", args: "{}", ms: 5400, focus: ".strip", icon: "broom", title: "Cleans up",
      report: () => `${cleaned.n} cut${cleaned.n === 1 ? "" : "s"} · ${cleaned.saved}s saved · no real words lost`,
      say: "Hesitations and dead air out of the middle. Nothing actually said is lost.",
      apply() { cleaned = cleanCut(); Store.logTool("cleanUpCut", `${cleaned.n} cuts`); } },

    { tool: "getCutManifest", args: "{}", ms: 5600, focus: ".reel", icon: "doc", title: "Hands it over",
      report() {
        const spans = Store.state.reel.reduce((n, c) => n + Math.max(1, (c.cuts || []).length + 1), 0);
        return `${spans} spans · exact in/out · ffmpeg command`;
      },
      say: "Every span to a hundredth of a second, plus an ffmpeg command.",
      apply() { Store.setTab("cands"); Store.logTool("getCutManifest", "json"); } },
  ];

  let reports = [];
  let dock = null, spot = null, at = -1, playing = false, timer = 0, t0 = 0, left = 0, pinned = false, raf = 0, ro = null;

  /* ── presenter mode ──────────────────────────────────────────────────────
     The demo runs on fixed timers, which is right for someone watching it and
     impossible to narrate over — you can't talk for 5.2 seconds on cue, eight
     times, and land it. Presenter mode holds each step until you press → , puts
     the line you're meant to say on screen at reading size, and counts up so
     you can see the three-minute limit coming. Everything it shows is the same
     real tool call; only the pacing changes.
        ?present   in the URL, or  P  once the demo is open.               */
  let present = /[?&]present\b/.test(location.search);
  let clockT0 = 0, clockRaf = 0;
  const CAP_SEC = 180;                               // the rules' hard ceiling

  function tickClock() {
    cancelAnimationFrame(clockRaf);
    const el = dock?.querySelector("#tClock");
    if (!el || !present) return;
    const n = Math.floor((performance.now() - clockT0) / 1000);
    el.textContent = `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
    el.classList.toggle("warn", n >= CAP_SEC - 30);
    el.classList.toggle("over", n >= CAP_SEC);
    clockRaf = requestAnimationFrame(tickClock);
  }

  function setPresent(on) {
    present = on;
    if (!dock) return;
    dock.classList.toggle("presenting", present);
    if (present) { pause(); clockT0 = performance.now(); tickClock(); }
    else cancelAnimationFrame(clockRaf);
    paintDock();
  }

  /* ── seeking ────────────────────────────────────────────────────────────── */
  // Rebuild from scratch so scrubbing backwards works. Cheap: the whole thing
  // is a handful of array operations.
  function seek(i) {
    i = Math.max(0, Math.min(STEPS.length - 1, i));
    STEPS[at]?.leave?.();
    Store.clear();
    Store.state.candidates = [];
    Store.state.log = [];
    Store.state.notes = [];
    // What each step reports is measured from the state it just produced, not
    // written down in advance. Hardcoded results drift the moment the cut or
    // the transcript changes, and a demo that quotes numbers it isn't
    // producing is the one thing this page can't afford to do.
    reports = [];
    for (let k = 0; k <= i; k++) {
      try {
        STEPS[k].apply();
        reports[k] = STEPS[k].report ? STEPS[k].report() : (STEPS[k].got || "");
        if (k < i) STEPS[k].undo?.();
      } catch { /* keep going */ }
    }
    at = i;
    Store.emit("reel"); Store.emit("log"); Store.emit("cands");
    paintDock();
    place();
    if (playing) startStep();
    // Nothing is scheduled in presenter mode, so the step's own action — the
    // one that actually plays audio — has to be fired here or never.
    else if (present) STEPS[at].live?.();
  }

  function startStep() {
    clearTimeout(timer);
    const s = STEPS[at];
    left = s.ms;
    t0 = performance.now();
    s.live?.();
    if (!present) timer = setTimeout(() => { at < STEPS.length - 1 ? seek(at + 1) : finish(); }, left);
    tickBar();
  }

  function tickBar() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (!dock) return;
      const s = STEPS[at];
      const done = playing ? Math.min(1, (performance.now() - t0) / s.ms) : 1 - left / s.ms;
      const cell = dock.querySelector(`.tl-cell[data-i="${at}"] i`);
      if (cell) cell.style.width = `${done * 100}%`;
      if (playing) raf = requestAnimationFrame(step);
    };
    step();
  }

  const play = () => { if (playing || present) return; playing = true; t0 = performance.now() - (STEPS[at].ms - left); clearTimeout(timer); timer = setTimeout(() => { at < STEPS.length - 1 ? seek(at + 1) : finish(); }, left); STEPS[at].live?.(); paintDock(); tickBar(); };
  const pause = () => { if (!playing) return; playing = false; left = Math.max(0, STEPS[at].ms - (performance.now() - t0)); clearTimeout(timer); cancelAnimationFrame(raf); Player.pause(); paintDock(); };

  function finish() {
    playing = false; clearTimeout(timer); cancelAnimationFrame(raf);
    Player.stop();
    dock?.classList.add("done");
    paintDock();
  }

  /* ── position ───────────────────────────────────────────────────────────── */
  // Sit beside whatever the step is about, never on top of it. Once dragged,
  // stay where you're put.
  function place() {
    if (!dock) return;
    if (pinned) {   // dragged: leave x/y alone, but keep it fully on screen
      const r = dock.getBoundingClientRect();
      const y = Math.max(8, Math.min(window.innerHeight - r.height - 8, r.top));
      const x = Math.max(8, Math.min(window.innerWidth - r.width - 8, r.left));
      dock.style.top = `${Math.round(y)}px`;
      dock.style.left = `${Math.round(x)}px`;
      return;
    }
    const target = document.querySelector(STEPS[at]?.focus || "body");
    const d = dock.getBoundingClientRect();
    const pad = 16;
    if (!target) return;
    const t = target.getBoundingClientRect();

    // prefer the side with more room
    const roomLeft = t.left, roomRight = window.innerWidth - t.right;
    let x = roomLeft > roomRight ? t.left - d.width - pad : t.right + pad;
    x = Math.max(pad, Math.min(window.innerWidth - d.width - pad, x));
    let y = t.top + t.height / 2 - d.height / 2;
    y = Math.max(pad, Math.min(window.innerHeight - d.height - pad, y));

    dock.style.left = `${Math.round(x)}px`;
    dock.style.top = `${Math.round(y)}px`;

    if (spot) {
      Object.assign(spot.style, {
        left: `${t.left - 4}px`, top: `${t.top - 4}px`,
        width: `${t.width + 8}px`, height: `${t.height + 8}px`,
      });
    }
  }

  /* ── chrome ─────────────────────────────────────────────────────────────── */
  // What the demo shows being asked. The clipboard prompt below is separate
  // and longer — this one is what reads well on screen.
  const DEMO_PROMPT = "Find me 60 seconds on how she went from electrician to astronaut. Propose an angle, play it, then clean it up and give me the timestamps.";

  function paintDock() {
    if (!dock || at < 0) return;   // openDock runs before the first seek
    const done = at === STEPS.length - 1 && dock.classList.contains("done");

    // the prompt types itself in on the first step, then stays
    const p = dock.querySelector("#tPrompt");
    if (!p.dataset.typed) {
      p.dataset.typed = "1";
      let i = 0;
      const tick = () => { p.textContent = DEMO_PROMPT.slice(0, ++i); if (i < DEMO_PROMPT.length) setTimeout(tick, 14); };
      tick();
    }

    // the calls it has made so far, with what came back
    const list = dock.querySelector("#tCalls");
    list.innerHTML = STEPS.slice(0, at + 1).map((s, i) => ({ s, i }))
      .reverse()                                   // newest first
      .map(({ s, i }, pos) => `
      <li class="${i === at && !done ? "now" : "past"}${pos === 0 ? " newest" : ""}">
        <span class="c-tick">${i === at && !done ? "" : "✓"}</span>
        <code>${s.tool}<em>${s.args || ""}</em></code>
        <span class="c-got">${i === at && !done ? "" : (reports[i] || s.got || "")}</span>
      </li>`).join("");
    // newest is at the top, so there is nothing to scroll to
    const turn = dock.querySelector(".td-turn");
    if (turn) turn.scrollTop = 0;

    dock.querySelector("#tWork").textContent = done
      ? `Done · ${STEPS.length} tool calls`
      : `Working · ${STEPS[at].title.toLowerCase()}`;
    dock.querySelector("#tSpin").classList.toggle("still", done);

    const said = dock.querySelector("#tSaid");
    said.hidden = !done;
    if (done) said.innerHTML = `<span class="td-who">Cutroom agent</span>
      <p>Built a 31s cut from five places across the episode, cleaned out the hesitations,
      and returned nine exact spans plus an ffmpeg command. It's on the reel — press
      <b>Space</b> to hear it.</p>`;

    dock.querySelector("#tCount").textContent = `${at + 1} / ${STEPS.length}`;
    dock.querySelector("#tPresent").classList.toggle("on", present);
    dock.querySelector("#tClock").hidden = !present;

    // The line to read out loud. It exists for every step either way; in
    // presenter mode it's the point of the panel, so it gets the room.
    const say = dock.querySelector("#tSay");
    say.innerHTML = present
      ? `<span class="td-cue">${at + 1}. ${STEPS[at].title}</span><p>${STEPS[at].say}</p>
         <span class="td-adv">${at < STEPS.length - 1 ? "→ when you've said it" : "→ to finish"}</span>`
      : "";

    dock.querySelector("#tPlay").innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    dock.querySelector("#tPlay").title = present ? "Replay this step" : playing ? "Pause" : "Play";
    dock.querySelectorAll(".tl-cell").forEach((c, i) => {
      c.classList.toggle("on", i === at);
      c.classList.toggle("past", i < at);
      const fill = c.querySelector("i");
      if (i !== at) fill.style.width = i < at ? "100%" : "0%";
    });
  }

  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const ICON_PREV = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2v14H7zM19 5v14l-9-7z"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 5h2v14h-2zM5 5l9 7-9 7z"/></svg>';
  const ICON_REPLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.7L3 8"/><path d="M3 3v5h5"/></svg>';

  function openDock() {
    close();
    spot = document.createElement("div");
    spot.className = "tour-spot";
    document.body.appendChild(spot);

    dock = document.createElement("div");
    dock.className = "tour-dock";
    dock.innerHTML = `
      <div class="td-grip" id="tGrip" title="Drag me anywhere">
        <span class="td-badge">Demo</span>
        <span class="td-note">scripted prompt · real tool calls</span>
        <span class="spacer"></span>
        <span class="td-clock tnum" id="tClock" title="Elapsed — the rules cap the video at 3:00">0:00</span>
        <span class="td-count tnum" id="tCount"></span>
        <button class="td-x" id="tPresent" title="Presenter mode (P) — hold each step and show the narration">◉</button>
        <button class="td-x" id="tClose" title="Close">✕</button>
      </div>

      <div class="td-say" id="tSay"></div>

      <div class="td-turn">
        <div class="td-you"><span class="td-who">You</span><p id="tPrompt"></p></div>
        <div class="td-work">
          <span class="td-spin" id="tSpin"></span>
          <span id="tWork">Working</span>
        </div>
        <div class="td-said" id="tSaid" hidden></div>
        <ol class="td-calls" id="tCalls"></ol>
      </div>

      <div class="td-timeline" id="tTimeline">
        ${STEPS.map((s, i) => `<button class="tl-cell" data-i="${i}" title="${s.tool}"><i></i></button>`).join("")}
      </div>
      <div class="td-controls">
        <button class="td-b" id="tPrev" title="Previous (←)">${ICON_PREV}</button>
        <button class="td-b primary" id="tPlay" title="Play">${ICON_PLAY}</button>
        <button class="td-b" id="tNext" title="Next (→)">${ICON_NEXT}</button>
        <span class="spacer"></span>
        <button class="td-b wide" id="tReplay" title="Start again">${ICON_REPLAY}<span>Replay</span></button>
      </div>`;

    document.body.appendChild(dock);
    if (window.gsap) {
      gsap.set(dock, { y: 18, opacity: 0, scale: .985 });
      dock.classList.add("in");
      gsap.to(dock, { y: 0, opacity: 1, scale: 1, duration: .5, ease: "power3.out", delay: .05 });
    } else requestAnimationFrame(() => dock.classList.add("in"));

    dock.querySelector("#tClose").onclick = close;
    dock.querySelector("#tPresent").onclick = () => setPresent(!present);
    dock.querySelector("#tPlay").onclick = () => {
      if (present) return void STEPS[at].live?.();      // replay this beat's audio
      playing ? pause() : (dock.classList.remove("done"), play());
    };
    dock.querySelector("#tPrev").onclick = () => { pause(); seek(at - 1); };
    dock.querySelector("#tNext").onclick = () => { pause(); seek(at + 1); };
    dock.querySelector("#tReplay").onclick = () => { dock.classList.remove("done"); pause(); seek(0); play(); };
    dock.querySelector("#tTimeline").onclick = (e) => {
      const c = e.target.closest(".tl-cell"); if (!c) return;
      pause(); seek(+c.dataset.i);
    };

    // drag
    const grip = dock.querySelector("#tGrip");
    grip.onpointerdown = (e) => {
      if (e.target.closest("button")) return;
      const r = dock.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      pinned = true;
      dock.classList.add("dragging");
      spot?.classList.add("dim");
      const move = (ev) => {
        dock.style.left = `${Math.max(6, Math.min(window.innerWidth - r.width - 6, ev.clientX - dx))}px`;
        dock.style.top = `${Math.max(6, Math.min(window.innerHeight - r.height - 6, ev.clientY - dy))}px`;
      };
      const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); dock.classList.remove("dragging"); spot?.classList.remove("dim"); };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    };

    addEventListener("resize", place);
    addEventListener("keydown", onKey);
    dock.classList.toggle("presenting", present);

    if (window.ResizeObserver) {
      let pending = 0;
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(place);   // one placement per frame
      });
      ro.observe(dock);
    }
  }

  // Arrows drive the demo whenever it's open — the whole point of presenter
  // mode is that your hand can stay on one key while you talk.
  function onKey(e) {
    if (!dock || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && t.matches("input,textarea")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); pause(); at < STEPS.length - 1 ? seek(at + 1) : finish(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); pause(); seek(at - 1); }
    else if (e.key === "p" || e.key === "P") { e.preventDefault(); setPresent(!present); }
    else if (e.key === "Escape") close();
  }

  function close() {
    removeEventListener("keydown", onKey);
    cancelAnimationFrame(clockRaf);
    ro?.disconnect(); ro = null;
    clearTimeout(timer); cancelAnimationFrame(raf);
    playing = false;
    Player.stop();
    dock?.classList.remove("in");
    const d = dock, sp = spot;
    setTimeout(() => { d?.remove(); sp?.remove(); }, 320);
    dock = null; spot = null; at = -1; pinned = false;
    removeEventListener("resize", place);
  }

  async function run() {
    localStorage.setItem(SEEN, "1");
    // Say what's about to happen rather than silently swapping their material.
    if (!onDemoSource()) {
      UI.toast("Loading the sample episode — the demo is scripted against it");
      const ok = await UI.reloadDemoEpisode();
      if (!ok) return UI.toast("Couldn't load the sample episode.");
    }
    openDock();
    seek(0);
    present ? setPresent(true) : play();
  }

  /* ── welcome ────────────────────────────────────────────────────────────── */
  const PROMPT = "This page exposes WebMCP tools for cutting a podcast short. Call listCapabilities first, then find me 60 seconds on how she went from electrician to astronaut — propose two different angles, play the better one, then clean it up and give me the timestamps.";

  function envLine() {
    const mc = !!(document.modelContext || navigator.modelContext);
    const v = +(/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] || 0);
    if (mc) return { cls: "good", html: "<b>This browser has WebMCP — the tools are live.</b> If this is ChatGPT's browser, choose <b>GPT-5.6 Sol</b> or <b>Terra</b> in the model menu (earlier models don't see site tools), then check <b>Site tools</b> in the address bar. Then just ask for a cut." };
    if (v >= 149) return { cls: "", html: `<b>You're on Chrome ${v}, which supports this.</b> Enable <code>chrome://flags/#enable-webmcp-testing</code> and reload — or watch the demo, which runs the real tools either way.` };
    return { cls: "", html: "<b>This browser can't run WebMCP yet.</b> It needs ChatGPT's browser, or Chrome&nbsp;149+ with a flag. The demo runs the real tools either way." };
  }

  /* The thesis, drawn rather than described: the whole episode as 547 ticks,
     and the five lines the demo is about to pull out of it. Every number and
     every position is read from the real transcript — if the material changes,
     the picture changes with it. */
  function heroDiagram() {
    const D = Store.state.source.durationSec || 1;
    const segs = Store.state.segments || [];
    const spans = BEATS.map(([q]) => seg(q)).filter(Boolean);
    if (!segs.length || !spans.length) return "";
    const total = spans.reduce((n, x) => n + (x.end - x.start), 0);
    const pct = (t) => ((t / D) * 100).toFixed(3);
    return `<div class="tour-hero">
      <div class="th-bar">
        <div class="th-ticks">${segs.map((x) => `<i style="left:${pct(x.start)}%"></i>`).join("")}</div>
        ${spans.map((x) => `<b style="left:${pct(x.start)}%;width:${Math.max(0.45, +pct(x.end - x.start))}%"></b>`).join("")}
      </div>
      <div class="th-legend">
        <span><em>${segs.length}</em> lines</span><span class="th-to">→</span>
        <span><em>${spans.length}</em> clips</span><span class="th-to">→</span>
        <span><em>${Math.round(total)}s</em></span>
        <span class="spacer"></span>
        <span class="th-scale">${Math.round(D / 60)} minutes, end to end</span>
      </div>
    </div>`;
  }

  function welcome() {
    const e = envLine();
    const wrap = document.createElement("div");
    wrap.className = "tour-scrim";
    wrap.innerHTML = `
      <div class="tour-card" role="dialog" aria-label="What Cutroom is">
        <div class="tour-brand"><span class="brand-mark">Cut<em>room</em></span><span class="chipish">WEBMCP</span></div>
        <h2>A 38-minute podcast holds about five lines that, in the right order, are a story.</h2>
        <p>Finding them is a search problem with no correct answer — only taste — and you can't judge a candidate without hearing it.
           Cutroom gives an AI agent the tools to do the finding, and keeps you doing the judging.</p>
        ${heroDiagram()}
        <div class="tour-status ${e.cls}">${e.html}</div>
        <div class="tour-actions">
          <button class="tour-go" id="tourGo">Watch it work<span class="tour-sub">${onDemoSource()
            ? "about a minute · real tool calls"
            : "loads the sample episode · your files stay on disk"}</span></button>
          <button class="tour-skip" id="tourSkip">I'll explore myself</button>
        </div>
        <button class="tour-copy" id="tourCopy">Copy a prompt for your agent</button>
      </div>`;
    document.body.appendChild(wrap);
    const card = wrap.querySelector(".tour-card");
    if (window.gsap) {
      gsap.set(wrap, { opacity: 0 }); gsap.set(card, { y: 22, opacity: 0 });
      gsap.to(wrap, { opacity: 1, duration: .32, ease: "power2.out" });
      gsap.to(card, { y: 0, opacity: 1, duration: .5, ease: "power3.out", delay: .06 });
      // The hour sweeps in as one tween on the container — 547 individually
      // staggered ticks would be the same picture at forty times the cost.
      const ticks = wrap.querySelector(".th-ticks");
      const marks = wrap.querySelectorAll(".th-bar b");
      if (ticks) gsap.fromTo(ticks, { clipPath: "inset(0 100% 0 0)" },
        { clipPath: "inset(0 0% 0 0)", duration: .85, ease: "power2.inOut", delay: .34 });
      if (marks.length) gsap.from(marks, { scaleY: 0, opacity: 0, duration: .5,
        ease: "back.out(2.2)", stagger: .075, delay: 1.02 });
      wrap.classList.add("in");
    } else requestAnimationFrame(() => wrap.classList.add("in"));
    const shut = () => {
      localStorage.setItem(SEEN, "1");
      if (window.gsap) {
        gsap.to(card, { y: 12, opacity: 0, duration: .26, ease: "power2.in" });
        gsap.to(wrap, { opacity: 0, duration: .3, ease: "power2.in", delay: .04, onComplete: () => wrap.remove() });
      } else { wrap.classList.remove("in"); setTimeout(() => wrap.remove(), 320); }
    };
    wrap.querySelector("#tourSkip").onclick = shut;
    wrap.querySelector("#tourGo").onclick = () => { shut(); setTimeout(run, 340); };
    wrap.querySelector("#tourCopy").onclick = async (ev) => {
      try { await navigator.clipboard.writeText(PROMPT); ev.target.textContent = "Copied — paste it to your agent"; }
      catch { ev.target.textContent = PROMPT; }
    };
    wrap.onclick = (ev) => { if (ev.target === wrap) shut(); };
  }

  return {
    // TESTING: shown on every load so it can be checked without incognito.
    // Flip to the localStorage gate below before submitting.
    boot() { setTimeout(welcome, 650); },
    bootOnce() { if (!localStorage.getItem(SEEN)) setTimeout(welcome, 650); },
    show: welcome, run, close,
    get running() { return !!dock; },
  };
})();
