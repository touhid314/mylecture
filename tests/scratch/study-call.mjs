// Lesson screen shots: agenda column (open/collapsed) and the mic in the question box.
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
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Skip for now")?.click()`);
  await wait(500);
  await js(`(() => { const v = window.__mlStudy; const plan = ["Why we need memory", "The hidden state loop", "Unrolling through time", "A tiny worked example", "Training and its problems"];
    v._enter({ id: "tut-uicheck", topic: "what exactly is an RNN network?", title: "what exactly is an RNN network?", plan, section: 4, history: [], board: [] });
    v.board.draw({ type: "page", text: "A tiny worked example" });
    v.board.draw({ type: "write", text: "## Same weights, every step" });
    v.board.draw({ type: "math", text: "h_t = \\\\tanh(W_h h_{t-1} + W_x x_t + b)" });
    v.renderAgenda(plan, 4); v.setStatus("speaking"); return "ok"; })()`);
  await wait(1500);
  await shot("call-agenda.png");
  await js(`window.__mlStudy._collapseAgenda(true)`); await wait(500);
  await shot("call-agenda-collapsed.png");
  await js(`window.__mlStudy._collapseAgenda(false)`);
  await js(`(() => { const v = window.__mlStudy; v._talkSign("listening", "Listening…  release Space to send"); v.talkPill.style.setProperty("--level", ".7"); })()`); await wait(400);
  await shot("call-listening.png");
  await js(`window.__mlStudy._talkSign(null)`);
  win.setSize(1150, 800); await wait(800);
  await shot("call-narrow.png");
  app.exit(0);
});
