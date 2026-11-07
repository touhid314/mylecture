// Study home screen shots (whiteboard and blackboard). No AI calls.
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
  await wait(800);
  for (const style of ["whiteboard", "blackboard"]) {
    await js(`window.__mlStudy._saveSettings({ boardStyle: ${JSON.stringify(style)} })`);
    await wait(1200);
    await js(`(() => { const u = window.__mlStudy.usage; u.root.dataset.state = "low"; u.summary.textContent = "5h 15% · weekly all 22%"; window.__mlStudy.tutorBtn.querySelector("b").textContent = "Claude · opus"; })()`);
    await shot(`home-${style}.png`);
    win.setSize(1100, 800); await wait(600); await shot(`home-${style}-narrow.png`); win.setSize(1500, 940); await wait(400);
  }
  // The default follows the app theme.
  for (const theme of ["light", "dark"]) {
    await js(`(async () => { await window.__mlStudy._saveSettings({ boardStyle: "auto", uiTheme: ${JSON.stringify(theme)} }); document.body.classList.toggle("light", ${JSON.stringify(theme)} === "light"); })()`);
    await wait(900);
    console.log("AUTO", theme, await js(`document.querySelector(".st-home").classList.contains("blackboard") ? "blackboard" : "whiteboard"`));
    await shot(`home-auto-${theme}.png`);
  }
  app.exit(0);
});
