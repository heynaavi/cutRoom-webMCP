/**
 * Render the demo cut with the app's own renderVideo, and let the browser
 * download it into <outDir>. The film's last beat shows this file playing —
 * it is the product's output, not a mock-up of it.
 *
 *   node render-short.mjs <appUrl> <outDir>
 */
const BASE="http://127.0.0.1:9222";
const j=(p,o)=>fetch(BASE+p,o).then(r=>r.json());
const [U,DL]=process.argv.slice(2);
const tgt=await j(`/json/new?about:blank`,{method:"PUT"});
const ws=new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
let id=0;const pend=new Map();
ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id)}};
const send=(m,p={})=>new Promise(ok=>{const i=++id;pend.set(i,ok);ws.send(JSON.stringify({id:i,method:m,params:p}))});
const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,awaitPromise:true,returnByValue:true});
 if(r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0]);
 return r.result?.result?.value;};
await send("Page.enable");await send("Runtime.enable");
await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:DL});
await send("Page.setDownloadBehavior",{behavior:"allow",downloadPath:DL});
await send("Page.navigate",{url:U});
await new Promise(r=>setTimeout(r,5000));
console.log(await ev(`(async () => {
  document.querySelector('.tour-scrim')?.remove();
  document.body.click();
  Store.clear();
  ["need an electrician","there was a teacher","on your first try","the call came","visor covering"]
    .forEach(q=>{const s=Store.state.segments.find(x=>x.text.toLowerCase().includes(q)); if(s) Store.addSpan({start:s.start,end:s.end,text:s.text});});
  for (const c of Store.state.reel){
    const cuts=[...Analysis.stammersIn(c.start,c.end),...Analysis.slackIn(c)].sort((a,b)=>a.start-b.start);
    for (const x of cuts) Store.omit(c.id,x.start,x.end);
  }
  const r = await Render.run(()=>{});
  return JSON.stringify(r);
})()`));
await new Promise(r=>setTimeout(r,3000));
ws.close();process.exit(0);
