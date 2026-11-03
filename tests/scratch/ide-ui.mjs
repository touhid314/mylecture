// Create tab smoke test: open a LectureGen project, resolve it with the app's
// voice, play into a few scenes and capture screenshots of the IDE.
import { app } from "electron";
import fs from "node:fs";

app.on("before-quit", (e) => e.preventDefault());
let started = false;
app.on("browser-window-created", (_e, win) => {
  if (started) return;
  started = true;
  win.webContents.on("console-message", (_ev, level, message) => {
    if (level >= 2) console.log("RENDERER", message.slice(0, 300));
  });
  win.webContents.once("did-finish-load", async () => {
    try {
      win.setSize(1600, 950);
      const r = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="create"]').click();
        await sleep(500);
        const t0 = Date.now();
        await window.ml.ide.resolve("ide-corpus-test", {});
        const resolveMs = Date.now() - t0;
        document.querySelector('.ide-proj') || null;
        const view = document.getElementById('view-create');
        // open the project through the UI
        await sleep(300);
        [...view.querySelectorAll('.ide-proj')].find((e) => e.textContent.includes('Circuit'))?.click();
        await sleep(2500);
        const scenes = view.querySelectorAll('.ide-scene').length;
        const files = view.querySelectorAll('.ide-file').length;
        // jump to scene 3 and let it play a bit
        view.querySelectorAll('.ide-scene')[2]?.click();
        await sleep(1500);
        return { resolveMs, scenes, files, title: view.querySelector('.ide-folder-title').textContent };
      })()`);
      console.log("IDE_UI", JSON.stringify(r));
      await new Promise((res) => setTimeout(res, 2500));
      fs.writeFileSync("tests/scratch/ide-scene3.png", (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.getElementById('view-create').querySelectorAll('.ide-scene')[6]?.click()`);
      await new Promise((res) => setTimeout(res, 3500));
      fs.writeFileSync("tests/scratch/ide-scene7.png", (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`[...document.querySelectorAll('#view-create .ide-file')].find(e=>e.textContent.includes('script.md'))?.click()`);
      await new Promise((res) => setTimeout(res, 1200));
      fs.writeFileSync("tests/scratch/ide-script.png", (await win.webContents.capturePage()).toPNG());
      app.exit(0);
    } catch (e) {
      console.error("FAIL", e);
      app.exit(1);
    }
  });
});
await import("../../electron/main.js");
