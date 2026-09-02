/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER — a real <audio> element driven as a stitched sequence.
   The reel is a list of non-contiguous spans; playing it means seeking to each
   in turn and cutting to the next the instant the previous ends. Seeks are
   cheap here because the whole 18MB file is cached, so no prebuffer dance.
   ═══════════════════════════════════════════════════════════════════════════ */
const Player = (() => {
  const el = document.getElementById("audio");
  const subs = { time: [], playing: [], clip: [] };
  const on = (k, f) => subs[k].push(f);
  const emit = (k, v) => subs[k].forEach((f) => f(v));

  let seq = null;      // [{start,end}] when playing the reel
  let idx = 0;
  let raf = 0;
  let unlocked = false;

  // Autoplay policy blocks play() until the human has interacted with the page.
  // That matters here because an AGENT can ask for playback — and a tool that
  // reports "playing" when the browser silently refused is worse than useless.
  // So: unlock on the first real gesture, and let callers see whether it worked.
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    const wasMuted = el.muted;
    el.muted = true;
    el.play().then(() => { el.pause(); el.muted = wasMuted; })
             .catch(() => { el.muted = wasMuted; unlocked = false; });
  };
  ["pointerdown", "keydown"].forEach((k) => document.addEventListener(k, unlock, { once: false, passive: true }));

  // Tight polling: `timeupdate` only fires ~4x/sec, which is too coarse to cut
  // between clips cleanly (you'd hear up to 250ms of the next line's lead-in).
  // rAF gives us frame-accurate boundaries.
  const loop = () => {
    if (el.paused) { raf = 0; return; }
    const t = el.currentTime;
    if (seq) {
      const cur = seq[idx];
      // `el.seeking` guards the async seek: currentTime still reports the OLD
      // position until the seek lands, so without this the boundary test fires
      // again immediately and chains straight through the rest of the reel.
      if (!el.seeking && cur && t >= cur.end - 0.012) {
        idx++;
        if (idx >= seq.length) { stop(); return; }
        el.currentTime = seq[idx].start;
        emit("clip", idx);
      }
    }
    emit("time", el.currentTime);
    raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  const stop = () => {
    el.pause();
    seq = null; idx = 0;
    if (raf) cancelAnimationFrame(raf), (raf = 0);
    emit("playing", false);
    emit("clip", -1);
  };

  el.addEventListener("play", () => { emit("playing", true); kick(); });
  el.addEventListener("pause", () => emit("playing", false));
  el.addEventListener("ended", stop);
  el.addEventListener("loadedmetadata", () => emit("time", 0));

  return {
    on,
    get el() { return el; },
    get playing() { return !el.paused; },
    get time() { return el.currentTime; },
    get seqIndex() { return seq ? idx : -1; },
    /* Which clip is sounding right now, by id. The UI highlights on this —
       indexing into the sequence lights the wrong card when the sequence is a
       one-clip preview. */
    get currentId() { return seq ? (seq[idx]?.id ?? null) : null; },
    get inSequence() { return !!seq; },

    get canPlay() { return unlocked; },

    /* Play an ordered list of spans back to back.
       Resolves true only if the browser actually started playing. */
    async playSequence(spans) {
      const list = (spans || [])
        .filter((s) => s && s.end > s.start)
        .map((s) => ({ start: s.start, end: s.end, id: s.id ?? null }));
      if (!list.length) return false;
      seq = list; idx = 0;
      el.currentTime = list[0].start;
      emit("clip", 0);
      try { await el.play(); } catch { return false; }
      kick();
      return true;
    },

    /* Play one span, then stop — used for previewing a single line. */
    playSpan(start, end, id = null) { return this.playSequence([{ start, end, id }]); },

    /* Scrub the underlying source, leaving sequence mode. */
    seek(t) {
      seq = null; idx = 0;
      el.currentTime = Math.max(0, Math.min(el.duration || 0, t));
      emit("time", el.currentTime);
      emit("clip", -1);
    },

    playFrom(t) { this.seek(t); el.play().catch(() => {}); kick(); },
    pause() { el.pause(); },
    stop,
    toggle() { el.paused ? el.play().catch(() => {}) : el.pause(); },
  };
})();
