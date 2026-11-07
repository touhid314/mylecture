// Board-only UI check: draws known items and points at them (no AI calls).
//   MYLECTURE_PROFILE=<dir> npx electron tests/scratch/study-board.mjs --out=<dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";
const EQ = "f'(x) = \\lim_{h \\to 0} \\frac{\\htmlId{rise}{f(x+h) - f(x)}}{\\htmlId{run}{h}}";
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) || ".";
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 940); win.setFocusable(false); win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false); win.showInactive();
  win.webContents.on("console-message", (d) => console.log("CONSOLE", d.message.slice(0, 300)));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { win.webContents.invalidate(); await wait(300); fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG()); };
  await wait(2500);
  await js(`(() => { const v = window.__mlStudy; v._enter({ id: "tut-uicheck", topic: "Pointing check", title: "Pointing check", plan: ["The big picture", "The chain rule as blame-passing", "Working backward"], section: 2, history: [], board: [] });
    const b = v.board;
    b.draw({ type: "page", text: "Pointing check" });
    b.draw({ type: "write", id: "def", text: "**Derivative** = the rate of change of a function" });
    b.draw({ type: "math", id: "eq1", text: ${JSON.stringify(EQ)} });
    b.draw({ type: "scene", id: "road", data: { w: 600, h: 160, items: [{ type: "rect", x: 0, y: 110, w: 600, h: 30, fill: "#555" }, { type: "emoji", id: "car", char: "🚗", x: 80, y: 100, size: 46, flip: true }] } });
    v.renderAgenda(["The big picture", "The chain rule as blame-passing", "Working backward"], 2); v.setStatus("speaking"); v.setCaption("So, a question. If I nudge w by a tiny bit, how much does L move?"); return "ok"; })()`);
  await wait(4000);
  for (const ref of ["eq1.rise", "def/rate of change", "road.car", "eq1.run"]) {
    console.log("POINT", ref, await js(`window.__mlStudy.board.point(${JSON.stringify(ref)})`), await js(`(() => { const m = document.querySelector(".wb-mark:not(.out)"); return m ? m.style.cssText : "none"; })()`));
    await wait(900);
    await shot(`point-${ref.replace(/[^\w]/g, "_")}.png`);
  }
  const st = () => js("({ locked: document.querySelector(\".wb\").classList.contains(\"locked\"), overflow: getComputedStyle(document.querySelector(\".wb-scroll\")).overflowY, atEnd: (() => { const sc = document.querySelector(\".wb-scroll\"); return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 4; })() })");
  await js("window.__mlStudy.board.setLocked(true)"); await wait(300); console.log("LIVE", JSON.stringify(await st()));
  await js("window.__mlStudy.lesson.togglePause()"); await wait(300); console.log("PAUSED", JSON.stringify(await st()));
  await js("document.querySelector(\".wb-scroll\").scrollTop = 0"); await wait(200);
  await js("window.__mlStudy.lesson.togglePause()"); await wait(600); console.log("RESUMED", JSON.stringify(await st()));
  await js("window.__mlStudy.call.classList.add(\"blackboard\"); window.__mlStudy.board.draw({ type: \"scene\", id: \"bbscene\", data: { w: 600, h: 200, bg: \"#f5f7fb\", items: [{ type: \"rect\", x: 40, y: 40, w: 160, h: 50, r: 8, fill: \"#93c5fd\" }, { type: \"text\", x: 120, y: 66, text: \"countdown(3)\", size: 20 }, { type: \"emoji\", x: 520, y: 120, char: \"🚀\", size: 40 }] } })");
  await wait(1500); await shot("blackboard-scene.png");
  await js("window.__mlStudy.call.classList.remove(\"blackboard\")");
  await js("window.__mlStudy.setStatus(\"speaking\"); window.__mlStudy.tutorRing.style.setProperty(\"--level\", \".6\")");
  await shot("layout.png");
  await js("window.__mlStudy.call.classList.add(\"fs\")"); await wait(500); await shot("fs-hidden.png");
  await js("window.__mlStudy.call.classList.add(\"bar-shown\")"); await wait(500); await shot("fs-bar.png");
  app.exit(0);
});
