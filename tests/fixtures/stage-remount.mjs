// Electron fixture: an HTML scene that disappears from the stage (empty scene
// list) and comes back must be remounted, not rendered into a detached frame.
import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-stage-remount-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
const finish = (result, code) => {
  fs.writeFileSync(report, JSON.stringify(result));
  app.exit(code);
};
app.setPath("userData", path.join(temp, "profile"));
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(async () => {
  protocol.handle("mylecture", (request) => {
    const url = new URL(request.url);
    const file = url.pathname.startsWith("/test-scene/") ? path.join(temp, path.basename(url.pathname)) : path.join(appDir, url.pathname.slice(1));
    if (fs.existsSync(file)) return net.fetch(pathToFileURL(file).href);
    return new Response("", { headers: { "content-type": file.endsWith(".css") ? "text/css" : "text/javascript" } });
  });
  fs.writeFileSync(path.join(temp, "s1.html"), `<!doctype html><html><head></head><body><div id="b">x</div><script>window.__RENDER_SECTION__=(seg,l,g)=>{document.getElementById("b").textContent=String(g)};</script></body></html>`);
  const win = new BrowserWindow({ show: false, width: 960, height: 540, webPreferences: { offscreen: true } });
  try {
    await win.loadURL("mylecture://app/stage/stage.html");
    const result = await win.webContents.executeJavaScript(`(async () => {
      const errors = [];
      addEventListener("message", (e) => { if (e.data && e.data.type === "stage-error") errors.push(e.data.message); });
      const scenes = [{ kind: "html", src: "mylecture://app/test-scene/s1.html", title: "One", beats: [{ text: "a", dur: 2, segment: { id: "i1" } }] }];
      const post = (m) => new Promise((r) => { postMessage(m, "*"); setTimeout(r, 50); });
      window.__ML.load({ aspect: "16:9", theme: "dark", scenes }, { captions: false });
      await window.__ML.seek(0.5);
      await post({ type: "scenes", scenes: [], t: 0 });      // stage cleared (new turn / project reset)
      await post({ type: "scenes", scenes, t: 0.6 });        // the same scene comes back
      await window.__ML.seek(0.7);
      await new Promise((r) => setTimeout(r, 300));
      return { errors, frames: document.querySelectorAll("#scene-root iframe").length };
    })()`);
    finish(result, result.errors.length || result.frames !== 1 ? 1 : 0);
  } catch (e) {
    finish({ error: String(e.stack || e) }, 1);
  }
});
