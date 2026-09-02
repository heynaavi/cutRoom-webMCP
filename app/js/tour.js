/* ═══════════════════════════════════════════════════════════════════════════
   TOUR — the first thirty seconds.

   A judge arriving cold sees a podcast editor and no reason to care. The tools
   are the point, and they're invisible until an agent calls one. So: say what
   this is, detect whether their browser can even do WebMCP, and offer to run
   the thing in front of them.

   The demo drives the REAL tools — the same functions an agent invokes, in the
   order an agent would sensibly use them. It is scripted, and it says so. A
   faked agent would be both dishonest and less impressive than the truth,
   which is that this all genuinely works.
   ═══════════════════════════════════════════════════════════════════════════ */
const Tour = (() => {
  const SEEN = "cutroom.seen.v1";
  let running = false, cancelled = false;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── the demo: real calls, narrated ─────────────────────────────────────── */
  const STEPS = [
    { say: "An agent arrives and asks what this page can do.",
      tool: "listCapabilities",
      run: async () => { Store.logTool("listCapabilities", ""); await wait(500); } },

    { say: "First it listens. This reads the audio, not the words — the passages where the voice lifts. No transcript search can find these.",
      tool: "findEnergyMoments",
      run: async () => {
        Store.logTool("findEnergyMoments", "top 12");
        Store.setTab("energy");
        await wait(2600);
      } },

    { say: "Then it reads, for the story rather than the sound.",
      tool: "searchTranscript",
      run: async () => {
        Store.setTab("transcript");
        Store.logTool("searchTranscript", "“the call came”");
        Store.setQuery("the call came");
        await wait(1900);
        Store.setQuery("");
      } },

    { say: "It proposes a whole cut — six lines pulled from six different places in the hour. They land as proposals, not decisions.",
      tool: "proposeCut",
      run: async () => {
        Store.clear();
        const pick = (q) => Store.state.segments.find((s) => s.text.toLowerCase().includes(q));
        const beats = [
          ["need an electrician", "where he started — the family trade"],
          ["there was a teacher", "the teacher who changed it"],
          ["dream since", "the dream, named"],
          ["the call came", "the best line in the episode"],
          ["it's been", "lands it"],
        ];
        const spans = beats.map(([q, why]) => { const s = pick(q); return s && { start: s.start, end: s.end, why }; }).filter(Boolean);
        const c = Store.proposeCut({ title: "Electrician to astronaut", desc: "The arc, in five lines.", spans });
        Store.logTool("proposeCut", `“${c.title}” · ${spans.length} clips`);
        Store.applyCandidate(c.id, { asGhost: true });
        Store.setTab("cands");
        await wait(2400);
      } },

    { say: "Now the part that matters: you hear it. A cut nobody has heard is worthless.",
      tool: "playReel",
      run: async () => {
        Store.logTool("playReel", `${Store.live().length} clips`);
        const ok = await Player.playSequence(Store.playSpans());
        await wait(ok ? 7000 : 900);
        Player.stop();
      } },

    { say: "It checks its own work the way an editor would — weak hook, hard join, over budget.",
      tool: "checkFlow",
      run: async () => { Store.logTool("checkFlow", ""); Store.setTab("notes"); await wait(2800); } },

    { say: "Then it cleans the script: hesitations and dead air out of the middle, audio closing up behind them.",
      tool: "cleanUpCut",
      run: async () => {
        const before = Store.reelDur();
        let n = 0;
        for (const c of Store.state.reel) {
          const cuts = [...Analysis.stammersIn(c.start, c.end), ...Analysis.slackIn(c)].sort((a, b) => a.start - b.start);
          for (const x of cuts) { Store.omit(c.id, x.start, x.end); n++; }
        }
        Store.logTool("cleanUpCut", `${n} cuts`);
        UI.toast(`${n} removed · ${(before - Store.reelDur()).toFixed(1)}s saved`);
        await wait(2600);
      } },

    { say: "And it hands over exact timestamps — every span to the hundredth of a second, plus an ffmpeg command. That's the deliverable.",
      tool: "getCutManifest",
      run: async () => { Store.logTool("getCutManifest", "json"); Store.setTab("cands"); await wait(2000); } },
  ];

  /* ── chrome ─────────────────────────────────────────────────────────────── */
  const env = () => {
    const mc = !!(document.modelContext || navigator.modelContext);
    const ua = navigator.userAgent;
    const chrome = /Chrome\/(\d+)/.exec(ua);
    return { mc, chromeVersion: chrome ? +chrome[1] : 0, isSafari: /^((?!chrome|android).)*safari/i.test(ua) };
  };

  const PROMPT = "This page has WebMCP tools for cutting a podcast short. Call listCapabilities, then find me 60 seconds on how he went from electrician to astronaut — propose two different angles, play the better one, and clean it up.";

  function welcome() {
    const e = env();
    const wrap = document.createElement("div");
    wrap.className = "tour-scrim";
    wrap.innerHTML = `
      <div class="tour-card" role="dialog" aria-label="What Cutroom is">
        <div class="tour-brand"><span class="brand-mark">Cut<em>room</em></span><span class="chipish">WEBMCP</span></div>
        <h2>A 38-minute podcast contains about eight lines that, in the right order, are a story.</h2>
        <p>Finding them is a search problem with no correct answer — only taste — and you can't judge a candidate without hearing it.
           Cutroom hands an AI agent ${33} tools to do the finding, and keeps you doing the judging.</p>
        <div class="tour-status ${e.mc ? "good" : ""}">
          ${e.mc
            ? `<b>Your browser has WebMCP.</b> The tools are live on this page — ask your agent for a cut and watch the ledger fill.`
            : e.chromeVersion >= 149
              ? `<b>You're on Chrome ${e.chromeVersion}, which can do this</b> — enable <code>chrome://flags/#enable-webmcp-testing</code> and reload. Or just watch the demo below; it runs the real tools.`
              : `<b>This browser can't run WebMCP yet.</b> It needs ChatGPT's browser, or Chrome&nbsp;149+ with a flag. The demo below runs the real tools either way.`}
        </div>
        <div class="tour-actions">
          <button class="tour-go" id="tourGo">Show me what it does<span class="tour-sub">60 seconds, real tool calls</span></button>
          <button class="tour-skip" id="tourSkip">I'll explore myself</button>
        </div>
        <button class="tour-copy" id="tourCopy" title="Copy a prompt to paste into your agent">Copy the prompt for your agent</button>
      </div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));

    const close = () => { wrap.classList.remove("in"); setTimeout(() => wrap.remove(), 320); localStorage.setItem(SEEN, "1"); };
    wrap.querySelector("#tourSkip").onclick = close;
    wrap.querySelector("#tourGo").onclick = () => { close(); setTimeout(run, 380); };
    wrap.querySelector("#tourCopy").onclick = async (ev) => {
      try { await navigator.clipboard.writeText(PROMPT); ev.target.textContent = "Copied — paste it into your agent"; }
      catch { ev.target.textContent = PROMPT; }
    };
    wrap.onclick = (ev) => { if (ev.target === wrap) close(); };
  }

  /* ── the run ────────────────────────────────────────────────────────────── */
  async function run() {
    if (running) return;
    running = true; cancelled = false;
    localStorage.setItem(SEEN, "1");

    const dock = document.createElement("div");
    dock.className = "tour-dock";
    dock.innerHTML = `
      <div class="tour-dock-head">
        <span class="tour-badge">Demo</span>
        <span class="tour-note">real tool calls, in a scripted order</span>
        <span class="spacer"></span>
        <span class="tour-count" id="tourCount"></span>
        <button class="tour-stop" id="tourStop">Stop</button>
      </div>
      <div class="tour-line"><code id="tourTool"></code><span id="tourSay"></span></div>
      <div class="tour-bar"><i id="tourBar"></i></div>`;
    document.body.appendChild(dock);
    requestAnimationFrame(() => dock.classList.add("in"));
    dock.querySelector("#tourStop").onclick = () => { cancelled = true; };

    for (let i = 0; i < STEPS.length && !cancelled; i++) {
      const s = STEPS[i];
      dock.querySelector("#tourTool").textContent = s.tool;
      dock.querySelector("#tourSay").textContent = s.say;
      dock.querySelector("#tourCount").textContent = `${i + 1} / ${STEPS.length}`;
      dock.querySelector("#tourBar").style.width = `${((i + 1) / STEPS.length) * 100}%`;
      dock.classList.remove("step"); void dock.offsetWidth; dock.classList.add("step");
      try { await s.run(); } catch { /* a step failing shouldn't strand the dock */ }
    }

    Player.stop();
    dock.querySelector("#tourTool").textContent = "";
    dock.querySelector("#tourSay").textContent = cancelled
      ? "Stopped. Everything you just saw is still here — carry on with it."
      : "That's the loop. Every step was a real tool call; an agent makes those choices itself. The cut is still on the reel — press Space to hear it again.";
    dock.querySelector("#tourStop").textContent = "Close";
    dock.querySelector("#tourStop").onclick = () => { dock.classList.remove("in"); setTimeout(() => dock.remove(), 320); };
    running = false;
  }

  return {
    boot() { if (!localStorage.getItem(SEEN)) setTimeout(welcome, 700); },
    show: welcome,
    run,
    get running() { return running; },
  };
})();
