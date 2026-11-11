// The visual the tutor refers to stays in view while later notes push the
// board down: same page (docked) and earlier page (copied next to the notes).
import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-dock-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", temp);
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => { fs.writeFileSync(report, JSON.stringify(result)); app.exit(result.error ? 1 : 0); };
app.whenReady().then(async () => {
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/dock-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/study.css"><body style="margin:0;height:700px;display:flex"></body>', { headers: { "content-type": "text/html" } });
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, backgroundThrottling: false } });
  try {
    await win.loadURL("mylecture://app/dock-check");
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      const {pictureRequest} = await import('mylecture://app/js/study/pictures.js');
      const board = new Board(); document.body.append(board.root); board.setLocked(true);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="lightblue"/></svg>';
      const src = 'data:image/svg+xml;base64,' + btoa(svg);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const visible = (el) => { const a = board.scroller.getBoundingClientRect(), b = el.getBoundingClientRect(); return b.top >= a.top - 1 && b.bottom <= a.bottom + 1 && b.height > 20; };
      const notes = async (n, tag) => { for (let i = 0; i < n; i++) board.draw({ type: 'write', text: tag + ' note ' + i + ' with enough words to take a line' }); await frame(); await wait(50); };
      board.newPage('Cells');
      const photo = { type: 'image', id: 'photo', data: { query: 'cell', source: { url: src, credit: 'test' } } };
      pictureRequest(photo); board.draw(photo);
      await wait(300);
      await notes(14, "a"); await wait(1200);
      const out = { offBefore: !visible(board.items.get('photo')), dims: [board.scroller.clientHeight, board.scroller.scrollHeight, board.scroller.scrollTop, Math.round(board.items.get('photo').getBoundingClientRect().top), Math.round(board.items.get('photo').getBoundingClientRect().height)] };
      board.draw({ type: 'annotate', data: { target: 'photo', marks: [{ id: 'm', type: 'circle', x: 50, y: 50, w: 20, h: 20 }] } });
      await frame(); await wait(400);
      out.annotateVisible = visible(board.items.get('photo'));
      await notes(3, 'b');
      out.stillVisibleAfterNotes = visible(board.items.get('photo'));
      out.latestVisible = visible([...document.querySelectorAll('.wb-item')].at(-1));
      board.point('photo.m'); await frame(); await wait(3500);
      out.pointVisibleAfterSnap = visible(board.items.get('photo'));
      board.draw({ type: 'svg', id: 'fig', text: '<svg viewBox="0 0 100 50"><rect width="100" height="50" fill="pink"/></svg>' });
      await frame();
      out.releasedByNewVisual = !board.items.get('photo').classList.contains('wb-stuck');
      board.newPage('Energy');
      await notes(16, 'c');
      board.point('photo.m'); await frame(); await wait(400);
      const copy = board.items.get('photo');
      out.copyOnLivePage = board.pages[board.current].el.contains(copy);
      out.copyVisible = visible(copy);
      return out;
    })()`);
    finish(result);
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
