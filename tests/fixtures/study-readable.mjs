// Readable visuals on the blackboard: text recoloured when it would vanish
// into the shape behind it, and LaTeX rendered inside svg diagrams, scenes
// and HTML visuals.
import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareHtml } from "../../electron/tutor/html.js";

const report = process.argv[2];
const shot = process.argv[3];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-readable-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
const katexDir = fileURLToPath(new URL("../../node_modules/katex/dist/", import.meta.url));
// Same malformed raw-SVG encoding as the integration-by-parts lesson:
// escaped quotes, missing namespace, and double-escaped LaTeX commands.
const escapedSvg = String.raw`<svg viewBox=\"0 0 500 220\"><rect x=\"40\" y=\"30\" width=\"180\" height=\"150\" fill=\"#dbeafe\"/><text id=\"factor\" x=\"130\" y=\"80\" text-anchor=\"middle\" font-size=\"22\">$u(x)$</text><text id=\"derivative\" x=\"130\" y=\"130\" text-anchor=\"middle\" font-size=\"22\">$\\frac{du}{dx}$</text></svg>`;
app.setPath("userData", temp);
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => { fs.writeFileSync(report, JSON.stringify(result)); app.exit(result.error ? 1 : 0); };
app.whenReady().then(async () => {
  const visual = prepareHtml({ html: `<body style="background:#fff;color:#111"><p id="a">Inline $x^2 + y^2 = z^2$ and \\(\\frac{a}{b}\\)</p><p id="money">Costs $5 and $10</p><div id="later"></div><script>
    setTimeout(()=>{document.getElementById('later').textContent='Added later: $\\\\sqrt{d}$';},50);
    setTimeout(()=>parent.postMessage({test:'math',katex:document.querySelectorAll('.katex').length,money:document.getElementById('money').textContent,later:!!document.querySelector('#later .katex'),hasKatex:typeof window.katex},'*'),900);
  </script></body>` }, { workspace: temp, sessionId: "readable" });
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/readable") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/vendor/katex/katex.min.css"><link rel="stylesheet" href="mylecture://app/css/study.css"><script src="mylecture://app/vendor/katex/katex.min.js"></script><body style="margin:0;height:900px"><div class="st-call blackboard" style="display:flex;height:900px"></div></body>', { headers: { "content-type": "text/html" } });
    if (url.pathname.startsWith("/vendor/katex/")) return net.fetch(pathToFileURL(path.join(katexDir, url.pathname.slice("/vendor/katex/".length))).href);
    if (url.pathname.startsWith("/tutor-file/readable/")) return net.fetch(pathToFileURL(path.join(temp, path.basename(url.pathname))).href);
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, offscreen: true } });
  try {
    await win.loadURL("mylecture://app/readable");
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      const board = new Board(); document.querySelector('.st-call').append(board.root); board.newPage('What standard attention does');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const messages = []; addEventListener('message', (e) => { if (e.data?.test) messages.push(e.data); });
      // The scene from the user's screenshot: pale boxes, uncoloured text, on the blackboard.
      board.draw({ type: 'scene', id: 'mem', data: { w: 600, h: 260, items: [
        { type: 'rect', x: 40, y: 40, w: 220, h: 180, fill: '#f8e1e1', r: 14 },
        { type: 'text', id: 'qkv', x: 150, y: 70, text: 'Q, K, V', size: 20 },
        { type: 'rect', x: 70, y: 110, w: 160, h: 90, fill: '#e8a8a8', r: 8 },
        { type: 'text', id: 'nn', x: 150, y: 155, text: 'N × N scores', size: 18, color: '#ffffff' },
        { type: 'text', id: 'hbm', x: 150, y: 25, text: 'HBM', size: 20 },
        { type: 'rect', x: 340, y: 60, w: 220, h: 120, fill: '#e3f9e8', r: 14 },
        { type: 'text', id: 'sram', x: 450, y: 120, text: 'SRAM + cores', size: 18 } ] } });
      // An svg diagram: white text on a white box, dark text on a dark box, LaTeX on a light box.
      board.draw({ type: 'svg', id: 'cmp', text: '<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="30" width="250" height="150" rx="12" fill="#ffffff"/><text id="t1" x="145" y="70" text-anchor="middle" font-size="20" fill="#ffffff">Standard attention</text><text id="eq" x="145" y="120" text-anchor="middle" font-size="18">$\\\\mathrm{softmax}(QK^\\\\top/\\\\sqrt{d})\\\\,V$</text><rect x="330" y="30" width="250" height="150" rx="12" fill="#0b1f12"/><text id="t2" x="455" y="100" text-anchor="middle" font-size="20" fill="#111111">Flash attention</text><text id="cost" x="455" y="140" text-anchor="middle" font-size="16">Costs $5 and $10</text><text id="free" x="300" y="210" text-anchor="middle" font-size="16" fill="#ffffff">on the board</text></svg>' });
      board.draw({ type: 'html', id: 'h', data: ${JSON.stringify(visual)} });
      board.draw({ type: 'svg', id: 'uv', text: ${JSON.stringify(escapedSvg)} });
      const {StudyView, Lesson} = await import('mylecture://app/js/study/tutor-view.js');
      const caption = document.createElement('div'); document.body.append(caption);
      StudyView.prototype.setCaption.call({caption}, 'Use $u$ times $v$.');
      let preparedText = '';
      const lesson = new Lesson({voice:{prepare(text){preparedText=text;return Promise.resolve({});}}}, {history:[],board:[]});
      lesson._run = () => {};
      lesson._receive({turnId:'math'}, {type:'say',text:${JSON.stringify(String.raw`Use $\frac{du}{dx}$ then {look:prod} $u$ times $v$.`)}});
      const spoken = lesson.queue[0].action;
      await wait(1500);
      const fillOf = (sel) => { const t = document.querySelector(sel); return t && getComputedStyle(t).fill; };
      const scene = document.querySelector('svg.wb-scene');
      const sceneText = (id) => getComputedStyle(scene.querySelector('[data-id="' + id + '"] text')).fill;
      const svg = document.querySelector('svg.wb-svg');
      const uv = board.items.get('uv')?.querySelector('svg');
      return {
        repairedSvg: uv instanceof SVGSVGElement && uv.querySelector('rect').getBBox().width === 180,
        repairedMath: uv?.querySelectorAll('.katex').length === 2 && !uv.querySelector('.katex-error'),
        captionMath: caption.querySelectorAll('.katex').length === 2 && !caption.textContent.includes('$'),
        spokenText: preparedText, cuePosition: spoken.cues[0].pos,
        qkv: sceneText('qkv'), nn: sceneText('nn'), sram: sceneText('sram'), hbm: sceneText('hbm'),
        t1: getComputedStyle(svg.querySelector('#t1')).fill, t2: getComputedStyle(svg.querySelector('#t2')).fill,
        free: getComputedStyle(svg.querySelector('#free')).fill, filtered: getComputedStyle(svg).filter !== 'none',
        eqKatex: !!svg.querySelector('#eq .katex'), eqColor: getComputedStyle(svg.querySelector('#eq .wb-svg-math > div')).color,
        moneyPlain: !svg.querySelector('#cost .katex') && svg.querySelector('#cost')?.textContent === 'Costs $5 and $10',
        html: messages.find((m) => m.test === 'math') || null,
      };
    })()`);
    if (shot) fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    finish(result);
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
