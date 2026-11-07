// Replays a saved session's board, then points at a diagram from an earlier
// page while the last page is live (no AI calls).
//   npx electron tests/scratch/study-pin.mjs --session=<json> --ref=c2.vs --out=<dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = arg("out") || ".";
const sess = JSON.parse(fs.readFileSync(arg("session"), "utf8"));
if (arg("upto")) sess.board = sess.board.slice(0, Number(arg("upto")));
const refs = (arg("ref") || "c2.vs,c2.r1").split(",");
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
  await js(`(() => { const v = window.__mlStudy; v._enter({ id: "tut-pincheck", topic: "Pin", title: "Pin", plan: [], section: 0, history: [], board: [] });
    v.call.classList.add("blackboard"); v.board.setLocked(true);
    for (const a of ${JSON.stringify(sess.board)}) v.board.draw(a); return "ok"; })()`);
  await wait(1500);
  for (const ref of refs) {
    console.log("POINT", ref, await js(`window.__mlStudy.board.point(${JSON.stringify(ref)})`), await js(`(() => { const b = window.__mlStudy.board; return JSON.stringify({ viewing: b.viewing, current: b.current, pinned: document.querySelectorAll(".wb-pinned").length }); })()`));
    await wait(900); await shot(`pin-${ref.replace(/\W/g, "_")}.png`);
  }
  await wait(3500); await shot("pin-after.png");
  console.log("AFTER", await js(`(() => { const b = window.__mlStudy.board; return JSON.stringify({ viewing: b.viewing, current: b.current, pinned: document.querySelectorAll(".wb-pinned").length }); })()`));
  app.exit(0);
});
