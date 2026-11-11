// Runs the prompt's own hands-on activity (swap numbers into order) on the
// real board: clicks inside the frame, presses Check, and reads what the
// board passes on as the student's answer.
import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareHtml } from "../../electron/tutor/html.js";
import { TUTOR_SYSTEM } from "../../electron/tutor/prompt.js";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-activity-"));
const workspace = path.join(temp, "lesson");
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", path.join(temp, "profile"));
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => {
  fs.writeFileSync(report, JSON.stringify(result));
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  app.exit(result.error ? 1 : 0);
};

const line = TUTOR_SYSTEM.split("\n").map((l) => l.trim()).find((l) => l.startsWith("html#sw: "));
const action = { type: "html", id: "sw", data: prepareHtml(JSON.parse(line.slice("html#sw: ".length)), { workspace, sessionId: "s" }) };

app.whenReady().then(async () => {
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/activity-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/study.css"><body></body>', { headers: { "content-type": "text/html" } });
    const file = url.pathname.match(/^\/tutor-file\/s\/(.+)$/);
    if (file) return net.fetch(pathToFileURL(path.join(workspace, decodeURIComponent(file[1]))).href);
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  const win = new BrowserWindow({ show: false, width: 960, height: 700, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, backgroundThrottling: false, offscreen: true } });
  try {
    await win.loadURL("mylecture://app/activity-check");
    await win.webContents.executeJavaScript(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      window.answers = [];
      const board = new Board({ onAnswer: (r) => window.answers.push(r) }); document.body.append(board.root); board.newPage('Sorting');
      board.draw(${JSON.stringify(action)});
    })()`);
    let f = null;
    for (let i = 0; i < 100 && !f; i++) {
      const x = win.webContents.mainFrame.framesInSubtree.find((y) => y !== win.webContents.mainFrame && /tutor-file/.test(y.url));
      if (x && await x.executeJavaScript("document.readyState").catch(() => "") === "complete") f = x;
      else await new Promise((r) => setTimeout(r, 50));
    }
    if (!f) throw new Error("The activity's frame never loaded");
    const click = (label) => f.executeJavaScript(`[...document.querySelectorAll('#r button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    const check = () => f.executeJavaScript(`document.getElementById('ok').click()`);
    const read = () => win.webContents.executeJavaScript(`({ answers: window.answers, status: document.querySelector('.wb-html-status').textContent, kicker: document.querySelector('.wb-activity .wb-card-kicker')?.textContent || '' })`);
    // A wrong try first: one swap, then Check.
    await click("5"); await click("2");
    await check();
    await new Promise((r) => setTimeout(r, 300));
    const wrong = await read();
    // Then sorted (after the once-a-second limit): 2↔1, 5↔2, 8↔5.
    await new Promise((r) => setTimeout(r, 1000));
    await click("2"); await click("1");
    await click("5"); await click("2");
    await click("8"); await click("5");
    await check();
    await new Promise((r) => setTimeout(r, 300));
    const right = await read();
    finish({ wrong, right, order: await f.executeJavaScript(`[...document.querySelectorAll('#r button')].map((b) => b.textContent).join(',')`) });
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
