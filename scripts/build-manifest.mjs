// Emit a machine-readable tool manifest FROM the real tools.js, so it can never
// drift from what the page registers. (A hand-written count said "ten" while
// the page registered 33 — an agent inspecting the site caught it.)
import { readFileSync, writeFileSync } from "node:fs";

let src = readFileSync("app/js/tools.js", "utf8")
  .replace("const TOOLS = [", "globalThis.__TOOLS = [")
  .replace(/\bTOOLS\b/g, "__TOOLS");

const stub = () => new Proxy(() => ({}), { get: () => stub(), apply: () => ({}) });
globalThis.document = { modelContext: undefined, readyState: "complete",
  addEventListener() {}, getElementById: () => ({ classList: { add() {} }, innerHTML: "", textContent: "", title: "" }) };
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
globalThis.window = globalThis;
// tools.js watches for a late-attaching agent with bare addEventListener calls,
// which resolve to globalThis and don't exist in Node. Without these the whole
// build throws and you keep shipping whatever manifest was there before.
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
for (const k of ["Store", "Player", "UI", "Analysis", "Ingest"]) globalThis[k] = stub();
new Function(src)();

const TOOLS = globalThis.__TOOLS;
const BASE = "https://cutroom-webmcp.vercel.app";

const manifest = {
  name: "Cutroom",
  description:
    "A cutting surface for turning a long recording into a short. Tools are registered in-page on document.modelContext (WebMCP) — this file is a static description of them, not a callable endpoint. If your runtime has a WebMCP bridge, call the tools. If it doesn't, see fallback below: the transcript is fetchable and you can still return real timestamps.",
  homepage: BASE,
  source: "https://github.com/heynaavi/cutRoom-webMCP",
  license: "MIT",
  protocol: { type: "webmcp", surface: "document.modelContext", spec: "https://github.com/webmachinelearning/webmcp" },
  transport: {
    note: "There is no HTTP MCP endpoint. Tools execute inside the page, against media and a transcript already loaded in the browser.",
    requires: "ChatGPT's browser with site tools (GPT-5.6 Sol or Terra), or Chrome 149+ with chrome://flags/#enable-webmcp-testing.",
  },
  fallback: {
    note: "No bridge? You can still be useful without inventing anything. Fetch the transcript, pick spans, and hand back real timestamps for the human to paste in.",
    transcript: `${BASE}/data/transcript.json`,
    transcriptShape: "{ title, credit, durationSec, words:[{wi,word,start,end}], segments:[{start,end,text}] } — seconds, verbatim (disfluencies retained).",
    waveform: `${BASE}/data/peaks.json`,
    waveformShape: "Array of ~21000 normalised RMS values, evenly spaced across durationSec. Higher = louder. Use it to find emphasis the transcript can't show.",
    guidance: `${BASE}/llms.txt`,
  },
  toolCount: TOOLS.length,
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    readOnly: !!t.annotations?.readOnlyHint,
    inputSchema: t.inputSchema,
  })),
};

writeFileSync("app/.well-known/mcp.json", JSON.stringify(manifest, null, 2) + "\n");

// Keep the static HTML honest too: the count an agent reads without running JS,
// and a machine-readable tool list for one that parses the source.
let html = readFileSync("app/index.html", "utf8");
html = html.replace(/(<!-- cutroom:static-status -->\s*\n\s*<b>)\d+( WebMCP tools)/,
                    `$1${TOOLS.length}$2`);
const block = `<script type="application/json" id="cutroom-tools">\n${JSON.stringify(
  { toolCount: TOOLS.length, manifest: "/.well-known/mcp.json", guidance: "/llms.txt",
    tools: TOOLS.map((t) => t.name) })}\n</script>`;
html = /<script type="application\/json" id="cutroom-tools">[\s\S]*?<\/script>/.test(html)
  ? html.replace(/<script type="application\/json" id="cutroom-tools">[\s\S]*?<\/script>/, block)
  : html.replace('<link rel="stylesheet" href="css/cutroom.css" />', `${block}\n<link rel="stylesheet" href="css/cutroom.css" />`);
writeFileSync("app/index.html", html);

console.log(`manifest: ${TOOLS.length} tools, ${TOOLS.filter((t) => t.annotations?.readOnlyHint).length} read-only; index.html static block synced`);
