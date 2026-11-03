// Walks the first-run experience in a throwaway profile and screenshots it:
// 1) welcome as it opens, 2) after connecting Claude, 3) Create after "Start creating".
//   set MYLECTURE_PROFILE=<empty folder> && npx electron tests/scratch/first-run-shot.mjs --out=<dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";

const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) || ".";
setTimeout(() => app.exit(2), 75000); // never hang
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 950);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    win.webContents.invalidate();
    await wait(400);
    fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
  };
  const cards = `[...document.querySelectorAll(".welcome-overlay .connect-card")].map(c => c.querySelector("b").textContent + ": " + c.querySelector(".connect-chip").textContent + " [" + [...c.querySelectorAll(".connect-actions > *")].map(b => b.textContent).join(", ") + "]")`;
  await wait(6000);
  console.log("OPEN", JSON.stringify(await js(`({ cards: ${cards}, startDisabled: document.querySelector(".welcome-start")?.disabled })`)));
  await shot("1-welcome.png");
  await js(`[...document.querySelectorAll(".welcome-overlay .connect-card")].find(c => c.querySelector("b").textContent === "Claude").querySelector("button.primary").click()`);
  await wait(4000);
  console.log("CONNECTED", JSON.stringify(await js(`({ cards: ${cards}, startDisabled: document.querySelector(".welcome-start")?.disabled })`)));
  await shot("2-connected.png");
  await js(`document.querySelector(".welcome-start")?.click()`);
  await wait(8000); // models load
  console.log("CREATE", JSON.stringify(await js(`({ overlay: !!document.querySelector(".welcome-overlay"), agent: document.querySelector(".agent-name")?.textContent, model: document.querySelector(".agent-model-name")?.textContent })`)));
  await shot("3-create.png");
  app.exit(0);
});
