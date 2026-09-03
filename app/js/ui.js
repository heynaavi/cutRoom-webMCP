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
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M7 21V10l5-7 1.2.8a2 2 0 01.8 2.2L13 10h5.2a2 2 0 012 2.5l-1.7 6.5a2 2 0 01-2 1.5H7z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M17 3v11l-5 7-1.2-.8a2 2 0 01-.8-2.2L11 14H5.8a2 2 0 01-2-2.5l1.7-6.5a2 2 0 012-1.5H17z"/></svg>',
};

/* CSS can shorten transitions, but GSAP drives its tweens from JS and would
   keep animating at full length regardless. Speeding the global timeline lands
   every tween on its final value almost immediately, without having to litter
   the call sites with conditionals. */
if (window.gsap && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
  gsap.globalTimeline.timeScale(24);
}

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
  // Nothing to play, so the stage explains itself instead of inviting Space.
  if (Store.state.textOnly) {
    cap.className = "caption idle";
    cap.innerHTML = Store.state.reel.length
      ? `<b>${Store.live().length} clips · ${dur(Store.reelDur())}</b> — no audio loaded, so this can't be played.
         Export exact timestamps, or drop the media file anywhere on this page to hear it.`
      : `<b>Transcript loaded, no audio.</b> Search, cut, reorder and export exact timestamps —
         everything except hearing it. Drop the media file anywhere on this page to add sound.`;
    return;
  }
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

// This is the picture of what the page does: five marks, drawn from across a
// 38-minute hour. It's worth animating — and it was being torn down and rebuilt
// sixty times a second, because paint() calls this on every frame. Rebuild only
// when the reel actually changes, and the marks can arrive rather than appear.
let provSig = "";
function renderProv(sec) {
  const bar = $("#provBar");
  const D = Store.state.source.durationSec || 1;
  const sig = Store.state.reel
    .map((c) => `${c.id}:${c.start.toFixed(2)}:${c.end.toFixed(2)}:${c.ghost ? 1 : 0}:${c.muted ? 1 : 0}`)
    .join("|");
  if (sig !== provSig) {
    provSig = sig;
    bar.querySelectorAll(".prov-mk").forEach((n) => n.remove());
    const made = [];
    Store.state.reel.forEach((c) => {
      const m = document.createElement("div");
      m.className = "prov-mk" + (c.ghost ? " ghost" : "");
      m.style.left = `${(c.start / D) * 100}%`;
      m.style.width = `${Math.max(0.35, ((c.end - c.start) / D) * 100)}%`;
      if (c.muted) m.style.opacity = ".28";
      m.title = `${ts(c.start)} — ${c.text.slice(0, 70)}`;
      bar.appendChild(m);
      made.push(m);
    });
    // Left to right, in episode order — so you watch the cut being drawn out of
    // the hour rather than being handed the finished picture.
    if (window.gsap && made.length) {
      gsap.from(made, { scaleY: 0, opacity: 0, duration: .42, ease: "back.out(1.9)", stagger: .055 });
    }
  }
  $("#provPlay").style.left = `${((Player.inSequence ? Player.time : sec) / D) * 100}%`;
  const sp = Store.spread();
  $("#provSpread").textContent = Store.live().length > 1 ? `· drawn across ${Math.round(sp * 100)}% of the episode` : "";
  $("#provEnd").textContent = ts(D);
}

/* ── reel ─────────────────────────────────────────────────────────────────── */
let dragId = null;
let knownClips = new Set();
const omitCounts = new Map();
const flashUntil = new Map();

/* A clip with omissions shows what left, struck through, rather than just a
   count of it. "5 cuts" is a claim; watching the "um"s go grey is the thing
   itself — and it's the only way to check the cleanup took out a hesitation
   and not a word you needed. Pauses have no words in them, so they cost
   nothing here, which is right: there was never anything to read. */
function clipTextHTML(c) {
  const cuts = c.cuts || [];
  if (!cuts.length) return esc(c.text);
  const ws = Store.state.words.filter((w) => w.start >= c.start - 0.05 && w.end <= c.end + 0.05);
  if (!ws.length) return esc(c.text);
  const dropped = (w) => cuts.some((x) => w.start >= x.start - 0.03 && w.end <= x.end + 0.03);
  const cls = performance.now() < (flashUntil.get(c.id) || 0) ? ' class="just"' : "";
  return ws.map((w) => (dropped(w) ? `<s${cls}>${esc(w.word)}</s>` : esc(w.word))).join(" ");
}

