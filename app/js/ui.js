/* ═══════════════════════════════════════════════════════════════════════════
   UI — rendering + interaction. Reads Store, drives Player.
   ═══════════════════════════════════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ts = (s) => { const t = Math.max(0, Math.floor(s || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const dur = (s) => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 9v6h4l5 4V5L8 9H4zM17 9l4 6M21 9l-4 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 9v6h4l5 4V5L8 9H4zM17 8.5a5 5 0 010 7"/></svg>',
  ear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 5v14l11-7z"/></svg>',
};

let PEAKS = null;
let toastT = 0;
let lastPlayGlyph = null;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), 1900);
}

/* ── stage: caption + waveform ─────────────────────────────────────────────── */
function renderCaption(sec) {
  const cap = $("#caption");
  const seg = Store.segmentAt(sec);
  if (!seg || (!Player.playing && !Player.inSequence)) {
    if (!Store.state.reel.length) {
      cap.className = "caption idle";
      cap.innerHTML = 'Pick lines from the transcript, or let an agent propose a cut. Press <b>Space</b> to play the reel.';
      return;
    }
    if (!Player.playing) {
      cap.className = "caption idle";
      cap.innerHTML = `<b>${Store.live().length}</b> clips · <b>${dur(Store.reelDur())}</b> — press <b>Space</b> to hear the cut.`;
      return;
    }
  }
  if (!seg) return;
  cap.className = "caption";
  const ws = Store.state.words.filter((w) => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.4);
  if (!ws.length) { cap.textContent = seg.text; return; }
  cap.innerHTML = ws.map((w) => {
    const cls = sec >= w.start && sec < w.end ? "w now" : sec >= w.end ? "w said" : "w";
    return `<span class="${cls}">${esc(w.word)}</span>`;
  }).join(" ");
}

function buildWave() { Wave.build($("#wave")); }

/* ── transport + provenance ────────────────────────────────────────────────── */
function renderTransport(sec) {
  const inSeq = Player.inSequence;
  const total = inSeq ? Store.reelDur() : Store.state.source.durationSec;
  let now = sec;
  if (inSeq) {
    const l = Store.live();
    now = l.slice(0, Math.max(0, Player.seqIndex)).reduce((n, c) => n + (c.end - c.start), 0)
        + Math.max(0, sec - (l[Player.seqIndex]?.start ?? sec));
  }
  $("#tNow").textContent = ts(now);
  $("#tTot").textContent = ts(total);
  const frac = total ? Math.max(0, Math.min(1, now / total)) : 0;
  $("#scrubFill").style.width = `${frac * 100}%`;
  $("#scrubHead").style.left = `${frac * 100}%`;
  // Only rewrite the glyph when the state actually flips. paint() runs every
  // frame while playing, and replacing innerHTML mid-gesture detaches the <svg>
  // the mousedown landed on — so mousedown and mouseup end up in different
  // trees, no common ancestor, and the browser never fires a click at all.
  // That's why the button could start playback but never stop it, while the
  // keyboard path (which doesn't depend on hit-testing) worked both ways.
  if (lastPlayGlyph !== Player.playing) {
    lastPlayGlyph = Player.playing;
    $("#playBtn").innerHTML = Player.playing ? ICON.pause : ICON.play;
  }
  const ci = Player.seqIndex;
  const chip = $("#stageClip");
  chip.classList.toggle("on", ci >= 0);
  if (ci >= 0) chip.textContent = `clip ${ci + 1} / ${Store.live().length}`;
}

function renderProv(sec) {
  const bar = $("#provBar");
  const D = Store.state.source.durationSec || 1;
  bar.querySelectorAll(".prov-mk").forEach((n) => n.remove());
  Store.state.reel.forEach((c) => {
    const m = document.createElement("div");
    m.className = "prov-mk" + (c.ghost ? " ghost" : "");
    m.style.left = `${(c.start / D) * 100}%`;
    m.style.width = `${Math.max(0.35, ((c.end - c.start) / D) * 100)}%`;
    if (c.muted) m.style.opacity = ".28";
    m.title = `${ts(c.start)} — ${c.text.slice(0, 70)}`;
    bar.appendChild(m);
  });
  $("#provPlay").style.left = `${((Player.inSequence ? Player.time : sec) / D) * 100}%`;
  const sp = Store.spread();
  $("#provSpread").textContent = Store.live().length > 1 ? `· drawn across ${Math.round(sp * 100)}% of the episode` : "";
  $("#provEnd").textContent = ts(D);
}

