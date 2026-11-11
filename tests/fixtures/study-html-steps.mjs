// Runs the prompt's own bubble-sort HTML example on the real board and fires
// its cues the way speech does (the first before the frame has loaded, the
// rest back to back), then reads the bars inside the frame.
import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareHtml } from "../../electron/tutor/html.js";
import { TUTOR_SYSTEM } from "../../electron/tutor/prompt.js";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-steps-"));
const workspace = path.join(temp, "lesson");
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", path.join(temp, "profile"));
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => {
  fs.writeFileSync(report, JSON.stringify(result));
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  app.exit(result.error ? 1 : 0);
};

const line = TUTOR_SYSTEM.split("\n").find((l) => l.startsWith("html#bs: "));
const action = { type: "html", id: "bs", data: prepareHtml(JSON.parse(line.slice("html#bs: ".length)), { workspace, sessionId: "s" }) };

app.whenReady().then(async () => {
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/steps-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/study.css"><body></body>', { headers: { "content-type": "text/html" } });
    const file = url.pathname.match(/^\/tutor-file\/s\/(.+)$/);
    if (file) return net.fetch(pathToFileURL(path.join(workspace, decodeURIComponent(file[1]))).href);
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  const win = new BrowserWindow({ show: false, width: 960, height: 700, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, backgroundThrottling: false, offscreen: true } });
  try {
    await win.loadURL("mylecture://app/steps-check");
    const errors = [];
    win.webContents.on("console-message", (e) => { if (e.level === "error") errors.push(e.message); });
    // Drawn, and the first cue fires before the frame has loaded.
    await win.webContents.executeJavaScript(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      const board = new Board(); document.body.append(board.root); board.newPage('Sorting');
      window.board = board;
      board.draw(${JSON.stringify(action)});
      board.reveal('bs.c1');
    })()`);
    const frame = async () => {
      for (let i = 0; i < 100; i++) {
        const f = win.webContents.mainFrame.framesInSubtree.find((x) => x !== win.webContents.mainFrame && /tutor-file/.test(x.url));
        if (f && await f.executeJavaScript("document.readyState").catch(() => "") === "complete") return f;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("The visual's frame never loaded");
    };
    const f = await frame();
    // Bars in on-screen order (by their target slot).
    const bars = `[...document.querySelectorAll('#row > div')].sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left)).map((b) => b.textContent)`;
    const state = () => f.executeJavaScript(`({ bars: ${bars}, msg: document.getElementById('msg').textContent, api: typeof tutor.on })`);
    await new Promise((r) => setTimeout(r, 400));
    const start = await state();
    // One sentence: swap, compare, swap, back to back. The swap must slide
    // (the 5 is seen between slots 0 and 90 px), and the next cue waits for it.
    await win.webContents.executeJavaScript(`board.reveal('bs.s1'); board.reveal('bs.c2'); board.reveal('bs.s2');`);
    const slide = await f.executeJavaScript(`new Promise((ok) => { const t0 = performance.now(); const poll = () => { const five = [...document.querySelectorAll('#row > div')].find((b) => b.textContent === '5'); const x = parseFloat(getComputedStyle(five).left); if ((x > 5 && x < 85) || performance.now() - t0 > 2000) ok({ x, msg: document.getElementById('msg').textContent }); else requestAnimationFrame(poll); }; poll(); })`);
    await new Promise((r) => setTimeout(r, 1500));
    const end = await state();
    finish({ start, slide, end, errors });
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