function renderReel() {
  const strip = $("#strip");
  const R = Store.state.reel;

  // A clip that just lost words should say so once, then settle. This can't be
  // a class added after rendering: renderReel rewrites the whole strip on every
  // clip boundary during playback, which wiped the animation mid-flight. So the
  // fact lives outside the DOM, in a deadline the markup reads and that expires
  // on its own.
  for (const c of R) {
    const n = (c.cuts || []).length;
    if (n > (omitCounts.get(c.id) || 0)) flashUntil.set(c.id, performance.now() + 700);
    omitCounts.set(c.id, n);
  }
  if (!R.length) {
    strip.innerHTML = `<div class="strip-empty"><b>The reel is empty</b>
      <span>Add lines from the transcript with <b>+</b>, or ask a connected agent for a cut.</span></div>`;
  } else {
    strip.innerHTML = R.map((c, i) => {
      const d = Store.clipDur(c);
      const playing = Player.currentId === c.id;
      return `<div class="clip${c.muted ? " muted" : ""}${c.ghost ? " ghost" : ""}${playing ? " playing" : ""}${c.vote === "down" ? " voted-down" : ""}"
                   draggable="true" data-id="${c.id}" data-i="${i}">
        <div class="clip-top">
          <span class="clip-n">${c.ghost ? "PROPOSED" : String(i + 1).padStart(2, "0")}</span>
          ${c.role ? `<span class="role role-${c.role}">${c.role}</span>` : ""}
          <span class="clip-dur tnum">${dur(d)} · ${ts(c.start)}</span>
        </div>
        <div class="clip-text">${clipTextHTML(c)}</div>
        ${(c.cuts || []).length ? `<div class="clip-omit">${(c.cuts || []).length} omitted · <button data-act="restore">restore</button></div>` : ""}
        ${c.why ? `<div class="clip-why">${esc(c.why)}</div>` : ""}
        <div class="clip-acts">
          <button class="cbtn" data-act="preview" title="Play just this line">${ICON.ear}</button>
          ${c.ghost
            ? `<button class="cbtn keep" data-act="keep" title="Keep">${ICON.check}</button>`
            : `<button class="cbtn" data-act="mute" title="${c.muted ? "Unmute" : "Mute — hear the cut without it"}">${c.muted ? ICON.mute : ICON.sound}</button>`}
          <button class="cbtn up${c.vote === "up" ? " on" : ""}" data-act="up" title="Works — the agent reads this">${ICON.up}</button>
          <button class="cbtn down${c.vote === "down" ? " on" : ""}" data-act="down" title="Doesn't work — the agent reads this">${ICON.down}</button>
          <button class="cbtn drop" data-act="drop" title="Remove">${ICON.x}</button>
        </div>
      </div>`;
    }).join("");
  }

  // Only cards that weren't there a moment ago animate. renderReel runs on
  // every clip boundary during playback, and re-animating the whole strip each
  // time a new line starts would be seasickness, not motion.
  const ids = [...strip.querySelectorAll(".clip")].map((el) => el.dataset.id);
  const fresh = [...strip.querySelectorAll(".clip")].filter((el) => !knownClips.has(el.dataset.id));
  knownClips = new Set(ids);
  if (window.gsap && fresh.length) {
    gsap.from(fresh, { y: 16, opacity: 0, duration: .44, ease: "power3.out", stagger: .07, clearProps: "all" });
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

  const live = Store.live().length;
  const ghosts = R.filter((c) => c.ghost).length;
  const cp = $("#cutPlay");
  cp.disabled = !live;
  $("#cutPlayIcon").innerHTML = Player.playing ? ICON.pause : ICON.play;
  $("#cutPlayLabel").textContent = Player.playing ? "Stop" : live ? `Play cut · ${Math.round(d)}s` : "Play cut";
  $("#exportBtn").disabled = !live;
  $("#renderBtn").disabled = !live || Render.busy || !!Store.state.textOnly;
  $("#undoBtn").disabled = !Store.canUndo();
  const ka = $("#keepAllBtn");
  ka.hidden = !ghosts;
  ka.textContent = `Keep all ${ghosts}`;
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
    if (!btn) { Player.playSequence(Store.spansOf(c)); return; }
    const act = btn.dataset.act;
    if (act === "preview") Player.playSequence(Store.spansOf(c));
    if (act === "mute") { Store.toggleMute(id); toast(c.muted ? "Unmuted" : "Muted — play to hear it without this line"); }
    if (act === "drop") Store.removeClip(id);
    if (act === "restore") { Store.restore(id); toast("Omitted words restored"); }
    if (act === "keep") { Store.keepGhost(id); toast("Kept"); }
    if (act === "up" || act === "down") {
      Store.react(id, act);
      const v = Store.state.reel.find((x) => x.id === id)?.vote;
      toast(v ? (v === "up" ? "Marked as working — a connected agent reads this" : "Marked as not working — the agent will see why") : "Reaction cleared");
    }
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

  // Which tab is lit is a function of the state, never of what was clicked.
  // The click handler used to set it directly, so every other route into
  // setTab left the header lying: proposeCut switches to Cuts, "/" switches to
  // Transcript, loading a source resets it, and the demo moves through four of
  // them. All of those showed one tab's content under another tab's highlight.
  $("#railTabs").querySelectorAll(".rtab").forEach((n) => {
    const on = n.dataset.tab === S.tab;
    n.classList.toggle("on", on);
    n.setAttribute("aria-selected", String(on));
  });

  $("#cTranscript").textContent = ` ${S.segments.length}`;
  $("#cStarred").textContent = S.starred.length ? ` ${S.starred.length}` : "";
  $("#cCands").textContent = S.candidates.length ? ` ${S.candidates.length}` : "";
  $("#searchWrap").style.display = S.tab === "transcript" ? "" : "none";

  if (S.tab === "energy") {
    const m = Analysis.energyMoments({ limit: 18 });
    list.innerHTML = m.length
      ? `<div class="energy-lede">Where the voice lifts, read from the audio rather than the words. The strongest moment in an hour is rarely the smartest sentence.</div>` +
        m.map((x) => `
        <div class="seg" data-energy="${x.startSec},${x.endSec}">
          <span class="seg-ts tnum" data-act="eseek">${ts(x.startSec)}</span>
          <div class="seg-body">
            <div class="lift"><span class="lift-bar" style="width:${Math.min(100, (x.lift - 1) * 62).toFixed(0)}%"></span><span class="lift-n tnum">×${x.lift.toFixed(2)}</span></div>
            <div class="seg-text">${esc(x.text)}</div>
          </div>
          <div class="seg-acts">
            <button class="cbtn" data-act="epreview" title="Hear it">${ICON.ear}</button>
            <button class="cbtn" data-act="eadd" title="Add to reel">${ICON.plus}</button>
          </div>
        </div>`).join("")
      : `<div class="empty">No clear energy peaks — this recording is fairly level throughout.</div>`;
    return;
  }

  if (S.tab === "notes") {
    const issues = Analysis.checkFlow();
    $("#cNotes").textContent = issues.length ? ` ${issues.length}` : "";
    list.innerHTML = Store.state.reel.length
      ? (issues.length
        ? `<div class="energy-lede">What an editor would flag before calling this done.</div>` +
          issues.map((x) => `
          <div class="issue sev-${x.severity}" ${x.clipIndex !== null ? `data-issue-clip="${x.clipIndex}"` : ""}>
            <div class="issue-top"><span class="issue-kind">${esc(x.kind.replace(/-/g, " "))}</span>
              <span class="issue-sev">${x.severity}</span></div>
            <div class="issue-detail">${esc(x.detail)}</div>
            <div class="issue-fix">${esc(x.fix)}</div>
          </div>`).join("")
        : `<div class="empty"><b>The cut reads clean.</b><br/>The hook stands alone, every clip resolves, the joins land in pauses, and it's inside budget.</div>`)
      : `<div class="empty">Build a cut and this becomes an editor's read on it — weak hooks, dangling references, hard joins, budget.</div>`;
    return;
  }

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
      : `<div class="empty">No cuts proposed yet.<br/><br/>A connected agent proposes these by reading the transcript
           <i>and</i> listening to it.<br/>Without one, the page can still guess from the words alone:
           <br/><button class="chip" id="starterBtn" style="margin-top:10px">Suggest cuts from the text</button></div>`;
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
    <div class="seg${S.starred.includes(s.i) ? " starred" : ""}${used.has(s.i) ? " used" : ""}${now >= s.start && now < s.end ? " speaking" : ""}" data-seg="${s.i}" tabindex="0" role="button" aria-label="Play from ${ts(s.start)}">
      <span class="seg-ts tnum" data-act="seek">${ts(s.start)}</span>
      <div class="seg-body"><div class="seg-text" data-words="pending">${hi(s.text)}</div></div>
      <div class="seg-acts">
        <button class="cbtn" data-act="preview" title="Hear this line">${ICON.ear}</button>
        <button class="cbtn star" data-act="star" title="Star — taste the agent can read">${S.starred.includes(s.i) ? ICON.starOn : ICON.star}</button>
        <button class="cbtn" data-act="add" title="Add to reel">${ICON.plus}</button>
      </div>
    </div>`).join("") || `<div class="empty">Nothing matches “${esc(S.query)}”.</div>`;
  observeWords();
}

/* ── word spans, only where they can be seen ──────────────────────────────── */
// Every transcript line can resolve to word-level timings, which is what makes
// a drag-selection an exact in/out. Building all of them up front meant ~13,000
// spans and a 13k×547 scan of the word list on every render — for 500 lines
// nobody has scrolled to. Rows are upgraded as they come into view instead;
// you can only select text you can see, so the feature is unchanged.
let wordObs = null;
function upgradeRow(row) {
  const box = row.querySelector(".seg-text");
  if (!box || box.dataset.words !== "pending") return;
  const seg = Store.state.segments[+row.dataset.seg];
  if (!seg) return;
  box.dataset.words = "done";
  const q = Store.state.query.trim().toLowerCase();
  const ws = Store.state.words.filter((w) => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05);
  if (!ws.length) return;                       // no word timings — leave the plain text
  box.innerHTML = ws.map((w) => {
    const hit = q && w.word.toLowerCase().includes(q);
    return `<span class="w" data-wi="${w.wi}">${hit ? `<mark>${esc(w.word)}</mark>` : esc(w.word)}</span>`;
  }).join(" ");
}
function observeWords() {
  const list = $("#list");
  const rows = list.querySelectorAll("[data-seg]");
  if (!rows.length) return;
  if (!("IntersectionObserver" in window)) { rows.forEach(upgradeRow); return; }
  wordObs?.disconnect();
  wordObs = new IntersectionObserver((entries, obs) => {
    for (const e of entries) if (e.isIntersecting) { upgradeRow(e.target); obs.unobserve(e.target); }
  }, { root: list, rootMargin: "300px 0px" });
  rows.forEach((r) => wordObs.observe(r));
}

function wireRail() {
  $("#railTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".rtab"); if (!b) return;
    Store.setTab(b.dataset.tab);          // the highlight follows state, not the click
  });
  $("#search").addEventListener("input", (e) => Store.setQuery(e.target.value));
  $("#list").addEventListener("wheel", () => { userScrolledAt = Date.now(); }, { passive: true });
  // Belt and braces for the lazy word spans: if a drag starts on a row the
  // observer hasn't reached yet, upgrade it before the selection exists.
  $("#list").addEventListener("pointerdown", (e) => {
    const row = e.target.closest?.("[data-seg]");
    if (row) upgradeRow(row);
  }, true);
  $("#list").addEventListener("keydown", (e) => {
    const row = e.target.closest?.("[data-seg]");
    if (!row || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    row.click();
  });
  document.addEventListener("selectionchange", () => {
    clearTimeout(window.__selT);
    window.__selT = setTimeout(onWordSelection, 140);
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".wordsel")) clearWordSel(); });
  $("#list").addEventListener("click", (e) => {
    const cand = e.target.closest("[data-cand]");
    if (cand) { const c = Store.applyCandidate(cand.dataset.cand); if (c) { toast(`“${c.title}” — press Space to hear it`); } return; }
    if (e.target.id === "starterBtn") {
      const n = Starters.suggest();
      Store.logTool("suggest", `${n} local cuts`);
      toast(n
        ? `${n} cut${n > 1 ? "s" : ""} — press ${n > 1 ? [...Array(n)].map((_, i) => i + 1).join(" or ") : "1"} to hear ${n > 1 ? "them" : "it"}`
        : "Not enough material to build a cut");
      return;
    }
    const er = e.target.closest("[data-energy]");
    if (er) {
      const [a, b] = er.dataset.energy.split(",").map(Number);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "eadd") { Store.addSpan({ start: a, end: b }); toast("Added to reel"); }
      else if (act === "eseek") Player.playFrom(a);
      else Player.playSpan(a, b);
      return;
    }
    const ic = e.target.closest("[data-issue-clip]");
    if (ic) {
      const c = Store.state.reel[+ic.dataset.issueClip];
      if (c) Player.playSpan(c.start, c.end, c.id);
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

/* ── word selection ───────────────────────────────────────────────────────── */
// Select any run of words — inside a line, or across two — and cut exactly
// that. The unit of a short is a phrase, not whatever the transcriber grouped.
let selBar = null;

function clearWordSel() { selBar?.remove(); selBar = null; }

function onWordSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return clearWordSel();
  const anchor = sel.anchorNode?.parentElement?.closest?.("[data-wi]");
  const focus = sel.focusNode?.parentElement?.closest?.("[data-wi]");
  if (!anchor || !focus) return clearWordSel();

  const a = +anchor.dataset.wi, b = +focus.dataset.wi;
  const span = Analysis.spanForWords(Math.min(a, b), Math.max(a, b));
  if (!span || span.end - span.start < 0.25) return clearWordSel();

  clearWordSel();
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  selBar = document.createElement("div");
  selBar.className = "wordsel";
  selBar.innerHTML = `<span class="mono tnum">${dur(span.end - span.start)}</span>
    <button data-s="hear">Hear</button><button data-s="add">Add to reel</button>`;
  document.body.appendChild(selBar);
  selBar.style.left = `${Math.max(10, Math.min(window.innerWidth - selBar.offsetWidth - 10, rect.left + rect.width / 2 - selBar.offsetWidth / 2))}px`;
  selBar.style.top = `${Math.max(8, rect.top - selBar.offsetHeight - 8)}px`;

  selBar.onmousedown = (e) => e.preventDefault();   // keep the selection alive
  selBar.onclick = (e) => {
    const act = e.target.closest("[data-s]")?.dataset.s;
    if (act === "hear") Player.playSpan(span.start, span.end);
    if (act === "add") {
      Store.addSpan({ start: span.start, end: span.end });
      toast(`Added ${dur(span.end - span.start)} — exactly what you selected`);
      window.getSelection().removeAllRanges();
      clearWordSel();
    }
  };
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

/* ── export ───────────────────────────────────────────────────────────────── */
const tc = (s) => {
  const f = Math.round((s % 1) * 25);
  const t = Math.floor(s);
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
};

const srtT = (s) => {
  const ms = Math.round((s % 1) * 1000);
  const t = Math.floor(s);
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}`
       + `:${String(t % 60).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

function exportCut(format = "json") {
  const l = Store.live();
  if (!l.length) { toast("Nothing to export"); return null; }
  const src = Store.state.source;
  const slug = (src.title || "cut").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let body, ext, type;

  if (format === "edl") {
    ext = "edl"; type = "text/plain";
    let rec = 0;
    body = `TITLE: ${src.title}\nFCM: NON-DROP FRAME\n\n` + l.map((c, i) => {
      const d = c.end - c.start;
      const line = `${String(i + 1).padStart(3, "0")}  AX       AA/V  C        ${tc(c.start)} ${tc(c.end)} ${tc(rec)} ${tc(rec + d)}\n* FROM CLIP NAME: ${src.title}\n* ${c.text}\n`;
      rec += d;
      return line;
    }).join("\n");
  } else if (format === "srt") {
    // Captions for the finished short, so the timecodes run against the CUT,
    // not the source recording — clip 2 starts where clip 1 ended, and a clip
    // with a hesitation omitted from its middle is that much shorter.
    ext = "srt"; type = "text/plain";
    let at = 0;
    body = l.map((c, i) => {
      const d = Store.clipDur(c);
      const cue = `${i + 1}\n${srtT(at)} --> ${srtT(at + d)}\n${c.text.trim()}\n`;
      at += d;
      return cue;
    }).join("\n");
  } else if (format === "text") {
    ext = "txt"; type = "text/plain";
    body = `${src.title} — ${Math.round(Store.reelDur())}s cut\n${src.credit ? src.credit + "\n" : ""}\n` +
      l.map((c, i) => `${i + 1}. [${ts(c.start)}–${ts(c.end)}]  ${c.text}${c.why ? `\n   (${c.why})` : ""}`).join("\n\n");
  } else {
    ext = "json"; type = "application/json";
    body = JSON.stringify({
      title: src.title, credit: src.credit, durationSec: +Store.reelDur().toFixed(2),
      clips: l.map((c) => ({ startSec: c.start, endSec: c.end, text: c.text, why: c.why })),
    }, null, 2);
  }

  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = `${slug}-cut.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${l.length} clips as ${ext.toUpperCase()}`);
  return `${slug}-cut.${ext}`;
}

/* ── render ───────────────────────────────────────────────────────────────── */
// Real-time by necessity: the audio has to play through the graph to be
// recorded. Say so, and show the progress, rather than looking hung.
async function renderVideo() {
  const btn = $("#renderBtn");
  if (Render.busy) return;
  const secs = Math.round(Store.reelDur());
  btn.disabled = true;
  toast(`Rendering — plays through once, about ${secs}s`);
  const r = await Render.run((p) => { btn.textContent = `Rendering ${Math.round(p * 100)}%`; });
  btn.textContent = "Render video";
  btn.disabled = !Store.live().length;
  toast(r.ok ? `Saved ${r.name} — ${r.seconds}s, ${r.mb} MB` : r.error);
  return r;
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
    // The chip is first and foremost a note in the human's own words —
    // getReelState hands it to the agent as `humanAsked`. The local heuristic
    // is a fallback so the page still does something with no agent attached.
    Store.addNote(label.toLowerCase());
    Store.logTool("steer", label.toLowerCase());
    if (window.__agentLive) {
      toast(`Noted: “${label.toLowerCase()}” — ask your agent to revise`);
      return;
    }
    Store.snapshot(`steer: ${label.toLowerCase()}`);
    Store.state.reel = fn(Store.state.reel.slice());
    Store.emit("reel");
    toast(msg);
  });
}

/* ── keyboard ─────────────────────────────────────────────────────────────── */
function wireKeys() {
  document.addEventListener("keydown", (e) => {
    // e.target isn't always an Element — a keydown with focus on the document
    // has no .matches, and the throw took every shortcut down with it.
    const t = e.target;
    const typing = t instanceof HTMLElement && t.matches("input,textarea");
    if (typing) { if (e.key === "Escape") t.blur(); return; }
    if (e.key === " ") {
      e.preventDefault();
      if (Player.playing) Player.pause();
      else { const l = Store.live(); l.length ? Player.playSequence(l) : Player.toggle(); }
    }
    if (e.key === "/") { e.preventDefault(); Store.setTab("transcript"); $("#search").focus(); }
    if (/^[1-9]$/.test(e.key)) {
      const c = Store.state.candidates[+e.key - 1];
      if (c) { Store.applyCandidate(c.id); Player.playSequence(Store.playSpans()); toast(`“${c.title}”`); }
    }
    if (e.key.toLowerCase() === "k") { const n = Store.keepAllGhosts(); if (n) toast(`Kept ${n} proposed clip${n > 1 ? "s" : ""}`); }
    if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
      e.preventDefault();
      $("#keys").classList.toggle("on");
      return;
    }
    if (e.key === "Escape") $("#keys").classList.remove("on");
    if (e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const w = Store.undo();
      toast(w ? `Undid “${w}”` : "Nothing to undo");
    }
    if (e.key.toLowerCase() === "e" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); exportCut("json"); }
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
  // A transcript arriving WITHOUT media used to leave the previous audio
  // loaded — so an agent handing us someone else's interview would play NASA
  // underneath their words, with every timestamp pointing at the wrong sound.
  // No media means no media: clear it and say so.
  if (mediaUrl) { Player.el.src = mediaUrl; Player.el.load(); PEAKS = null; Store.state.textOnly = false; }
  else {
    Player.el.removeAttribute("src");
    Player.el.load();
    PEAKS = null; window.PEAKS = null;
    Store.state.textOnly = true;
  }
  Store.state.userSource = true;      // from here on, audio-only is a legitimate follow-up
  $("#srcTitle").textContent = data.title;
  $("#srcDur").textContent = `${Math.round(data.durationSec / 60)} min · ${data.segments.length} lines`
    + (Store.state.textOnly ? " · no audio" : "");
  $("#search").placeholder = `Search ${Math.round(data.durationSec / 60)} minutes…`;
  Store.setTab("transcript");
  renderTextOnly();
  renderList(); renderReel(); renderChips(); paint(0);
  toast(Store.state.textOnly
    ? `Loaded “${data.title}” — text only. Drop the audio file on the page to hear cuts.`
    : `Loaded “${data.title}”`);
}

/* Text-only: everything except hearing it still works, and the page says which. */
function renderTextOnly() {
  const on = !!Store.state.textOnly;
  document.body.classList.toggle("text-only", on);
  $("#playBtn").disabled = on;
  $("#playBtn").title = on ? "No audio loaded — drop the media file to hear cuts" : "Play";
  // Rendering is a real-time recording of playback, so it needs sound too.
  const rb = $("#renderBtn");
  rb.title = on
    ? "No audio loaded — drop the media file, or export the timestamps and cut with ffmpeg"
    : "Render a vertical video with burned-in captions";
  renderCaption(Player.time || 0);
}

/* Audio on its own is only meaningful as the second half of "transcript first,
   media after" — their words, waiting for their sound. Against the bundled
   episode it is a trap: the reel would keep NASA's 547 timestamps and play
   somebody else's recording underneath them, so every clip points at the wrong
   audio. Same class of bug as an agent handing over a transcript with no media,
   which is why that one grew an explicit text-only mode. Refuse it and say why. */
function addMediaOnly(mediaUrl, mediaName) {
  if (!Store.state.userSource) {
    toast(`“${mediaName}” is audio with no transcript — it would play under the demo episode's timestamps. Add an SRT or VTT with it.`);
    return false;
  }
  Player.el.src = mediaUrl; Player.el.load(); PEAKS = null; window.PEAKS = null;
  Store.state.textOnly = false; renderTextOnly(); paint(0);
  toast(`Audio added — ${mediaName}. Press Space to hear the cut.`);
  return true;
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
      else if (mediaUrl) addMediaOnly(mediaUrl, mediaName);
      else toast("Drop a media file and an SRT/VTT transcript.");
    } catch (err) { toast(err.message || "Could not read that file."); }
  });
}

