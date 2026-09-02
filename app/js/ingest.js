/* ═══════════════════════════════════════════════════════════════════════════
   INGEST — three ways material gets in, all client-side. Nothing uploads.
     1. the bundled demo episode (default)
     2. drop your own media + transcript (SRT / VTT / JSON)
     3. an agent hands us a transcript via the loadTranscript tool
   ═══════════════════════════════════════════════════════════════════════════ */
const Ingest = (() => {
  const tc = (h, m, s, ms) => (+h) * 3600 + (+m) * 60 + (+s) + (+(ms || 0)) / 1000;

  /* SRT and WebVTT differ mostly in the decimal separator and a header. */
  function parseCues(text) {
    const out = [];
    const body = text.replace(/^﻿/, "").replace(/\r/g, "");
    const re = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})([^\n]*)\n([\s\S]*?)(?=\n\s*\n|$)/g;
    let m;
    while ((m = re.exec(body))) {
      const line = m[10]
        .split("\n")
        .map((l) => l.replace(/<[^>]+>/g, "").trim())   // strip karaoke/style tags
        .filter((l) => l && !/^\d+$/.test(l))
        .join(" ")
        .trim();
      if (line) out.push({ start: tc(m[1], m[2], m[3], m[4]), end: tc(m[5], m[6], m[7], m[8]), text: line });
    }
    return out;
  }

  /* Cues are caption-shaped (short, often mid-sentence). Merge them into lines
     that can stand alone in a cut: break on sentence end or a real pause. */
  function cuesToSegments(cues) {
    const segs = [];
    let cur = null;
    for (const c of cues) {
      if (!cur) { cur = { ...c }; continue; }
      const gap = c.start - cur.end;
      const words = cur.text.split(/\s+/).length;
      if (/[.!?]"?$/.test(cur.text) || gap > 0.7 || words >= 26) { segs.push(cur); cur = { ...c }; }
      else { cur.end = c.end; cur.text = `${cur.text} ${c.text}`.replace(/\s+/g, " "); }
    }
    if (cur) segs.push(cur);
    return segs.map((s) => ({ start: +s.start.toFixed(2), end: +s.end.toFixed(2), text: s.text }));
  }

  /* Without real word timings, spread words evenly across their line. Good
     enough to drive the caption highlight; exact timings win when we have them. */
  function synthWords(segments) {
    const words = [];
    let wi = 0;
    for (const s of segments) {
      const parts = s.text.split(/\s+/).filter(Boolean);
      const per = (s.end - s.start) / Math.max(1, parts.length);
      parts.forEach((w, k) => words.push({
        wi: wi++, word: w,
        start: +(s.start + k * per).toFixed(2),
        end: +(s.start + (k + 1) * per).toFixed(2),
      }));
    }
    return words;
  }

  function normalise({ title, credit, segments, words, durationSec }) {
    const segs = segments
      .filter((s) => s && s.text && s.end > s.start)
      .sort((a, b) => a.start - b.start);
    const w = words?.length ? words : synthWords(segs);
    return {
      title: title || "Untitled recording",
      credit: credit || "",
      durationSec: durationSec || (segs.length ? segs[segs.length - 1].end : 0),
      segments: segs,
      words: w,
    };
  }

  return {
    parseCues, cuesToSegments, synthWords, normalise,

    /* Accept whatever the user drops: a transcript, a media file, or both. */
    async fromFiles(files) {
      let media = null, transcript = null, name = "";
      for (const f of files) {
        if (/^(audio|video)\//.test(f.type) || /\.(mp3|m4a|wav|ogg|mp4|webm|mov)$/i.test(f.name)) { media = f; name = f.name; }
        else if (/\.(srt|vtt|json|txt)$/i.test(f.name)) transcript = f;
      }
      let data = null;
      if (transcript) {
        const raw = await transcript.text();
        if (/\.json$/i.test(transcript.name)) {
          const j = JSON.parse(raw);
          data = normalise({
            title: j.title || transcript.name.replace(/\.\w+$/, ""),
            credit: j.credit, durationSec: j.durationSec,
            segments: j.segments || cuesToSegments(parseCues(raw)),
            words: j.words,
          });
        } else {
          const segs = cuesToSegments(parseCues(raw));
          if (!segs.length) throw new Error("No timed cues found in that file — Cutroom needs SRT, VTT, or Cutroom JSON.");
          data = normalise({ title: name || transcript.name.replace(/\.\w+$/, ""), segments: segs });
        }
      }
      return { data, mediaUrl: media ? URL.createObjectURL(media) : null, mediaName: name };
    },
  };
})();
