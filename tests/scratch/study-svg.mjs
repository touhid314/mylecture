// Renders the SVG lines of a saved tutor session on both boards (no AI calls).
//   npx electron tests/scratch/study-svg.mjs --session=<json> --out=<dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = arg("out") || ".";
const sess = JSON.parse(fs.readFileSync(arg("session"), "utf8"));
const svgs = [];
for (const h of sess.history || []) for (const l of String(h.text || "").split("\n")) { const m = /^svg(?:#(\w+))?:\s*(.*)$/.exec(l); if (m) svgs.push({ id: m[1] || "", text: m[2] }); }
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 1000); win.setFocusable(false); win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false); win.showInactive();
  win.webContents.on("console-message", (d) => console.log("CONSOLE", d.message.slice(0, 300)));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { win.webContents.invalidate(); await wait(300); fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG()); };
  await wait(2500);
  for (const board of ["blackboard", "whiteboard"]) for (let i = 0; i < svgs.length; i++) {
    const r = await js(`(() => { const v = window.__mlStudy; v._enter({ id: "tut-svgcheck", topic: "SVG", title: "SVG", plan: [], section: 0, history: [], board: [] });
      v.call.classList.toggle("blackboard", ${board === "blackboard"});
      v.board.draw({ type: "page", text: "svg ${i}" });
      const el = v.board.draw({ type: "svg", id: ${JSON.stringify(svgs[i].id)}, text: ${JSON.stringify(svgs[i].text)} });
      const s = el && el.querySelector("svg"); return s ? JSON.stringify(s.getBoundingClientRect()) : "NULL"; })()`);
    console.log(board, i, r);
    await wait(1800); await shot(`${board}-${i}.png`);
  }
  app.exit(0);
});