/* ── theme ────────────────────────────────────────────────────────────────── */
// The inline script in <head> picks the theme before first paint; this only
// keeps the choice, the label and the browser chrome in step with it.
const THEME_BG = { light: "#e6e0cf", dark: "#0f0e0c" };
function applyTheme(next, persist) {
  const t = next === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  const btn = $("#themeBtn");
  if (btn) {
    btn.textContent = t === "dark" ? "Light" : "Dark";
    btn.setAttribute("aria-label", `Switch to ${t === "dark" ? "light" : "dark"} theme`);
    btn.setAttribute("aria-pressed", String(t === "dark"));
  }
  const meta = $("#themeColor");
  if (meta) meta.content = THEME_BG[t];
  if (persist) { try { localStorage.setItem("cutroom.theme", t); } catch { /* private mode */ } }
}

async function boot() {
  buildWave(); wireReel(); wireRail(); wireChips(); wireKeys(); wireDrop();

  $("#playBtn").onclick = () => {
    if (Player.playing) return Player.pause();
    const l = Store.live();
    l.length ? Player.playSequence(Store.playSpans()) : Player.toggle();
  };
  $("#clearBtn").onclick = () => { Store.clear(); toast("Reel cleared"); };
  $("#cutPlay").onclick = () => {
    if (Player.playing) return Player.pause();
    if (Store.live().length) Player.playSequence(Store.playSpans());
  };
  $("#undoBtn").onclick = () => { const w = Store.undo(); toast(w ? `Undid “${w}”` : "Nothing to undo"); };
  $("#exportBtn").onclick = () => exportCut("json");
  $("#renderBtn").onclick = () => renderVideo();
  $("#keepAllBtn").onclick = () => { const n = Store.keepAllGhosts(); if (n) toast(`Kept ${n} clip${n > 1 ? "s" : ""}`); };
  applyTheme(document.documentElement.dataset.theme, false);
  $("#themeBtn").onclick = () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
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
    if (what === "starred" || what === "tab" || what === "query" || what === "cands" || what === "notes") renderList();
    if (what === "reel" && (Store.state.tab === "notes" || Store.state.tab === "energy")) renderList();
    if (what === "log") renderLog();
  });
  Player.on("time", (t) => paint(t));
  Player.on("playing", (p) => { p ? Wave.start() : Wave.stop(); paint(Player.time); renderReel(); });
  Player.on("clip", () => { renderReel(); paint(Player.time); });

  const openBtn = $("#openBtn"), filePick = $("#filePick");
  if (openBtn && filePick) {
    openBtn.onclick = () => filePick.click();
    filePick.onchange = async () => {
      if (!filePick.files?.length) return;
      try {
        const { data, mediaUrl, mediaName } = await Ingest.fromFiles([...filePick.files]);
        if (data) loadSource(data, mediaUrl);
        else if (mediaUrl) addMediaOnly(mediaUrl, mediaName);
        else toast("Pick a media file and an SRT/VTT transcript.");
      } catch (err) { toast(err.message || "Could not read that file."); }
      filePick.value = "";
    };
  }
  $("#keys").onclick = (e) => { if (e.target.id === "keys") $("#keys").classList.remove("on"); };
  const tourBtn = $("#tourBtn");
  if (tourBtn) tourBtn.onclick = () => Tour.show();

  // Everything above works without the demo episode — loading your own material
  // is the recovery path, so it gets wired before anything can fail.
  if (!(await loadDemoEpisode())) return;
  Tour.bootOnce();
}

