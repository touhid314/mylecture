// Drives a live Study lesson in the real app and screenshots it.
//   npx electron tests/scratch/study-live.mjs --out=<dir> --topic="..." [--answer] [--ask="..."]
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const out = arg("out", ".");
const topic = arg("topic", "How does backpropagation work?");
const total = Number(arg("seconds", "150"));
setTimeout(() => app.exit(2), (total + 60) * 1000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 940);
  // Never take keyboard focus from the person using the computer.
  win.setFocusable(false);
  win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false); win.showInactive(); // tests stay silent
  win.blur();
  const js = (code) => win.webContents.executeJavaScript(code);
  win.webContents.on("console-message", (d) => { if (/^BOARD/.test(d.message)) console.log(d.message.slice(0, 400)); if (d.level === "error" || d.level === "warning") console.log("CONSOLE", d.level, d.message.slice(0, 300)); });
  let n = 0;
  const shot = async (name) => {
    win.webContents.invalidate();
    await wait(300);
    fs.writeFileSync(path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  await wait(3000);
  await shot("home");
  const t0 = Date.now();
  await js(`document.querySelector(".st-topic").value = ${JSON.stringify(topic)}; document.querySelector(".st-start").click()`);
  const probe = `(() => ({ marks: document.querySelectorAll(".wb-mark").length, scenes: document.querySelectorAll(".wb-scene").length, images: document.querySelectorAll(".wb-image").length, status: document.querySelector(".st-tile-state")?.textContent, caption: document.querySelector(".st-caption")?.hidden ? "" : document.querySelector(".st-caption")?.textContent, items: document.querySelectorAll(".wb-item").length, agenda: [...document.querySelectorAll(".st-agenda li")].map(l => l.className + ":" + l.textContent).join(" | "), cards: document.querySelectorAll(".wb-card:not(.answered)").length }))()`;
  let firstCaption = 0, answered = 0, asked = false;
  for (let s = 0; s < total; s += 2) {
    await wait(2000);
    const p = await js(probe);
    if (p.caption && !firstCaption) { firstCaption = Date.now() - t0; console.log("FIRST CAPTION ms", firstCaption, p.caption); }
    if (s % 10 === 0) console.log(Math.round((Date.now() - t0) / 1000) + "s", JSON.stringify(p));
    if (s === 8 || s === 40 || s % 30 === 0) await shot(`t${s}`);
    if (p.marks && !globalThis.__markShots) { globalThis.__markShots = 1; await shot("pointing"); }
    if (process.argv.includes("--answer") && p.cards && p.status === "Waiting for you") {
      // Answer the open question: pick the first option / type something.
      const r = await js(`(() => { const c = document.querySelector(".wb-card:not(.answered)"); if (!c) return "none";
        const o = c.querySelector(".wb-option:not(:disabled)"); if (o) { o.click(); return "mcq:" + o.textContent; }
        const i = c.querySelector(".wb-input"); if (i) { i.value = "I think it is 2"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return "input"; }
        const b = c.querySelector(".btn.primary"); if (b) { b.click(); return "btn"; } return "?"; })()`);
      console.log("ANSWERED", r);
      await shot(`answered${++answered}`);
    }
    const rw = Number(arg("rewindAt", "-1"));
    if (rw >= 0 && s === rw) {
      await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))`);
      await wait(600);
      await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))`);
      await wait(1500);
      console.log("REWIND", JSON.stringify(await js(`({ badge: document.querySelector(".st-live").textContent, state: document.querySelector(".st-tile-state").textContent, caption: document.querySelector(".st-caption").textContent })`)));
      await shot("rewind");
    }
    if (rw >= 0 && s === rw + 16) console.log("AFTER REWIND", JSON.stringify(await js(`({ badge: document.querySelector(".st-live").textContent, state: document.querySelector(".st-tile-state").textContent })`)));
    const ask = arg("ask", "");
    if (ask && !asked && s >= Number(arg("askAt", "30"))) {
      asked = true;
      console.log("ASKING", ask);
      await js(`(() => { const i = document.querySelector(".st-input"); i.value = ${JSON.stringify(ask)}; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
      await shot("asked");
    }
  }
  await shot("final");
  const transcript = await js(`[...document.querySelectorAll(".st-line")].map(l => l.textContent).join(String.fromCharCode(10))`);
  fs.writeFileSync(path.join(out, "transcript.txt"), transcript);
  await js(`document.querySelector(".st-ctl.end").click()`);
  await wait(1500);
  await shot("home-after");
  app.exit(0);
});
