// Pointing at a whole visual while naming one of its parts highlights that
// part, not the whole block: svg diagrams (ids and labels), equations
// (\htmlId) and HTML visuals (found inside the frame).
import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareHtml } from "../../electron/tutor/html.js";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-point-"));
const workspace = path.join(temp, "lesson");
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", path.join(temp, "profile"));
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => {
  fs.writeFileSync(report, JSON.stringify(result));
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  app.exit(result.error ? 1 : 0);
};

const svg = `<svg viewBox="0 0 400 220"><path id="left-ventricle" d="M60 60 L160 60 L160 180 L60 180 Z" fill="#fca5a5"/><path id="aorta" d="M220 40 L260 40 L260 120 L220 120 Z" fill="#93c5fd"/><rect id="ra" x="290" y="60" width="80" height="80" fill="#bbf7d0"/><text x="330" y="160">Right atrium</text></svg>`;
const html = prepareHtml({ height: 220, html: "<html><body style='margin:0;font:18px system-ui'><div id='row' style='display:flex;gap:20px;padding:30px'><div id='pivot' style='padding:10px;background:#fde68a'>Pivot</div><div style='padding:10px;background:#bfdbfe'>Sorted part</div><div style='padding:10px'>Unsorted</div></div></body></html>" }, { workspace, sessionId: "s" });

app.whenReady().then(async () => {
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/point-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/study.css"><link rel="stylesheet" href="mylecture://app/vendor/katex/katex.min.css"><script src="mylecture://app/vendor/katex/katex.min.js"></script><body></body>', { headers: { "content-type": "text/html" } });
    const file = url.pathname.match(/^\/tutor-file\/s\/(.+)$/);
    if (file) return net.fetch(pathToFileURL(path.join(workspace, decodeURIComponent(file[1]))).href);
    if (url.pathname.startsWith("/vendor/katex/")) return net.fetch(pathToFileURL(path.join(appDir, "..", "node_modules", "katex", "dist", url.pathname.slice("/vendor/katex/".length))).href);
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  const win = new BrowserWindow({ show: false, width: 960, height: 900, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, backgroundThrottling: false, offscreen: true } });
  try {
    await win.loadURL("mylecture://app/point-check");
    const parts = await win.webContents.executeJavaScript(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      const board = new Board(); document.body.append(board.root); board.newPage('Heart');
      window.board = board;
      board.draw({ type: 'svg', id: 'fig', text: ${JSON.stringify(svg)} }, { animate: false });
      board.draw({ type: 'math', id: 'eq', text: '\\\\frac{\\\\htmlId{numerator}{f(x+h) - f(x)}}{\\\\htmlId{step}{h}}' }, { animate: false });
      board.draw({ type: 'html', id: 'demo', data: ${JSON.stringify(html)} }, { animate: false });
      await new Promise((r) => setTimeout(r, 300));
      const name = (t) => !t ? 'none' : t.el === board.items.get(t.el.dataset?.ref) ? 'whole' : (t.el.id || t.el.textContent.trim());
      return {
        spoken: name(board._resolve('fig', 'the left ventricle pumps it out')),
        loose: name(board._resolve('fig.ventricle', '')),
        label: name(board._resolve('fig', 'and the right atrium up here')),
        whole: name(board._resolve('fig', 'so this whole thing is the heart')),
        term: name(board._resolve('eq', 'the numerator here is the rise')),
      };
    })()`);
    // The HTML visual: wait for its frame, then point at it by words.
    let frame = null;
    for (let i = 0; i < 100 && !frame; i++) {
      const f = win.webContents.mainFrame.framesInSubtree.find((x) => x !== win.webContents.mainFrame && /tutor-file/.test(x.url));
      if (f && await f.executeJavaScript("document.readyState").catch(() => "") === "complete") frame = f;
      else await new Promise((r) => setTimeout(r, 50));
    }
    if (!frame) throw new Error("The visual's frame never loaded");
    const lit = () => frame.executeJavaScript(`document.getAnimations().map((a) => a.effect.target.textContent.trim()).filter(Boolean)`);
    const boxes = () => win.webContents.executeJavaScript(`document.querySelectorAll('.wb-mark:not(.out)').length`);
    await win.webContents.executeJavaScript(`board.point('demo', 'and this sorted part grows')`);
    await new Promise((r) => setTimeout(r, 600));
    const named = { lit: await lit(), boxes: await boxes() };
    await new Promise((r) => setTimeout(r, 3400));
    await win.webContents.executeJavaScript(`board.point('demo', 'so overall it works like this')`);
    await new Promise((r) => setTimeout(r, 600));
    const unnamed = { lit: await lit(), boxes: await boxes() };
    finish({ parts, named, unnamed });
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
