// End-to-end WebMCP verification against a real Chrome 149+.
//   node scripts/test-webmcp.mjs [url]
// Requires Chrome launched with:
//   --remote-debugging-port=9222 --enable-features=WebMCP
const BASE = "http://127.0.0.1:9222";
const j = (p, o) => fetch(BASE + p, o).then((r) => r.json());
const tgt = await j(`/json/new?${encodeURIComponent(process.argv[2] || "http://localhost:4321")}`, { method: "PUT" });
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  return r.result?.exceptionDetails ? { __throw: r.result.exceptionDetails.exception?.description } : r.result?.result?.value;
};
await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 3500));

// Chrome hands the page's return value back as a JSON string, and takes
// arguments as one too. This helper is the real calling convention.
const HELPER = `
  window.__T = async (name, args) => {
    const tools = await document.modelContext.getTools();
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Error("no such tool: " + name);
    const raw = await document.modelContext.executeTool(tool, JSON.stringify(args || {}));
    const env = typeof raw === "string" ? JSON.parse(raw) : raw;
    const text = env?.content?.[0]?.text ?? "";
    try { return JSON.parse(text); } catch { return text; }
  };`;
await ev(HELPER);

const out = { chrome: (await j("/json/version")).Browser };

out.registration = await ev(`({ label: document.getElementById('agentLabel').textContent,
                                tools: (document.getElementById('agentDot').title||"").split(", ").length })`);

out.schemas = await ev(`(async () => {
  const t = await document.modelContext.getTools();
  return t.map(x => { const s = JSON.parse(typeof x.inputSchema === "string" ? x.inputSchema : JSON.stringify(x.inputSchema||{}));
    return x.name + " (required: " + JSON.stringify(s.required || []) + ")"; });
})()`);

out.search = await ev(`(async () => (await __T("searchTranscript", {query:"the call came", limit:2}))
  .map(h => Math.round(h.startSec)+"s :: "+h.text.slice(0,54)))()`);

out.proposeCut = await ev(`(async () => {
  await __T("proposeCut", { title:"Agent cut", description:"proposed through document.modelContext",
    spans:[{startSec:320.5,endSec:327.9,why:"where he started"},
           {startSec:1126.2,endSec:1132.6,why:"the call itself"}]});
  await new Promise(z=>setTimeout(z,400));
  return { ghostCardsInDom: document.querySelectorAll('.clip.ghost').length,
           whyRendered: [...document.querySelectorAll('.clip-why')].map(n=>n.textContent),
           ledger: [...document.querySelectorAll('.log-tool')].map(n=>n.textContent),
           budget: document.getElementById('budgetNum').textContent.replace(/\\s+/g," ") };
})()`);

out.playReel = await ev(`(async () => {
  const reply = await __T("playReel", {});
  await new Promise(z=>setTimeout(z,1200));
  const a = document.getElementById('audio');
  return { reply: String(reply).slice(0,64), audioActuallyPlaying: !a.paused, atSec: +a.currentTime.toFixed(1) };
})()`);

out.agentSeesWhatHumanDid = await ev(`(async () => {
  Store.toggleMute(Store.state.reel[0].id);   // human mutes clip 1
  Store.star(140);                            // human stars a line
  await new Promise(z=>setTimeout(z,150));
  const s = await __T("getReelState", {});
  return { clip0Muted: s.clips[0].muted, pendingCount: s.pendingCount,
           starredCount: s.starredCount, spreadPct: s.spreadPct, durationSec: s.durationSec };
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close();
