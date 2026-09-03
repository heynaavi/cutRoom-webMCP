/**
 * Render the motion cards to PNG frames, deterministically.
 *
 * GSAP is used for the curves and the timeline algebra, but nothing is allowed
 * to advance on wall-clock time: `gsap.ticker.remove(gsap.updateRoot)` in the
 * page detaches the engine from rAF, and this driver seeks to an exact time
 * before every capture. So frame N is the same pixels whether the machine drew
 * it in 4ms or 400, and a slow font load cannot shear a tween across two frames.
 *
 * PNG rather than JPEG: these frames are flat colour and hard-edged type, and
 * JPEG frames make the encoder emit full-range yuvj420p, which some players read
 * as limited range and wash out.
 *
 *   node render-cards.mjs <fileUrl> <outDir> [sceneId]
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:9222";
const j = (p, o) => fetch(BASE + p, o).then((r) => r.json());
const [URL_, OUT, ONLY] = process.argv.slice(2);
const FPS = 30;

const tgt = await j(`/json/new?about:blank`, { method: "PUT" });
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (m, p = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0]);
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL_ });
await new Promise((r) => setTimeout(r, 2500));
await ev(`__ready()`);
await new Promise((r) => setTimeout(r, 600));   // let the variable fonts settle

const scenes = await ev(`JSON.stringify(__list())`).then(JSON.parse);
const todo = ONLY ? scenes.filter((s) => s.id === ONLY) : scenes;

for (const s of todo) {
  const dir = join(OUT, s.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await ev(`__scene(${JSON.stringify(s.id)})`);
  const frames = Math.round(s.sec * FPS);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await ev(`__seek(${(f / FPS).toFixed(4)})`);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(dir, `${String(f).padStart(5, "0")}.png`), Buffer.from(shot.result.data, "base64"));
  }
  console.log(`${s.id.padEnd(5)} ${frames} frames  ${s.sec}s  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

ws.close();
process.exit(0);
