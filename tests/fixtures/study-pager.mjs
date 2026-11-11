// The Study home page's "Your lessons" list: 15 per page with a pager.
import { app, BrowserWindow, protocol, net, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = process.argv[2];
const shot = process.argv[3];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-pager-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", temp);
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => { fs.writeFileSync(report, JSON.stringify(result)); app.exit(result.error ? 1 : 0); };
let lessons = Array.from({ length: 42 }, (_, i) => ({ id: `l${i + 1}`, title: `Lesson ${i + 1}`, topic: "", updatedAt: Date.now() - i * 3600e3, seconds: 600, plan: ["A", "B"], section: 1, finished: i % 5 === 0 }));
app.whenReady().then(async () => {
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/pager-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/app.css"><link rel="stylesheet" href="mylecture://app/css/study.css"><body style="background:#121212;color:#eee"><div class="st-home"></div></body>', { headers: { "content-type": "text/html" } });
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  ipcMain.handle("study:list", () => lessons);
  ipcMain.handle("study:remove", (_, id) => { lessons = lessons.filter((l) => l.id !== id); return true; });
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, offscreen: true } });
  try {
    await win.loadURL("mylecture://app/pager-check");
    const run = (js) => win.webContents.executeJavaScript(js);
    const result = await run(`(async () => {
      const { StudyView } = await import('mylecture://app/js/study/tutor-view.js');
      const { h } = await import('mylecture://app/js/ui.js');
      // Only the list: the rest of the view isn't needed here.
      const view = Object.create(StudyView.prototype);
      view.recent = h('div', { class: 'st-recent' });
      view.open = (id) => { window.opened = id; };
      document.querySelector('.st-home').append(view.recent);
      const state = () => ({ cards: [...view.recent.querySelectorAll('.st-lesson-card b')].map((b) => b.textContent),
        pages: [...view.recent.querySelectorAll('.st-pager-pages > *')].map((e) => e.textContent),
        current: view.recent.querySelector('.st-pager-num.on')?.textContent, count: view.recent.querySelector('.st-pager-count')?.textContent,
        prevDisabled: view.recent.querySelector('[aria-label="Previous page"]')?.disabled, nextDisabled: view.recent.querySelector('[aria-label="Next page"]')?.disabled });
      const tick = () => new Promise((r) => setTimeout(r, 120));
      await view.refreshRecent();
      const first = state();
      view.recent.querySelector('[aria-label="Next page"]').click(); await tick();
      const second = state();
      view.recent.querySelector('[aria-label="Page 3"]').click(); await tick();
      const third = state();
      // Delete the only... the last lessons on page 3 until it's gone: back to page 2.
      for (const id of ['l31', 'l32', 'l33', 'l34', 'l35', 'l36', 'l37', 'l38', 'l39', 'l40', 'l41', 'l42']) await window.ml.study.remove(id);
      await view.refreshRecent();
      const afterDelete = state();
      return { first, second, third, afterDelete };
    })()`);
    if (shot) {
      await run(`(async () => { document.querySelector('[aria-label="Page 1"]')?.click(); })()`);
      await new Promise((r) => setTimeout(r, 300));
      fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    }
    finish(result);
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
