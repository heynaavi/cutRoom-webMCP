/**
 * Capture the real app, running the real demo, at 1920×1080.
 *
 * Unlike the cards this cannot be seeked: the tour advances on wall-clock timers
 * and the reel plays actual audio, so the only honest way to film it is to let
 * it run and film it.
 *
 * Pulling frames with Page.captureScreenshot managed 11fps — the app is running
 * rAF loops and an audio graph while it poses, so every request queues behind
 * real work. Page.startScreencast pushes instead: the browser hands over a frame
 * whenever it has composited one, which is what the compositor is doing anyway.
 * Frames arrive with their own timestamps, so the real rate is measured rather
 * than assumed and ffmpeg conforms the beat afterwards.
 *
 *   node capture-app.mjs <appUrl> <outDir>
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:9222";
const j = (p, o) => fetch(BASE + p, o).then((r) => r.json());
const [APP, OUT] = process.argv.slice(2);

const tgt = await j(`/json/new?about:blank`, { method: "PUT" });
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });

let id = 0;
const pend = new Map();
let onFrame = null;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === "Page.screencastFrame") {
    // Ack immediately or the browser stops sending.
    ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: d.params.sessionId } }));
    onFrame?.(d.params);
  }
};
const send = (m, p = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0]);
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: APP });
await new Promise((r) => setTimeout(r, 5000));

/* Start the demo, and park the dock top-right. Left alone it follows whichever
   region the step is about, which is right when a person is watching and wrong
   when the frame is a composition. Faking a drag is what pins it. */
// The profile remembers a theme across runs, and half the shoot came back in
// dark against paper-coloured cards. Force it.
await ev(`(async () => {
  localStorage.setItem('cutroom.theme','light');
  document.documentElement.dataset.theme = 'light';
  localStorage.removeItem('cutroom.seen.v2');
  document.querySelector('.tour-scrim')?.remove();
  document.body.click();
  Tour.close(); Tour.run();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1400));

/* Park the dock top-right and keep it there. Faking a drag sets the tour's
   `pinned` flag, but place() still runs on every resize and re-clamps from the
   live rect, and a transition mid-flight was enough to move it back to centre.
   !important on the position wins against both. */
const PARK = (x, y) => `(() => {
  const d = document.querySelector('.tour-dock');
  if (!d) return false;
  d.querySelector('#tGrip').dispatchEvent(new PointerEvent('pointerdown', {clientX:1600, clientY:110, bubbles:true}));
  document.dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
  d.style.setProperty('left', '${x}px', 'important');
  d.style.setProperty('top', '${y}px', 'important');
  d.style.setProperty('transition', 'none', 'important');
  const s = document.querySelector('.tour-spot'); if (s) s.style.display = 'none';
  return true;
})()`;

/* Where the dock sits is a per-beat decision, not a constant. Parked top-right
   for the whole shoot it covered the energy results — which are the single most
   important thing in the film, the moment the page finds a line no keyword
   search ranks. So each beat says which half of the screen it needs kept clear.
   TOP_RIGHT when the reel matters, BOTTOM_LEFT when the rail does. */
const TOP_RIGHT = [1484, 86];
const BOTTOM_LEFT = [36, 545];
await ev(PARK(...TOP_RIGHT));

const shoot = async (name, seconds, setup, park = TOP_RIGHT) => {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (setup) await ev(setup);
  await new Promise((r) => setTimeout(r, 350));
  await ev(PARK(...park));             // each step's apply() re-runs place()
  await new Promise((r) => setTimeout(r, 250));

  let f = 0;
  const t0 = Date.now();
  onFrame = (p) => { writeFileSync(join(dir, `${String(f++).padStart(5, "0")}.jpg`), Buffer.from(p.data, "base64")); };
  await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await send("Page.stopScreencast");
  onFrame = null;

  const elapsed = (Date.now() - t0) / 1000;
  const fps = +(f / elapsed).toFixed(3);
  console.log(`${name.padEnd(9)} ${f} frames  ${elapsed.toFixed(1)}s  ${fps} fps`);
  return { name, frames: f, seconds: +elapsed.toFixed(2), fps };
};

const seek = (i) => `(() => { document.querySelectorAll('.tl-cell')[${i}].click(); return true; })()`;

const beats = [];
beats.push(await shoot("arrive", 9, seek(0), BOTTOM_LEFT));
beats.push(await shoot("energy", 12, seek(1), BOTTOM_LEFT));
beats.push(await shoot("propose", 12, seek(3), TOP_RIGHT));
beats.push(await shoot("playing", 9, `(() => {
  document.querySelectorAll('.tl-cell')[4].click();
  setTimeout(() => Player.playSequence(Store.playSpans()), 250);
  return true; })()`, TOP_RIGHT));
beats.push(await shoot("check", 10, seek(5), BOTTOM_LEFT));
beats.push(await shoot("clean", 11, seek(6), TOP_RIGHT));

writeFileSync(join(OUT, "beats.json"), JSON.stringify(beats, null, 2));
ws.close();
process.exit(0);
