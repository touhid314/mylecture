// A long popup menu opened from buttons at different heights stays inside
// the window (it scrolls instead of running off the top or bottom).
//   MYLECTURE_PROFILE=<dir> npx electron tests/scratch/menu-fit.mjs
import { app, BrowserWindow } from "electron";
import "../../electron/main.js";
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(4000);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1200, 700); win.showInactive();
  await wait(800);
  const r = await win.webContents.executeJavaScript(`(async () => {
    const { popMenu } = await import("./js/ui.js");
    const out = [];
    for (const y of [40, 250, 420, 560, 650]) {
      const b = document.createElement("button"); b.textContent = "x"; b.style.cssText = "position:fixed;left:300px;top:" + y + "px;height:30px"; document.body.append(b);
      const m = popMenu(b, [{ label: "Model" }, ...Array.from({ length: 30 }, (_, i) => ({ text: "Model " + i, run() {} })), "-", { text: "Refresh models", run() {} }]);
      const mr = m.getBoundingClientRect();
      out.push({ y, top: Math.round(mr.top), bottom: Math.round(mr.bottom), h: innerHeight, scrolls: m.scrollHeight > m.clientHeight });
      m.remove(); b.remove();
    }
    return out;
  })()`);
  console.log(JSON.stringify(r));
  app.exit(0);
});
