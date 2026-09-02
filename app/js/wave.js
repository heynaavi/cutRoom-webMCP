/* ═══════════════════════════════════════════════════════════════════════════
   WAVE — a symmetric level meter that blooms from the centre.

   Bars do not travel. An earlier pass scrolled the waveform past a fixed
   playhead, which reads as a second timeline competing with the scrubber right
   below it. Here every bar keeps its place and only its height moves, so the
   panel reads as "sound happening" rather than "position in the file".

   Height comes from the real RMS envelope of what's playing, shaped so the
   centre carries the level and the shoulders fall away. A slow drift function
   varies neighbouring bars a little, which is what stops it looking like a
   single rising blob. GSAP eases the level itself — one tween, not 140.
   ═══════════════════════════════════════════════════════════════════════════ */
const Wave = (() => {
  const N = 140;
  const MID = (N - 1) / 2;

  let host, bars = [], shape = [], level = { v: 0 }, tween = null, idle = null, t0 = 0;

  function build(el) {
    host = el;
    host.innerHTML = Array.from({ length: N }, (_, k) => {
      const d = Math.abs(k - MID) / MID;                       // 0 centre → 1 edge
      const heat = Math.max(0, 1 - Math.pow(d / 0.10, 1.4));   // narrow accent core
      const fade = 0.09 + 0.42 * Math.pow(1 - d, 2.4);
      return `<i style="--heat:${heat.toFixed(3)};--fade:${fade.toFixed(3)}"></i>`;
    }).join("");
    bars = [...host.children];
    // Envelope: tallest at the centre, easing to nothing at the edges.
    shape = bars.map((_, k) => {
      const d = Math.abs(k - MID) / MID;
      return Math.pow(Math.cos((d * Math.PI) / 2), 1.5);
    });
    t0 = performance.now();
    paint();
    breathe();
  }

  /* Level of whatever is playing right now, with contrast restored — the stored
     envelope is gamma-lifted so quiet speech survives being written down. */
  function levelAt(t) {
    const P = window.PEAKS, D = Store.state.source.durationSec;
    if (!P || !D) return 0;
    const i = Math.floor((t / D) * P.length);
    return Math.pow(P[Math.max(0, Math.min(P.length - 1, i))] ?? 0, 2.2);
  }

  function paint() {
    const ms = (performance.now() - t0) / 1000;
    for (let i = 0; i < N; i++) {
      // Two slow incommensurate waves: neighbours differ, nothing pulses in sync.
      const drift = 0.78 + 0.22 * Math.sin(ms * 1.7 + i * 0.42) * Math.sin(ms * 0.6 + i * 0.11);
      const h = 1.5 + level.v * shape[i] * drift * 30;
      bars[i].style.height = `${h.toFixed(1)}px`;
    }
  }

  /* Paused: a barely-there swell, so the panel is alive but not asking for
     attention. */
  function breathe() {
    stopBreathe();
    if (!window.gsap) { level.v = 0.05; paint(); return; }
    idle = gsap.to(level, {
      v: 0.075, duration: 2.6, repeat: -1, yoyo: true, ease: "sine.inOut", onUpdate: paint,
    });
  }
  function stopBreathe() { if (idle) { idle.kill(); idle = null; } }

  return {
    build,
    /* Chase the live level. GSAP smooths it so speech transients don't strobe. */
    tick(now) {
      if (!bars.length || !Player.playing) return;
      const target = levelAt(now);
      if (tween) tween.kill();
      tween = gsap.to(level, { v: target, duration: 0.16, ease: "power2.out", onUpdate: paint });
    },
    start() { stopBreathe(); },
    stop() {
      if (!bars.length) return;
      if (tween) tween.kill();
      if (!window.gsap) { level.v = 0.05; paint(); return; }
      gsap.to(level, { v: 0.06, duration: 0.7, ease: "power2.out", onUpdate: paint, onComplete: breathe });
    },
  };
})();
