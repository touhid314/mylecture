// Renders one scene JSON on both boards (no AI calls).
//   npx electron tests/scratch/study-scene.mjs --scene=<json file> --out=<dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = arg("out") || ".";
const scene = fs.readFileSync(arg("scene"), "utf8");
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900); win.setFocusable(false); win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false); win.showInactive();
  win.webContents.on("console-message", (d) => console.log("CONSOLE", d.message.slice(0, 300)));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { win.webContents.invalidate(); await wait(300); fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG()); };
  await wait(2500);
  for (const board of ["blackboard", "whiteboard"]) {
    await js(`(() => { const v = window.__mlStudy; v._enter({ id: "tut-scenecheck", topic: "Scene", title: "Scene", plan: [], section: 0, history: [], board: [] });
      v.call.classList.toggle("blackboard", ${board === "blackboard"});
      v.board.draw({ type: "page", text: "Scene check" }); v.board.draw({ type: "scene", id: "s", data: ${scene} }); return "ok"; })()`);
    await wait(3000); await shot(`scene-${board}.png`);
  }
  app.exit(0);
});