/* ── reel ─────────────────────────────────────────────────────────────────── */
let dragId = null;

function renderReel() {
  const strip = $("#strip");
  const R = Store.state.reel;
  if (!R.length) {
    strip.innerHTML = `<div class="strip-empty"><b>The reel is empty</b>
      <span>Add lines from the transcript with <b>+</b>, or ask a connected agent for a cut.</span></div>`;
  } else {
    const liveIdx = new Map(Store.live().map((c, i) => [c.id, i]));
    strip.innerHTML = R.map((c, i) => {
      const d = c.end - c.start;
      const playing = Player.seqIndex >= 0 && liveIdx.get(c.id) === Player.seqIndex;
      return `<div class="clip${c.muted ? " muted" : ""}${c.ghost ? " ghost" : ""}${playing ? " playing" : ""}"
                   draggable="true" data-id="${c.id}" data-i="${i}">
        <div class="clip-top">
          <span class="clip-n">${c.ghost ? "PROPOSED" : String(i + 1).padStart(2, "0")}</span>
          <span class="clip-dur tnum">${dur(d)} · ${ts(c.start)}</span>
        </div>
        <div class="clip-text">${esc(c.text)}</div>
        ${c.why ? `<div class="clip-why">${esc(c.why)}</div>` : ""}
        <div class="clip-acts">
          <button class="cbtn" data-act="preview" title="Play just this line">${ICON.ear}</button>
          ${c.ghost
            ? `<button class="cbtn keep" data-act="keep" title="Keep">${ICON.check}</button>`
            : `<button class="cbtn" data-act="mute" title="${c.muted ? "Unmute" : "Mute — hear the cut without it"}">${c.muted ? ICON.mute : ICON.sound}</button>`}
          <button class="cbtn drop" data-act="drop" title="Remove">${ICON.x}</button>
        </div>
      </div>`;
    }).join("");
  }

  const d = Store.reelDur(), T = Store.state.targetSec;
  const pct = Math.min(100, (d / T) * 100);
  const fill = $("#budgetFill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("near", d > T * 0.85 && d <= T);
  fill.classList.toggle("over", d > T);
  const num = $("#budgetNum");
  num.classList.toggle("over", d > T);
  num.innerHTML = `<b>${Math.round(d)}s</b> / ${T}s`;
}

function wireReel() {
  const strip = $("#strip");
  strip.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    const card = e.target.closest(".clip");
    if (!card) return;
    const id = card.dataset.id;
    const c = Store.state.reel.find((x) => x.id === id);
    if (!c) return;
    if (!btn) { Player.playSpan(c.start, c.end); return; }
    const act = btn.dataset.act;
    if (act === "preview") Player.playSpan(c.start, c.end);
    if (act === "mute") { Store.toggleMute(id); toast(c.muted ? "Unmuted" : "Muted — play to hear it without this line"); }
    if (act === "drop") Store.removeClip(id);
    if (act === "keep") { Store.keepGhost(id); toast("Kept"); }
  });
  strip.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".clip"); if (!card) return;
    dragId = card.dataset.id; card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  strip.addEventListener("dragend", () => {
    dragId = null;
    strip.querySelectorAll(".clip").forEach((n) => n.classList.remove("dragging", "drop-before"));
  });
  strip.addEventListener("dragover", (e) => {
    e.preventDefault();
    const card = e.target.closest(".clip"); if (!card || card.dataset.id === dragId) return;
    strip.querySelectorAll(".clip").forEach((n) => n.classList.remove("drop-before"));
    card.classList.add("drop-before");
  });
  strip.addEventListener("drop", (e) => {
    e.preventDefault();
    const card = e.target.closest(".clip"); if (!card || !dragId) return;
    Store.move(dragId, +card.dataset.i);
  });
}

