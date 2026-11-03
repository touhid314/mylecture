import { app, BrowserWindow } from "electron";
import fs from "node:fs";
app.on("before-quit", (e) => e.preventDefault());
let started = false;
app.on("browser-window-created", (_e, mw) => {
  if (started) return; started = true;
  mw.webContents.once("did-finish-load", async () => {
    try {
      const out = JSON.parse(fs.readFileSync("tests/scratch/last-gen.json", "utf8"));
      const scenes = out.scenes.map((s) => ({ ...s, beats: s.beats.map((b) => ({ ...b, dur: b.text.split(/\s+/).length / 2.6 })) }));
      const w = new BrowserWindow({ show: false, width: 960, height: 540, useContentSize: true, webPreferences: { sandbox: true } });
      await w.loadURL("mylecture://app/stage/stage.html?export=1");
      const total = await w.webContents.executeJavaScript(`window.__ML.load(${JSON.stringify({ aspect: "16:9", theme: process.env.ML_THEME || "3b1b", scenes })}, {captions:true})`);
      await w.webContents.executeJavaScript("window.__ML.fonts()");
      let acc = 0; const times = [];
      for (const s of scenes) { const d = s.beats.reduce((a, b) => a + b.dur, 0); times.push(acc + d * 0.9); acc += d; }
      for (const [i, t] of times.entries()) {
        await w.webContents.executeJavaScript(`window.__ML.seek(${t})`);
        await new Promise((r) => setTimeout(r, 250));
        fs.writeFileSync(`tests/scratch/themes/gen-scene${i}.png`, (await w.webContents.capturePage()).toPNG());
      }
      const errs = await w.webContents.executeJavaScript(`document.getElementById('err-badge')?.textContent || ''`);
      console.log("RENDER_OK", total, times.length, "errors:", errs); app.exit(0);
    } catch (e) { console.error(e); app.exit(1); }
  });
});
await import("../../electron/main.js");
