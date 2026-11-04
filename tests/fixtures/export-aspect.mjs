import { app, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { exportMp4, ffmpegPath } from "../../electron/exporter.js";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-export-aspect-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
const finish = (result, code) => {
  fs.writeFileSync(report, JSON.stringify({ ...result, temp }));
  app.exit(code);
};
app.setPath("userData", path.join(temp, "profile"));
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(async () => {
  protocol.handle("mylecture", request => {
    const url = new URL(request.url);
    const file = url.pathname.startsWith("/test-scene/") ? path.join(temp, path.basename(url.pathname)) : path.join(appDir, url.pathname.slice(1));
    if (fs.existsSync(file)) return net.fetch(pathToFileURL(file).href);
    // The fixture uses only solid shapes; optional theme fonts/libraries are unnecessary.
    return new Response("", { headers: { "content-type": file.endsWith(".css") ? "text/css" : "text/javascript" } });
  });
  const results = [];
  for (const [aspect, W, H] of [["16:9", 1920, 1080], ["9:16", 1080, 1920], ["1:1", 1080, 1080]]) {
    for (const height of [1080, 720]) {
      const shape = `<div style="position:absolute;inset:0;background:#00ff00"><div style="position:absolute;left:${W/2-150}px;top:${H/2-150}px;width:300px;height:300px;background:#ff00ff"></div></div>`;
      const file = `${W}-${H}.html`;
      fs.writeFileSync(path.join(temp, file), `<!doctype html><html><head><style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}</style></head><body>${shape}<script>window.__RENDER_SECTION__=()=>{};</script></body></html>`);
      const scene = height === 1080 ? { html: shape, js: "function render(){}" }
        : { kind: "html", src: `mylecture://app/test-scene/${file}` };
      const progress = [];
      const output = await exportMp4({ title: `check-${W}-${H}-${height}`, aspect, theme: "dark", scenes: [{ ...scene, beats: [{ id: "i1", text: "", dur: 0.2 }] }] }, {
        ttsFile: () => "", outDir: temp, fps: 10, height, onProgress: p => progress.push(p),
      });
      const scale = height / Math.min(W,H);
      const OW = Math.round(W*scale/2)*2, OH = Math.round(H*scale/2)*2;
      const decoded = spawnSync(ffmpegPath(), ["-hide_banner", "-i", output, "-ss", height === 1080 ? "0.5" : "0.1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 32*1024*1024, windowsHide: true });
      assert.equal(decoded.status, 0, decoded.stderr?.toString());
      const info = decoded.stderr.toString();
      assert.match(info, new RegExp(`${OW}x${OH} \\[SAR 1:1 DAR`));
      const pixels = decoded.stdout;
      assert.equal(pixels.length, OW*OH*3);
      const rgb = (x,y) => [...pixels.subarray((y*OW+x)*3,(y*OW+x)*3+3)];
      for (const [x,y] of [[5,5],[OW-6,5],[5,OH-6],[OW-6,OH-6]]) {
        const [r,g,b] = rgb(x,y);
        assert.ok(g>200 && r<40 && b<40, `Letterboxing at ${aspect} ${height}: ${rgb(x,y)}`);
      }
      const magenta = (x,y) => { const [r,g,b] = rgb(x,y); return r>180 && b>180 && g<70; };
      let width = 0, measuredHeight = 0;
      for (let x=0;x<OW;x++) if (magenta(x,Math.floor(OH/2))) width++;
      for (let y=0;y<OH;y++) if (magenta(Math.floor(OW/2),y)) measuredHeight++;
      assert.ok(Math.abs(width-300*scale)<=4 && Math.abs(measuredHeight-300*scale)<=4, `Shape stretched: ${width}×${measuredHeight}`);
      assert.ok(progress.some(p=>p.width===OW && p.height===OH));
      results.push({ aspect, width: OW, height: OH, shape: [width,measuredHeight] });
    }
  }
  finish({ ok: true, results }, 0);
}).catch(error => finish({ ok: false, error: error.stack }, 1));
