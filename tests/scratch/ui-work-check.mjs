// Visual check of the Create panel's agent work view: replays an agent turn's
// events (live timeline, then "Worked for" + final message) and screenshots.
//   npx electron tests/scratch/ui-work-check.mjs
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

import "../../electron/main.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(run);
async function run() {
await wait(2500);
const win = BrowserWindow.getAllWindows()[0];
win.setSize(1500, 950);
const wc = win.webContents;
const out = path.resolve("tests/scratch/out");
fs.mkdirSync(out, { recursive: true });
const shot = async (name) => fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG());

await wc.executeJavaScript(`document.querySelector('[data-view="create"]').click()`);
await wait(800);
const projectId = undefined;
wc.send("ide:job", { projectId, type: "agent edit", state: "running" });
const items = [
  "💬 I'll look at the scene files first, then tighten the layout.",
  "🔧 read C:\\Users\\touhi\\AppData\\Roaming\\MyLecture\\library\\lec-1\\index1.html",
  "🔧 read C:\\Users\\touhi\\AppData\\Roaming\\MyLecture\\library\\lec-1\\index2.html",
  '▶ node -e "console.log(1)"',
  "💬 The math overlay overlaps the circuit. I'll move it into its own **grid row** and shrink the labels:\n\n- `index1.html`: padding\n- `index3.html`: font sizes",
  "✏️ C:\\x\\lec-1\\index1.html, C:\\x\\lec-1\\index3.html",
  "🔧 Validating index1.html",
  "🔧 Recording narration for index1.html",
];
for (let i = 1; i <= items.length; i++) {
  wc.send("ide:activity", { projectId, items: items.slice(0, i) });
  await wait(150);
}
await wait(1200);
await shot("work-live.png");
wc.send("ide:log", { projectId, kind: "reply", text: "Fixed all overlaps across [index1.html](file:///C:/Users/touhi/AppData/Roaming/MyLecture/library/lec-1/index1.html) and [index3.html](file:///C:/x/index3.html):\n\n1. Moved the math overlay into its own grid row.\n2. Reduced label sizes to 30px.\n\n```js\nrenderSection(plan[0], 0, 0);\n```" });
wc.send("ide:job", { projectId, type: "agent edit", state: "idle" });
await wait(600);
await shot("work-done.png");
await wc.executeJavaScript(`document.querySelector('.worked-head')?.click()`);
await wait(400);
await shot("work-expanded.png");
console.log("SHOTS", out);
app.exit(0);
}
