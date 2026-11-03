// Drives "Use with API key" like a user, in a throwaway profile:
// welcome -> "Use an API key instead" -> LiteLLM -> key + address -> Check ->
// Save and use -> Create shows the API provider; then the provider menu.
//   MYLECTURE_PROFILE=<empty> UI_KEY=... UI_BASE=... SHOTS=<dir> npx electron tests/scratch/api-key-ui.mjs
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";

setTimeout(() => app.exit(2), 90000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 950);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    win.webContents.invalidate();
    await wait(400);
    fs.writeFileSync(path.join(process.env.SHOTS, name), (await win.webContents.capturePage()).toPNG());
  };
  const until = async (expr, ms = 30000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(300)) if (await js(expr)) return true;
    return false;
  };
  await until(`!!document.querySelector(".welcome-overlay")`);
  await js(`[...document.querySelectorAll(".welcome-foot button")].find(b => b.textContent === "Use an API key instead").click()`);
  await until(`!!document.querySelector(".apikey")`);
  console.log("PROVIDERS", JSON.stringify(await js(`[...document.querySelectorAll(".apikey-provider b")].map(b => b.textContent)`)));
  await js(`[...document.querySelectorAll(".apikey-provider")].find(b => b.querySelector("b").textContent === "LiteLLM").click()`);
  const setValue = (sel, v) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event("input")); })()`);
  await setValue(`.apikey input[type=password]`, process.env.UI_KEY);
  await setValue(`.apikey-field:not([hidden]) input:not([type=password])`, process.env.UI_BASE);
  console.log("SAVE BEFORE CHECK disabled:", await js(`[...document.querySelectorAll(".modal-foot .btn")].find(b => b.textContent === "Save and use").disabled`));
  await js(`[...document.querySelectorAll(".apikey-check button")][0].click()`);
  await until(`/Works|failed|not accepted/.test(document.querySelector(".apikey-result")?.textContent || "")`, 45000);
  console.log("CHECK", JSON.stringify(await js(`document.querySelector(".apikey-result").textContent`)));
  await shot("api-1-dialog.png");
  await js(`[...document.querySelectorAll(".modal-foot .btn")].find(b => b.textContent === "Save and use").click()`);
  await wait(2500);
  console.log("AFTER SAVE", JSON.stringify(await js(`({ dialog: !!document.querySelector(".apikey"), welcome: !!document.querySelector(".welcome-overlay"), agent: document.querySelector(".agent-name")?.textContent })`)));
  await wait(6000);
  console.log("MODEL", JSON.stringify(await js(`document.querySelector(".agent-model-name")?.textContent`)));
  await js(`document.querySelector(".agent-provider").click()`);
  await wait(800);
  console.log("MENU", JSON.stringify(await js(`[...document.querySelectorAll(".pop-menu *, .popmenu *, .menu *")].filter(e => !e.children.length).map(e => e.textContent.trim()).filter(Boolean)`)));
  await shot("api-2-menu.png");
  app.exit(0);
});
