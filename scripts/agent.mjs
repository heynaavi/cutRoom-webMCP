/* ═══════════════════════════════════════════════════════════════════════════
   A minimal REAL agent driving the page over WebMCP.

   Everything else in this repo proves the API works. This proves an LLM can
   discover the tools and decide, on its own, which to call — which is the
   actual claim WebMCP makes and the one thing our other tests never covered.

   It does exactly what a browser agent does:
     1. read document.modelContext.getTools() from the live page
     2. hand those schemas to a model as its tool list
     3. execute whatever the model picks, via executeTool, in the page
     4. feed results back and loop until the model stops calling tools

   Usage:
     ANTHROPIC_API_KEY=… node scripts/agent.mjs "find me 60 seconds on …"
     OPENAI_API_KEY=…    node scripts/agent.mjs "…"
   Requires a Chrome started by bin/try.sh (it opens the debug port).
   ═══════════════════════════════════════════════════════════════════════════ */
const CDP = "http://127.0.0.1:9222";
const URL_ = process.env.CUTROOM_URL || "http://localhost:4321";
const TASK = process.argv.slice(2).join(" ") ||
  "Call listCapabilities first. Then find me 60 seconds on how he went from electrician to astronaut: propose two contrasting angles, play the stronger one, clean it up, and give me the exact timestamps.";

const j = (p, o) => fetch(CDP + p, o).then((r) => r.json());
const tgt = await j(`/json/new?about:blank`, { method: "PUT" }).catch(() => null);
if (!tgt) { console.error("No debuggable Chrome on :9222 — run bin/try.sh first."); process.exit(1); }
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0] || "eval failed");
  return r.result?.result?.value;
};

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: URL_ });
await new Promise((r) => setTimeout(r, 4500));
await ev(`document.body.click()`);   // satisfy autoplay policy up front

// ── 1. discover, exactly as an agent would ───────────────────────────────────
const tools = await ev(`(async () => {
  const t = await document.modelContext.getTools();
  return t.map(x => ({ name: x.name, description: x.description,
    inputSchema: JSON.parse(typeof x.inputSchema === "string" ? x.inputSchema : JSON.stringify(x.inputSchema || {})) }));
})()`);
console.log(`discovered ${tools.length} tools from the live page\n`);

// ── 2. execute in the page, exactly as an agent would ────────────────────────
const call = async (name, args) => {
  const out = await ev(`(async () => {
    const tools = await document.modelContext.getTools();
    const tool = tools.find(t => t.name === ${JSON.stringify(name)});
    if (!tool) return "no such tool";
    const raw = await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(args || {}))});
    const env = typeof raw === "string" ? JSON.parse(raw) : raw;
    return env?.content?.[0]?.text ?? JSON.stringify(env);
  })()`);
  return String(out).slice(0, 4000);
};

// ── 3. the model loop ────────────────────────────────────────────────────────
const AK = process.env.ANTHROPIC_API_KEY, OK_ = process.env.OPENAI_API_KEY;
if (!AK && !OK_) {
  console.error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to let a model drive.");
  console.error(`Tools are discoverable though — ${tools.length} found. Listing and exiting.`);
  tools.forEach((t) => console.error("  ·", t.name));
  process.exit(2);
}

const SYS = "You are operating a podcast-cutting web page through its WebMCP tools. Use the tools to do the work — never invent timestamps. Call listCapabilities first if you are unsure. When you are done, summarise the cut and its exact timestamps.";
let calls = 0;

if (AK) {
  const msgs = [{ role: "user", content: TASK }];
  for (let turn = 0; turn < 12; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 2000, system: SYS, messages: msgs,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }),
    }).then((r) => r.json());
    if (res.error) { console.error("API error:", res.error.message); break; }
    msgs.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((c) => c.type === "tool_use");
    res.content.filter((c) => c.type === "text" && c.text.trim()).forEach((c) => console.log("model:", c.text.trim()));
    if (!uses.length) break;
    const results = [];
    for (const u of uses) {
      calls++;
      console.log(`  → ${u.name}(${JSON.stringify(u.input).slice(0, 90)})`);
      const out = await call(u.name, u.input);
      console.log(`    ${out.slice(0, 160).replace(/\n/g, " ")}`);
      results.push({ type: "tool_result", tool_use_id: u.id, content: out });
    }
    msgs.push({ role: "user", content: results });
  }
} else {
  const msgs = [{ role: "system", content: SYS }, { role: "user", content: TASK }];
  for (let turn = 0; turn < 12; turn++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OK_}` },
      body: JSON.stringify({ model: "gpt-4o", messages: msgs,
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }),
    }).then((r) => r.json());
    if (res.error) { console.error("API error:", res.error.message); break; }
    const m = res.choices[0].message;
    msgs.push(m);
    if (m.content) console.log("model:", m.content.trim());
    if (!m.tool_calls?.length) break;
    for (const tc of m.tool_calls) {
      calls++;
      console.log(`  → ${tc.function.name}(${tc.function.arguments.slice(0, 90)})`);
      const out = await call(tc.function.name, JSON.parse(tc.function.arguments || "{}"));
      console.log(`    ${out.slice(0, 160).replace(/\n/g, " ")}`);
      msgs.push({ role: "tool", tool_call_id: tc.id, content: out });
    }
  }
}

// ── 4. what actually happened to the page ────────────────────────────────────
const final = await ev(`JSON.stringify({
  clips: Store.state.reel.length,
  spans: Store.playSpans().length,
  seconds: +Store.reelDur().toFixed(1),
  ledger: [...document.querySelectorAll('.log-tool')].map(n => n.textContent),
})`);
console.log(`\nmodel made ${calls} tool calls`);
console.log("page state:", final);
ws.close();
