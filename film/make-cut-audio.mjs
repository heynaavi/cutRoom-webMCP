/**
 * Produce the cut's audio using the command the page itself hands over.
 *
 * The film's last beat claims the manifest's ffmpeg command runs. Rather than
 * take that on trust, the build asks `getCutManifest` for the command, swaps in
 * the real input and output paths, and runs it. If the tool ever emits something
 * that doesn't execute, the video cannot be built — which is the right failure.
 *
 *   node make-cut-audio.mjs <appUrl> <inputMedia> <outFile>
 */
import { execFileSync } from "node:child_process";

const BASE = "http://127.0.0.1:9222";
const j = (p, o) => fetch(BASE + p, o).then((r) => r.json());
const [APP, INPUT, OUT] = process.argv.slice(2);

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

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: APP });
await new Promise((r) => setTimeout(r, 5000));

const text = await ev(`(async () => {
  document.querySelector('.tour-scrim')?.remove();
  Store.clear();
  ["need an electrician","there was a teacher","on your first try","the call came","visor covering"]
    .forEach(q => { const s = Store.state.segments.find(x => x.text.toLowerCase().includes(q));
                    if (s) Store.addSpan({ start: s.start, end: s.end, text: s.text }); });
  for (const c of Store.state.reel) {
    const cuts = [...Analysis.stammersIn(c.start, c.end), ...Analysis.slackIn(c)].sort((a,b) => a.start - b.start);
    for (const x of cuts) Store.omit(c.id, x.start, x.end);
  }
  const tools = await document.modelContext.getTools();
  const t = tools.find(x => x.name === 'getCutManifest');
  const raw = await document.modelContext.executeTool(t, '{}');
  const env = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return env.content[0].text;
})()`);
ws.close();

const manifest = JSON.parse(text);
const cmd = manifest.ffmpeg.audioOnly
  .replace("-i INPUT", `-i ${INPUT}`)
  .replace(/OUTPUT\.m4a$/, OUT);

// Split on spaces except inside the quoted filter expression.
const args = cmd.match(/(?:[^\s"]+|"[^"]*")+/g).slice(1).map((a) => a.replace(/^"|"$/g, ""));
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
console.log(`  ${OUT} — ${manifest.spanCount} spans, manifest says ${manifest.durationSec}s`);
