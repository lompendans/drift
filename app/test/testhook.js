"use strict";
// Testing only (never packaged): with DRIFT_TEST_PORT set, Drift answers on 127.0.0.1 so a test can drive it.
//   POST /eval   body: JavaScript run in the main process (D = Drift's state); returns the result as JSON
//   GET  /shot   PNG of the window as it looks (the UI with the page view drawn into its card)
const http = require("http");
const { nativeImage } = require("electron");

module.exports = function start(D, port) {
  // downloads made while testing stay in the test data folder
  require("electron").app.setPath("downloads", require("path").join(process.env.DRIFT_DATA || require("os").tmpdir(), "Downloads"));
  http.createServer(async (req, res) => {
    try {
      if (req.url === "/shot") {
        const ui = await D.win.webContents.capturePage();
        const t = D.active;
        let out = ui;
        if (t && t.view && t.view.getVisible()) {
          const page = await t.view.webContents.capturePage();
          const scale = ui.getSize().width / D.win.getContentSize()[0];
          const b = t.view.getBounds();
          const ub = ui.toBitmap(), us = ui.getSize();
          const pg = page.resize({ width: Math.round(b.width * scale), height: Math.round(b.height * scale) });
          const pb = pg.toBitmap(), ps = pg.getSize();
          const ox = Math.round(b.x * scale), oy = Math.round(b.y * scale);
          for (let y = 0; y < ps.height && oy + y < us.height; y++)
            pb.copy(ub, ((oy + y) * us.width + ox) * 4, y * ps.width * 4, (y * ps.width + Math.min(ps.width, us.width - ox)) * 4);
          out = nativeImage.createFromBitmap(ub, { width: us.width, height: us.height });
        }
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(out.toPNG());
        return;
      }
      let body = "";
      for await (const c of req) body += c;
      const fn = new Function("D", "require", `return (async () => { ${body} })()`);
      const result = await fn(D, require);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result === undefined ? null : result));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e && e.stack || e));
    }
  }).listen(port, "127.0.0.1");
};
