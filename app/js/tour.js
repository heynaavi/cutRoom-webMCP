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

  /* The cut the demo builds — five beats from five places in the hour. */
  const BEATS = [
    ["need an electrician", "where he started — the family trade"],
    ["there was a teacher", "the teacher who changed it"],
    ["dream since", "the dream, named"],
    ["the call came", "the best line in the episode"],
    ["it's been", "lands it"],
  ];

  const buildCut = (ghost = true) => {
    Store.clear();
    const spans = BEATS.map(([q, why]) => { const s = seg(q); return s && { start: s.start, end: s.end, why }; }).filter(Boolean);
    const c = Store.proposeCut({ title: "Electrician to astronaut", desc: "The arc, in five lines.", spans });
    Store.applyCandidate(c.id, { asGhost: ghost });
  };

  const cleanCut = () => {
    let n = 0;
    for (const c of Store.state.reel) {
      const cuts = [...Analysis.stammersIn(c.start, c.end), ...Analysis.slackIn(c)].sort((a, b) => a.start - b.start);
      for (const x of cuts) { Store.omit(c.id, x.start, x.end); n++; }
    }
    return n;
  };

  /* Each step: what it says, which tool it stands for, where to look, how long
     to dwell, and the state it wants. `apply` must be safe to re-run. */
  const STEPS = [
    { tool: "listCapabilities", ms: 3600, focus: "#logBody", icon: "compass", title: "Gets its bearings",
      say: "An agent arrives cold and asks what's here.",
      apply() { Store.setTab("transcript"); Store.logTool("listCapabilities", ""); } },

    { tool: "findEnergyMoments", ms: 5600, focus: "#list", icon: "ear", title: "Listens",
      say: "Reads the waveform, not the words — where the voice lifts. No text search can find this.",
      apply() { Store.logTool("findEnergyMoments", "top 18"); Store.setTab("energy"); } },

    { tool: "searchTranscript", ms: 4400, focus: "#list", icon: "search", title: "Reads",
      say: "Then searches the text for the story. The best clips sit where both agree.",
      apply() { Store.setTab("transcript"); Store.logTool("searchTranscript", "“the call came”"); Store.setQuery("the call came"); },
      undo() { Store.setQuery(""); } },

    { tool: "proposeCut", ms: 5600, focus: ".strip", icon: "cards", title: "Proposes",
      say: "Five lines, five different places in the hour. Dashed means proposal, not decision.",
      apply() { Store.setQuery(""); buildCut(true); Store.setTab("cands"); } },

    { tool: "playReel", ms: 9000, focus: ".stage", icon: "play", title: "Plays it",
      say: "You hear it. That's the only way to judge a cut.",
      apply() { Store.logTool("playReel", `${Store.live().length} clips`); },
      async live() { await Player.playSequence(Store.playSpans()); },
      leave() { Player.stop(); } },

    { tool: "checkFlow", ms: 5400, focus: "#list", icon: "check", title: "Checks itself",
      say: "Weak hook. Dangling pronoun. Join that cuts in mid-flow.",
      apply() { Store.setTab("notes"); Store.logTool("checkFlow", ""); } },

    { tool: "cleanUpCut", ms: 5800, focus: ".strip", icon: "broom", title: "Cleans up",
      say: "Hesitations and dead air out of the middle. Nothing actually said is lost.",
      apply() { const n = cleanCut(); Store.logTool("cleanUpCut", `${n} cuts`); } },

    { tool: "getCutManifest", ms: 5600, focus: ".reel", icon: "doc", title: "Hands it over",
      say: "Every span to a hundredth of a second, plus an ffmpeg command.",
      apply() { Store.setTab("cands"); Store.logTool("getCutManifest", "json"); } },
  ];

  let dock = null, spot = null, at = -1, playing = false, timer = 0, t0 = 0, left = 0, pinned = false, raf = 0;

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
    for (let k = 0; k <= i; k++) {
      try { STEPS[k].apply(); if (k < i) STEPS[k].undo?.(); } catch { /* keep going */ }
    }
    at = i;
    Store.emit("reel"); Store.emit("log"); Store.emit("cands");
    paintDock();
    place();
    if (playing) startStep();
  }

  function startStep() {
    clearTimeout(timer);
    const s = STEPS[at];
    left = s.ms;
    t0 = performance.now();
    s.live?.();
    timer = setTimeout(() => { at < STEPS.length - 1 ? seek(at + 1) : finish(); }, left);
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

  const play = () => { if (playing) return; playing = true; t0 = performance.now() - (STEPS[at].ms - left); clearTimeout(timer); timer = setTimeout(() => { at < STEPS.length - 1 ? seek(at + 1) : finish(); }, left); STEPS[at].live?.(); paintDock(); tickBar(); };
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
    if (!dock || pinned) return;
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

    if (window.gsap) gsap.to(dock, { left: Math.round(x), top: Math.round(y), duration: .55, ease: "power3.out", overwrite: "auto" });
    else { dock.style.left = `${Math.round(x)}px`; dock.style.top = `${Math.round(y)}px`; }

    if (spot) {
      const to = { left: t.left - 4, top: t.top - 4, width: t.width + 8, height: t.height + 8 };
      if (window.gsap) gsap.to(spot, { ...to, duration: .6, ease: "power3.inOut", overwrite: "auto" });
      else Object.assign(spot.style, Object.fromEntries(Object.entries(to).map(([k, v]) => [k, `${v}px`])));
    }
  }

  /* ── chrome ─────────────────────────────────────────────────────────────── */
  function paintDock() {
    if (!dock) return;
    if (window.gsap) gsap.fromTo(dock.querySelector(".td-body"), { y: 6, opacity: .35 }, { y: 0, opacity: 1, duration: .38, ease: "power2.out", overwrite: "auto" });
    const s = STEPS[at], last = at === STEPS.length - 1 && !playing && dock.classList.contains("done");
    dock.querySelector("#tIcon").innerHTML = last ? STEP_ICON.check : (STEP_ICON[s.icon] || "");
    dock.querySelector("#tTitle").textContent = last ? "That's the loop" : s.title;
    dock.querySelector("#tTool").textContent = last ? "" : s.tool;
    dock.querySelector("#tSay").textContent = last
      ? "Every step was a real tool call. An agent makes those choices itself. The cut is still on the reel — press Space."
      : s.say;
    dock.querySelector("#tCount").textContent = `${at + 1} / ${STEPS.length}`;
    dock.querySelector("#tPlay").innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    dock.querySelector("#tPlay").title = playing ? "Pause" : "Play";
    dock.querySelectorAll(".tl-cell").forEach((c, i) => {
      c.classList.toggle("on", i === at);
      c.classList.toggle("past", i < at);
      const fill = c.querySelector("i");
      if (i !== at) fill.style.width = i < at ? "100%" : "0%";
    });
  }

  const STEP_ICON = {
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" stroke-linejoin="round"/></svg>',
    ear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="6" width="7" height="13" rx="1.5"/><rect x="13" y="6" width="7" height="13" rx="1.5" stroke-dasharray="2.5 2"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L9.5 17.5 4 12"/></svg>',
    broom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l5 5M13.5 6.5L17 10l-6 6H5v-6z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h4"/></svg>',
  };
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
        <span class="td-note">real tool calls, in a scripted order</span>
        <span class="spacer"></span>
        <span class="td-count tnum" id="tCount"></span>
        <button class="td-x" id="tClose" title="Close">✕</button>
      </div>
      <div class="td-body">
        <span class="td-icon" id="tIcon"></span>
        <div class="td-copy">
          <h3 id="tTitle"></h3>
          <p id="tSay"></p>
          <code id="tTool"></code>
        </div>
      </div>
      <div class="td-timeline" id="tTimeline">
        ${STEPS.map((s, i) => `<button class="tl-cell" data-i="${i}" title="${s.tool}"><i></i></button>`).join("")}
      </div>
      <div class="td-controls">
        <button class="td-b" id="tPrev" title="Previous">${ICON_PREV}</button>
        <button class="td-b primary" id="tPlay" title="Play">${ICON_PLAY}</button>
        <button class="td-b" id="tNext" title="Next">${ICON_NEXT}</button>
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
    dock.querySelector("#tPlay").onclick = () => (playing ? pause() : (dock.classList.remove("done"), play()));
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
  }

  function close() {
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
    openDock();
    seek(0);
    play();
  }

  /* ── welcome ────────────────────────────────────────────────────────────── */
  const PROMPT = "This page exposes WebMCP tools for cutting a podcast short. Call listCapabilities first, then find me 60 seconds on how he went from electrician to astronaut — propose two different angles, play the better one, then clean it up and give me the timestamps.";

  function envLine() {
    const mc = !!(document.modelContext || navigator.modelContext);
    const v = +(/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] || 0);
    if (mc) return { cls: "good", html: "<b>This browser has WebMCP — the tools are live.</b> If this is ChatGPT's browser, choose <b>GPT-5.6 Sol</b> or <b>Terra</b> in the model menu (earlier models don't see site tools), then check <b>Site tools</b> in the address bar. Then just ask for a cut." };
    if (v >= 149) return { cls: "", html: `<b>You're on Chrome ${v}, which supports this.</b> Enable <code>chrome://flags/#enable-webmcp-testing</code> and reload — or watch the demo, which runs the real tools either way.` };
    return { cls: "", html: "<b>This browser can't run WebMCP yet.</b> It needs ChatGPT's browser, or Chrome&nbsp;149+ with a flag. The demo runs the real tools either way." };
  }

  function welcome() {
    const e = envLine();
    const wrap = document.createElement("div");
    wrap.className = "tour-scrim";
    wrap.innerHTML = `
      <div class="tour-card" role="dialog" aria-label="What Cutroom is">
        <div class="tour-brand"><span class="brand-mark">Cut<em>room</em></span><span class="chipish">WEBMCP</span></div>
        <h2>A 38-minute podcast holds about eight lines that, in the right order, are a story.</h2>
        <p>Finding them is a search problem with no correct answer — only taste — and you can't judge a candidate without hearing it.
           Cutroom gives an AI agent the tools to do the finding, and keeps you doing the judging.</p>
        <div class="tour-status ${e.cls}">${e.html}</div>
        <div class="tour-actions">
          <button class="tour-go" id="tourGo">Watch it work<span class="tour-sub">about a minute · real tool calls</span></button>
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
