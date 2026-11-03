// Screenshots the first-run experience in a throwaway profile.
//   set MYLECTURE_PROFILE=<empty folder> && npx electron tests/scratch/first-run-shot.mjs <out-dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";

const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) || ".";
setTimeout(() => app.exit(2), 45000); // never hang
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 950);
  await wait(6000); // statuses load
  const shot = async (name) => { win.webContents.invalidate(); await wait(400); fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG()); };
  await shot("1-welcome.png");
  // Continue past the welcome, as a user would.
  const clicked = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector(".welcome-start"); if (!b || b.disabled) return "start disabled"; b.click(); return "clicked"; })()`);
  console.log("START", clicked);
  await wait(3000);
  console.log("OVERLAY", await win.webContents.executeJavaScript(`!!document.querySelector(".welcome-overlay")`));
  await shot("2-create.png");
  console.log("SHOTS", out);
  app.exit(0);
});