/* ── right rail ───────────────────────────────────────────────────────────── */
function renderList() {
  const list = $("#list"), S = Store.state;
  $("#cTranscript").textContent = ` ${S.segments.length}`;
  $("#cStarred").textContent = S.starred.length ? ` ${S.starred.length}` : "";
  $("#cCands").textContent = S.candidates.length ? ` ${S.candidates.length}` : "";
  $("#searchWrap").style.display = S.tab === "transcript" ? "" : "none";

  if (S.tab === "cands") {
    list.innerHTML = S.candidates.length
      ? `<div class="cands">${S.candidates.map((c, i) => `
          <div class="cand${S.activeCand === c.id ? " on" : ""}" data-cand="${c.id}">
            <div class="cand-top">
              <span class="cand-key">${i + 1}</span>
              <span class="cand-title">${esc(c.title)}</span>
              <span class="cand-meta tnum">${c.spans.length} · ${dur(c.spans.reduce((n, s) => n + (s.end - s.start), 0))}</span>
            </div>
            <div class="cand-desc">${esc(c.desc)}</div>
          </div>`).join("")}</div>`
      : `<div class="empty">No cuts proposed yet.<br/><br/>A connected agent proposes these by reading the transcript.<br/>Without one, <button class="chip" id="starterBtn" style="margin-top:10px">Suggest three cuts</button></div>`;
    return;
  }

  const used = new Set();
  Store.state.reel.forEach((c) => Store.state.segments.forEach((s) => {
    if (s.start >= c.start - 0.3 && s.end <= c.end + 0.3) used.add(s.i);
  }));

  let segs;
  if (S.tab === "starred") {
    segs = S.starred.map((i) => S.segments[i]).filter(Boolean);
    if (!segs.length) { list.innerHTML = `<div class="empty">Nothing starred yet.<br/>Star lines you like — a connected agent reads them as your taste.</div>`; return; }
  } else {
    segs = S.query ? Store.search(S.query, { limit: 140 }) : S.segments;
  }

  const q = S.query.trim().toLowerCase();
  const hi = (t) => {
    if (!q) return esc(t);
    const i = t.toLowerCase().indexOf(q);
    return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`;
  };

  speakingSeg = -1;
  const now = Player.time;
  list.innerHTML = segs.map((s) => `
    <div class="seg${S.starred.includes(s.i) ? " starred" : ""}${used.has(s.i) ? " used" : ""}${now >= s.start && now < s.end ? " speaking" : ""}" data-seg="${s.i}">
      <span class="seg-ts tnum" data-act="seek">${ts(s.start)}</span>
      <div class="seg-body"><div class="seg-text">${hi(s.text)}</div></div>
      <div class="seg-acts">
        <button class="cbtn" data-act="preview" title="Hear this line">${ICON.ear}</button>
        <button class="cbtn star" data-act="star" title="Star — taste the agent can read">${S.starred.includes(s.i) ? ICON.starOn : ICON.star}</button>
        <button class="cbtn" data-act="add" title="Add to reel">${ICON.plus}</button>
      </div>
    </div>`).join("") || `<div class="empty">Nothing matches “${esc(S.query)}”.</div>`;
}

function wireRail() {
  $("#railTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".rtab"); if (!b) return;
    $("#railTabs").querySelectorAll(".rtab").forEach((n) => n.classList.toggle("on", n === b));
    Store.setTab(b.dataset.tab);
  });
  $("#search").addEventListener("input", (e) => Store.setQuery(e.target.value));
  $("#list").addEventListener("wheel", () => { userScrolledAt = Date.now(); }, { passive: true });
  $("#list").addEventListener("click", (e) => {
    const cand = e.target.closest("[data-cand]");
    if (cand) { const c = Store.applyCandidate(cand.dataset.cand); if (c) { toast(`“${c.title}” — press Space to hear it`); } return; }
    if (e.target.id === "starterBtn") {
      const n = Starters.suggest();
      Store.logTool("suggest", `${n} local cuts`);
      toast(n ? `${n} cuts — press 1, 2 or 3 to hear them` : "Not enough material to build a cut");
      return;
    }
    const row = e.target.closest("[data-seg]"); if (!row) return;
    const list = $("#list");
    const s = Store.state.segments[+row.dataset.seg]; if (!s) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "preview") Player.playSpan(s.start, s.end);
    else if (act === "star") toast(Store.star(s.i) ? "Starred" : "Unstarred");
    else if (act === "add") { Store.addSpan({ start: s.start, end: s.end, text: s.text }); toast("Added to reel"); }
    else {
      // Click the line, hear it — and park it where the follow will keep it, so
      // the view doesn't jump when the next line takes over. play() is async, so
      // followTranscript's first pass still sees playing:false and bails.
      userScrolledAt = 0;
      Player.playFrom(s.start);
      speakingSeg = s.i;
      list.querySelectorAll(".seg.speaking").forEach((n) => n.classList.remove("speaking"));
      row.classList.add("speaking");
      parkRow(row);
    }
  });
}


/* ── transcript follow ────────────────────────────────────────────────────── */
// Retagging 500 rows every frame would be absurd, so only the row that changed
// is touched. Auto-scroll parks the speaking line third from the top, which
// keeps the next couple of lines visible instead of pinning it to the edge.
let speakingSeg = -1;
let userScrolledAt = 0;

function followTranscript(sec) {
  if (Store.state.tab !== "transcript" || Store.state.query) return;
  const seg = Store.segmentAt(sec);
  const i = seg ? seg.i : -1;
  if (i === speakingSeg) return;

  const list = $("#list");
  if (speakingSeg >= 0) list.querySelector(`[data-seg="${speakingSeg}"]`)?.classList.remove("speaking");
  speakingSeg = i;
  if (i < 0) return;

  const row = list.querySelector(`[data-seg="${i}"]`);
  if (!row) return;
  row.classList.add("speaking");

  // Don't fight someone who is reading ahead.
  if (!Player.playing || Date.now() - userScrolledAt < 4000) return;

  parkRow(row);
}

/* Park a row third from the top of the list. */
function parkRow(row) {
  const list = $("#list");
  const rows = [...list.children];
  const anchor = rows[Math.max(0, rows.indexOf(row) - 2)] || row;
  // Rect deltas rather than offsetTop: .list isn't a positioned ancestor, so
  // offsetTop measures against something further up and lands nowhere near.
  // NB also: gsap.to(el,{scrollTop}) is a no-op — not a CSS property, needs
  // ScrollToPlugin. Native smooth scroll is fine.
  const to = Math.max(0, list.scrollTop + (anchor.getBoundingClientRect().top - list.getBoundingClientRect().top) - 6);
  // Smooth is right for line-to-line drift; across 500 lines it becomes a long
  // animated crawl, so jump when the distance is big.
  list.scrollTo({ top: to, behavior: Math.abs(to - list.scrollTop) > 900 ? "auto" : "smooth" });
}

/* ── agent log ────────────────────────────────────────────────────────────── */
function renderLog() {
  const L = Store.state.log;
  $("#logEmpty").style.display = L.length ? "none" : "";
  const rows = L.map((r) => `<div class="log-row"><span class="log-tool">${esc(r.tool)}</span><span class="log-arg">${esc(r.arg)}</span></div>`).join("");
  const body = $("#logBody");
  body.querySelectorAll(".log-row").forEach((n) => n.remove());
  body.insertAdjacentHTML("beforeend", rows);
}

/* ── taste chips ──────────────────────────────────────────────────────────── */
// Each chip is the same operation a connected agent would invoke as a tool.
// With no agent they still work locally, so the page is useful on its own.
const CHIPS = [
  ["Tighter", (R) => R.map((c) => ({ ...c, end: c.start + Math.max(1.2, (c.end - c.start) * 0.86) })), "Trimmed every line"],
  ["Let it breathe", (R) => R.map((c) => ({ ...c, end: c.end + 0.5, start: Math.max(0, c.start - 0.35) })), "Gave each line air"],
  ["Colder open", (R) => { if (R.length < 2) return R; const i = R.reduce((best, c, j) => ((c.end - c.start) < (R[best].end - R[best].start) ? j : best), 0); const x = R.slice(); const [c] = x.splice(i, 1); return [c, ...x]; }, "Shortest line moved to the front"],
  ["Punchier", (R) => R.filter((c) => c.end - c.start <= 11).slice(0, 8), "Dropped the long ones"],
  ["Drop the weakest", (R) => { if (R.length < 3) return R; const i = R.reduce((w, c, j) => (c.text.split(" ").length < R[w].text.split(" ").length ? j : w), 0); return R.filter((_, j) => j !== i); }, "Dropped the thinnest line"],
];

function renderChips() {
  const nav = $("#chips");
  nav.querySelectorAll(".chip").forEach((n) => n.remove());
  CHIPS.forEach(([label], i) => {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = label; b.dataset.chip = i;
    b.disabled = !Store.state.reel.length;
    nav.appendChild(b);
  });
}
function wireChips() {
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const [label, fn, msg] = CHIPS[+b.dataset.chip];
    const next = fn(Store.state.reel.slice());
    Store.state.reel = next;
    Store.emit("reel");
    Store.logTool("steer", label.toLowerCase());
    toast(msg);
  });
}

/* ── keyboard ─────────────────────────────────────────────────────────────── */
function wireKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input,textarea")) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.key === " ") {
      e.preventDefault();
      if (Player.playing) Player.pause();
      else { const l = Store.live(); l.length ? Player.playSequence(l) : Player.toggle(); }
    }
    if (e.key === "/") { e.preventDefault(); Store.setTab("transcript"); $("#search").focus(); }
    if (/^[1-9]$/.test(e.key)) {
      const c = Store.state.candidates[+e.key - 1];
      if (c) { Store.applyCandidate(c.id); Player.playSequence(Store.live()); toast(`“${c.title}”`); }
    }
    if (e.key.toLowerCase() === "k") { const n = Store.keepAllGhosts(); if (n) toast(`Kept ${n} proposed clip${n > 1 ? "s" : ""}`); }
  });
}

/* ── boot ─────────────────────────────────────────────────────────────────── */
function paint(sec) {
  renderCaption(sec); renderTransport(sec); renderProv(sec); Wave.tick(sec); followTranscript(sec);
}

/* Swap in a different recording — from a dropped file or from an agent. */
function loadSource(data, mediaUrl) {
  Player.stop();
  Store.clear();
  Store.state.starred = [];
  Store.state.candidates = [];
  Store.load(data);
  if (mediaUrl) { Player.el.src = mediaUrl; Player.el.load(); PEAKS = null; }
  $("#srcTitle").textContent = data.title;
  $("#srcDur").textContent = `${Math.round(data.durationSec / 60)} min · ${data.segments.length} lines`;
  $("#search").placeholder = `Search ${Math.round(data.durationSec / 60)} minutes…`;
  Store.setTab("transcript");
  renderList(); renderReel(); renderChips(); paint(0);
  toast(`Loaded “${data.title}”`);
}

/* Drop your own material. Nothing uploads — createObjectURL keeps it local. */
function wireDrop() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter", "dragover"].forEach((k) => document.addEventListener(k, (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    stop(e); document.body.classList.add("dropping");
  }));
  ["dragleave", "drop"].forEach((k) => document.addEventListener(k, (e) => {
    if (k === "dragleave" && e.relatedTarget) return;
    document.body.classList.remove("dropping");
  }));
  document.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    stop(e);
    try {
      const { data, mediaUrl, mediaName } = await Ingest.fromFiles([...e.dataTransfer.files]);
      if (data) loadSource(data, mediaUrl);
      else if (mediaUrl) { Player.el.src = mediaUrl; Player.el.load(); PEAKS = null; toast(`Audio swapped — ${mediaName}`); }
      else toast("Drop a media file and an SRT/VTT transcript.");
    } catch (err) { toast(err.message || "Could not read that file."); }
  });
}

async function boot() {
  buildWave(); wireReel(); wireRail(); wireChips(); wireKeys(); wireDrop();

  $("#playBtn").onclick = () => {
    if (Player.playing) return Player.pause();
    const l = Store.live();
    l.length ? Player.playSequence(l) : Player.toggle();
  };
  $("#clearBtn").onclick = () => { Store.clear(); toast("Reel cleared"); };
  $("#themeBtn").onclick = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    $("#themeBtn").textContent = dark ? "Dark" : "Light";
  };
  $("#scrub").addEventListener("pointerdown", (e) => {
    const r = $("#scrub").getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    Player.playFrom(f * Store.state.source.durationSec);
  });
  $("#provBar").addEventListener("pointerdown", (e) => {
    const r = $("#provBar").getBoundingClientRect();
    Player.playFrom(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * Store.state.source.durationSec);
  });

  Store.on((what) => {
    if (what === "reel" || what === "load") { renderReel(); renderChips(); renderProv(Player.time); renderList(); }
    if (what === "starred" || what === "tab" || what === "query" || what === "cands") renderList();
    if (what === "log") renderLog();
  });
  Player.on("time", (t) => paint(t));
  Player.on("playing", (p) => { p ? Wave.start() : Wave.stop(); paint(Player.time); renderReel(); });
  Player.on("clip", () => { renderReel(); paint(Player.time); });

  const data = await fetch("data/transcript.json").then((r) => r.json());
  Store.load(data);
  try { PEAKS = await fetch("data/peaks.json").then((r) => r.ok ? r.json() : null); } catch { PEAKS = null; }
  window.PEAKS = PEAKS;

  $("#srcTitle").textContent = data.title;
  $("#srcDur").textContent = `${Math.round(data.durationSec / 60)} min · ${data.segments.length} lines`;
  $("#search").placeholder = `Search ${Math.round(data.durationSec / 60)} minutes…`;
  renderReel(); renderChips(); renderList(); renderLog(); paint(0);
}
const UI = { loadSource, toast, paint };
boot();
