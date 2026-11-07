// README screenshot: replays a saved lesson's board on the blackboard.
//   npx electron tests/scratch/study-readme-shot.mjs --session=<json> --upto=<n> --out=<png>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import "../../electron/main.js";
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const sess = JSON.parse(fs.readFileSync(arg("session"), "utf8"));
const board = sess.board.slice(0, Number(arg("upto") || sess.board.length));
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1600, 1000); win.setFocusable(false); win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false); win.showInactive();
  const js = (c) => win.webContents.executeJavaScript(c);
  await wait(2500);
  await js(`(() => { const v = window.__mlStudy; const plan = ${JSON.stringify(sess.plan)};
    v._enter({ id: "tut-readme", topic: ${JSON.stringify(sess.topic)}, title: ${JSON.stringify(sess.title || sess.topic)}, plan, section: ${sess.section || 3}, history: [], board: [] });
    v.call.classList.add("blackboard"); v.board.setLocked(true);
    for (const a of ${JSON.stringify(board)}) v.board.draw(a, { animate: false });
    v.renderAgenda(plan, ${sess.section || 3}); v.setStatus("speaking"); v.tutorRing?.style.setProperty("--level", ".5");
    v.setCaption("So the 2 ohm resistor only carries i one. That's why it's two times i one."); return "ok"; })()`);
  await wait(1200);
  await js(`window.__mlStudy.board.point("c3.r1") || window.__mlStudy.board.point("c2.r1")`);
  await wait(700);
  win.webContents.invalidate(); await wait(300);
  fs.writeFileSync(arg("out"), (await win.webContents.capturePage()).toPNG());
  app.exit(0);
});