/* The bundled episode. A CDN hiccup or an offline reload shouldn't leave a blank
   rail with no explanation — the page still does its whole job on your own
   files, and it should say so rather than sitting there empty. */
async function loadDemoEpisode() {
  try {
    const r = await fetch("data/transcript.json", { cache: "force-cache" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    if (!data?.segments?.length) throw new Error("transcript is empty");
    Store.load(data);
    try { PEAKS = await fetch("data/peaks.json").then((x) => (x.ok ? x.json() : null)); } catch { PEAKS = null; }
    window.PEAKS = PEAKS;
    $("#srcTitle").textContent = data.title;
    $("#srcDur").textContent = `${Math.round(data.durationSec / 60)} min · ${data.segments.length} lines`;
    $("#search").placeholder = `Search ${Math.round(data.durationSec / 60)} minutes…`;
    renderReel(); renderChips(); renderList(); renderLog(); paint(0);
    return true;
  } catch (err) {
    showLoadFailure(err);
    return false;
  }
}

function showLoadFailure(err) {
  $("#srcTitle").textContent = "Couldn't load the demo episode";
  $("#srcDur").textContent = String(err?.message || err || "network error");
  $("#playBtn").disabled = true;
  $("#search").disabled = true;
  $("#caption").className = "caption idle";
  $("#caption").innerHTML = `<b>The bundled episode didn't load.</b> Everything else still works —
    drop a media file and an SRT or VTT transcript anywhere on this page.`;
  $("#list").innerHTML = `<div class="empty">
      <b>Couldn't fetch <code>data/transcript.json</code></b><br/>
      <span class="mono">${esc(err?.message || "network error")}</span><br/><br/>
      This is the sample episode, not the app. All 33 tools are still registered, and
      an agent can supply its own transcript with <code>loadTranscript</code>.<br/><br/>
      <button class="chip" id="retryBtn">Try again</button>
      <button class="chip" id="ownBtn">Use your own files</button>
    </div>`;
  $("#retryBtn").onclick = async () => {
    $("#list").innerHTML = `<div class="empty">Retrying…</div>`;
    if (await loadDemoEpisode()) {
      $("#playBtn").disabled = false; $("#search").disabled = false;
      toast("Loaded");
    }
  };
  $("#ownBtn").onclick = () => $("#filePick").click();
}
const UI = { loadSource, toast, paint, exportCut, renderVideo, renderTextOnly,
             /* The demo is scripted against the sample episode; the tour needs a
                way back to it if someone has since loaded their own material. */
             reloadDemoEpisode: () => loadDemoEpisode() };
boot();
