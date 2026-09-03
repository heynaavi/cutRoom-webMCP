/**
 * Render the gallery cards, one Chrome target for all of them.
 *
 * A fresh CDP target per card looked fine and produced files that were each
 * one card behind — the screenshot landed before the new document had
 * replaced the old one. So: one target, navigate, then ask the page which card
 * it is actually showing and refuse to shoot until it matches.
 *
 *   node render-gallery.mjs <galleryHtmlFileUrl> <outDir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BASE = "http://127.0.0.1:9222";
const j = (p, o) => fetch(BASE + p, o).then((r) => r.json());
const [HTML, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const CARDS = [
  ["c01", "01-the-problem"], ["c02", "02-it-can-hear"], ["c03", "03-it-proposes-you-decide"],
  ["c04", "04-cleanup-visible"], ["c05", "05-checks-itself"], ["c06", "06-33-tools"],
  ["c07", "07-the-output"], ["c08", "08-closer"],
];

const tgt = await j(`/json/new?about:blank`, { method: "PUT" });
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (m, p = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1200, deviceScaleFactor: 1, mobile: false });

for (const [card, name] of CARDS) {
  await send("Page.navigate", { url: `${HTML}?card=${card}` });
  let showing = null;
  for (let tries = 0; tries < 40 && showing !== card; tries++) {
    await new Promise((r) => setTimeout(r, 150));
    showing = await ev(`document.querySelector('.card.on')?.id`);
  }
  if (showing !== card) throw new Error(`${name}: page is showing ${showing}, wanted ${card}`);
  await ev(`__ready()`);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const png = join(OUT, `${name}.png`), jpg = join(OUT, `${name}.jpg`);
  writeFileSync(png, Buffer.from(shot.result.data, "base64"));
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", png, "-q:v", "2", jpg]);
  execFileSync("rm", [png]);
  console.log(`  ${name}  ←  ${card}`);
}
ws.close(); process.exit(0);
