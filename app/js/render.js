/* ═══════════════════════════════════════════════════════════════════════════
   RENDER — turn the cut into an actual video file, in the browser.

   Everything upstream produces a decision: these spans, in this order. This is
   the part that makes the decision a thing you can post. Canvas draws the
   audiogram frame by frame, MediaRecorder muxes it with the real audio, and
   the person gets a vertical MP4 on disk. No server, no upload, no queue.

   It records in real time because the audio has to actually play through the
   graph — a 40-second cut takes 40 seconds. That's the honest cost, so the UI
   says so rather than pretending it's instant.
   ═══════════════════════════════════════════════════════════════════════════ */
const Render = (() => {
  const W = 1080, H = 1920;
  let ctx = null, srcNode = null, dest = null;    // one audio tap, reused
  let busy = false;

  /* Tapping the element routes ALL playback through the graph, so it must stay
     connected to destination or the page goes silent for good. Done once. */
  function audio() {
    if (dest) return dest;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    srcNode = ctx.createMediaElementSource(Player.el);
    dest = ctx.createMediaStreamDestination();
    srcNode.connect(dest);
    srcNode.connect(ctx.destination);            // keep the speakers alive
    return dest;
  }

  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };

  function frame(c, { words, now, clipNo, clipCount, title, progress, peaks, dur }) {
    // ground
    c.fillStyle = "#e6e0cf"; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(44,42,38,.05)";
    for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 10) c.fillRect(x, y, 2, 2);

    // title
    c.fillStyle = "#948d7a";
    c.font = "500 26px 'JetBrains Mono QE', monospace";
    c.textAlign = "left";
    c.fillText(title.toUpperCase().slice(0, 34), 72, 128);
    c.textAlign = "right";
    c.fillText(`${clipNo}/${clipCount}`, W - 72, 128);

    // caption — wrapped, word-level highlight
    c.textAlign = "center";
    c.font = "600 72px 'Space Grotesk QE', system-ui, sans-serif";
    const maxW = W - 200, lines = [];
    let line = [];
    for (const w of words) {
      const test = [...line, w];
      if (c.measureText(test.map((x) => x.word).join(" ")).width > maxW && line.length) {
        lines.push(line); line = [w];
      } else line = test;
    }
    if (line.length) lines.push(line);

    const lh = 92;
    let y = H / 2 - ((lines.length - 1) * lh) / 2;
    for (const ln of lines) {
      const full = ln.map((x) => x.word).join(" ");
      let x = W / 2 - c.measureText(full).width / 2;
      for (const w of ln) {
        const said = now >= w.end, is = now >= w.start && now < w.end;
        c.fillStyle = is ? "#c4582f" : said ? "#211f1a" : "rgba(33,31,26,.30)";
        const t = w.word + " ";
        c.fillText(t, x + c.measureText(t).width / 2, y);
        x += c.measureText(t).width;
      }
      y += lh;
    }

    // waveform: level around the playhead, centre hot — same read as the app
    const N = 96, bw = (W - 144) / N;
    for (let i = 0; i < N; i++) {
      const d = Math.abs(i - (N - 1) / 2) / ((N - 1) / 2);
      const t = now + ((i - (N - 1) / 2) / N) * 9;
      const idx = Math.floor((t / dur) * peaks.length);
      const v = Math.pow(peaks[Math.max(0, Math.min(peaks.length - 1, idx))] ?? 0, 2.2);
      const h = 4 + v * Math.pow(Math.cos((d * Math.PI) / 2), 1.4) * 120;
      c.fillStyle = d < 0.1 ? "#c4582f" : `rgba(33,31,26,${(0.10 + 0.34 * (1 - d)).toFixed(3)})`;
      rr(c, 72 + i * bw, H - 210 - h, bw - 3, h, 3);
    }

    // progress
    c.fillStyle = "rgba(44,42,38,.14)"; rr(c, 72, H - 150, W - 144, 8, 4);
    c.fillStyle = "#c4582f"; rr(c, 72, H - 150, (W - 144) * progress, 8, 4);
  }

  async function run(onProgress) {
    if (busy) return { ok: false, error: "A render is already running." };
    const clips = Store.live();
    if (!clips.length) return { ok: false, error: "The reel is empty." };
    // Recording is real-time playback through the audio graph. With no media
    // loaded there is nothing to play, and this would spend a minute producing
    // a silent file. Say so instead — the timestamps still export fine.
    if (Store.state.textOnly || !Player.el.currentSrc) {
      return { ok: false, error: "No audio is loaded, so there's nothing to record. Drop the media file onto the page, or export the timestamps and cut with ffmpeg." };
    }
    const a = audio();
    if (!a || !window.MediaRecorder) return { ok: false, error: "This browser can't record canvas video." };

    busy = true;
    try {
      if (ctx.state === "suspended") await ctx.resume();
      await (document.fonts?.ready ?? Promise.resolve());

      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const c = canvas.getContext("2d");

      const stream = canvas.captureStream(30);
      a.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

      // MP4 first, and not for tidiness: QuickTime has never supported WebM, so
      // a .webm is a file a Mac user cannot open by double-clicking it. Chrome
      // will record H.264+AAC if you ask with the full codec string — the short
      // forms ("avc1,mp4a", "h264,aac") report false even where MP4 works.
      const type = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",   // H.264 baseline + AAC-LC
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((t) => MediaRecorder.isTypeSupported(t)) || "video/webm";
      const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

      const total = clips.reduce((n, x) => n + (x.end - x.start), 0);
      const peaks = window.PEAKS || [0.5];
      const dur = Store.state.source.durationSec || 1;
      const title = Store.state.source.title || "Cut";

      let done = false;
      const paint = () => {
        if (done) return;
        const now = Player.time;
        const i = Math.max(0, Player.seqIndex);
        const elapsed = clips.slice(0, i).reduce((n, x) => n + (x.end - x.start), 0)
                      + Math.max(0, now - (clips[i]?.start ?? now));
        const seg = Store.segmentAt(now);
        const words = seg
          ? Store.state.words.filter((w) => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.4)
          : [];
        frame(c, { words, now, clipNo: i + 1, clipCount: clips.length, title,
                   progress: Math.min(1, elapsed / total), peaks, dur });
        onProgress?.(Math.min(1, elapsed / total));
        requestAnimationFrame(paint);
      };

      rec.start(250);
      paint();
      const started = await Player.playSequence(clips);
      if (!started) { done = true; rec.stop(); busy = false; return { ok: false, error: "Playback was blocked — press play once, then try again." }; }

      await new Promise((res) => {
        const check = setInterval(() => { if (!Player.playing) { clearInterval(check); res(); } }, 120);
      });
      await new Promise((r) => setTimeout(r, 350));      // let the tail flush
      done = true;

      const blob = await new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type })); rec.stop(); });
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${slug}-short.${ext}`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      // MediaRecorder emits a FRAGMENTED mp4 (moof/mdat pairs). Browsers, HLS
      // and most players are happy with it; QuickTime and some upload pipelines
      // are not, reliably. The fix is a stream copy — no re-encode, instant —
      // so hand it over rather than letting them find out on their own.
      const remux = `ffmpeg -i ${slug}-short.${ext} -c copy -movflags +faststart ${slug}.mp4`;
      return { ok: true, name: `${slug}-short.${ext}`, seconds: +total.toFixed(1),
               mb: +(blob.size / 1e6).toFixed(1), container: ext,
               note: ext === "mp4"
                 ? `H.264 + AAC. It's a fragmented MP4, which QuickTime is occasionally fussy about — if it won't open, remux it (no re-encode): ${remux}`
                 : `This browser would only record WebM, which QuickTime cannot open at all. Play it in VLC or Chrome, or convert: ffmpeg -i ${slug}-short.webm -c:v libx264 -c:a aac ${slug}.mp4` };
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 160) };
    } finally { busy = false; }
  }

  return { run, get busy() { return busy; } };
})();
