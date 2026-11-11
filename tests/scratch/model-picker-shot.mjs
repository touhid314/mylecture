// Shots of the provider / model / thinking picker on Create and Study, with a
// throwaway profile (no AI calls succeed).
//   MYLECTURE_PROFILE=<dir> npx electron tests/scratch/model-picker-shot.mjs --out=<dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) || ".";
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900); win.setFocusable(false); win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false); win.showInactive();
  win.webContents.on("console-message", (d) => { if (d.level === "error" || d.level === 3) console.log("CONSOLE", d.message.slice(0, 300)); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { win.webContents.invalidate(); await wait(300); fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG()); };
  await wait(2000);
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Skip for now")?.click()`);
  await wait(600);
  await js(`window.ml.settings.set({ engine: "api", api: { provider: "compatible", model: "claude-sonnet-5-5", baseUrl: "http://127.0.0.1:9" }, tutorEffort: "low" })`);
  const nav = (name) => js(`[...document.querySelectorAll("nav button, .nav button, [data-view]")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)}))?.click()`);
  await nav("Create"); await wait(1500);
  console.log("CREATE", await js(`[...document.querySelectorAll(".agent-toolbar > *")].map((e) => e.textContent.trim()).join(" | ")`));
  await shot("create.png");
  await nav("Study"); await wait(1500);
  console.log("STUDY", await js(`[...document.querySelectorAll(".st-ask-bar .st-pick")].map((e) => e.textContent.trim()).join(" | ")`));
  await shot("study.png");
  await js(`window.__mlStudy.picker.providerBtn.click()`); await wait(800);
  console.log("PROVIDER MENU", await js(`[...document.querySelectorAll(".menu")].pop()?.innerText.replace(/\\n+/g, " / ")`));
  await shot("study-provider-menu.png");
  await js(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.body.click()`); await wait(300);
  await js(`window.__mlStudy.picker.thinkingBtn.click()`); await wait(500);
  console.log("THINKING MENU", await js(`[...document.querySelectorAll(".menu")].pop()?.innerText.replace(/\\n+/g, " / ")`));
  app.exit(0);
});
