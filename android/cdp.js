// Testing helper: runs JavaScript in one of Drift's web views in the emulator (debug builds only).
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
//   node cdp.js <part of the page's URL> "<expression>"
const [, , match, expr] = process.argv;
(async () => {
  const pages = await (await fetch("http://localhost:9333/json")).json();
  const all = pages.filter(p => p.type === "page" && p.url.includes(match));
  const page = all.find(p => /"visible":true/.test(p.description || "")) || all[0];   // the tab on screen first
  if (!page) { console.log("no page matching", match, pages.map(p => p.url)); return; }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id !== 1) return;
    const r = m.result.result;
    console.log(m.result.exceptionDetails ? "error: " + JSON.stringify(m.result.exceptionDetails.exception?.description) : JSON.stringify(r.value ?? r.description));
    ws.close();
  };
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true } }));
})();
