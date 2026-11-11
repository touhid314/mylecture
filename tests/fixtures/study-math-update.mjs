import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-equation-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
const katexDir = fileURLToPath(new URL("../../node_modules/katex/dist/", import.meta.url));
app.setPath("userData", dir);
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(async () => {
  protocol.handle("mylecture", req => {
    const url = new URL(req.url);
    if (url.pathname === "/math-check") return new Response('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/study.css"><link rel="stylesheet" href="/vendor/katex/katex.min.css"><script src="/vendor/katex/katex.min.js"></script><body></body>', { headers: { "content-type": "text/html; charset=utf-8" } });
    const file = url.pathname.startsWith("/vendor/katex/") ? path.join(katexDir, url.pathname.slice("/vendor/katex/".length)) : path.join(appDir, url.pathname.slice(1));
    if (!fs.existsSync(file)) return new Response("Missing", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    await win.loadURL("mylecture://app/math-check");
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {Board}=await import('/js/study/board.js');
      const {Lesson}=await import('/js/study/tutor-view.js');
      const board=new Board();document.body.append(board.root);board.newPage('Integration by parts');
      const initial={type:'math',id:'parts',text:${JSON.stringify(String.raw`I = \htmlId{uv}{uv} - \htmlId{remaining}{\int v\,du}`)}};
      const equation=board.draw(initial,{animate:false});
      const lesson=new Lesson({board,voice:{prepare(){return Promise.resolve({});}}},{board:[initial],history:[]});
      lesson._run=()=>{};lesson._saveSoon=()=>{};lesson._sleep=()=>Promise.resolve();
      const first={type:'math',id:'parts.uv',text:'x e^x'};
      const second={type:'math',id:'parts.uv',text:'2 e^2'};
      const lineA={type:'say',text:'Now {show:parts.uv} substitute x times e to the x.'};
      const lineB={type:'say',text:'Then {show:parts.uv} evaluate at two.'};
      const seg={turnId:'one'};
      lesson._receive(seg,first);lesson._receive(seg,lineA);lesson._receive(seg,second);lesson._receive(seg,lineB);
      const before=equation._mathSource;
      lesson._marks(lineA.cues,lineA.spoken,{dur:2},lesson.epoch)[0].run();
      const firstChange=before.includes('{uv}{uv}') && equation._mathSource.includes('{uv}{x e^x}') && equation._mathSource.includes('{remaining}');
      lesson._hold('parts.uv');
      lesson._marks(lineB.cues,lineB.spoken,{dur:2},lesson.epoch)[0].run();
      const secondChange=equation._mathSource.includes('{uv}{2 e^2}');
      const sameEquation=board.items.get('parts')===equation && board.root.querySelectorAll('.wb-math').length===1;
      const missingIgnored=board.draw({type:'math',id:'parts.missing',text:'5'})===null && board.root.querySelectorAll('.wb-math').length===1;
      board.draw({type:'math',id:'parts',text:'I = e^x(x-1) + C'},{animate:false});
      const wholeChange=board.items.get('parts')===equation && equation._mathSource==='I = e^x(x-1) + C' && board.root.querySelectorAll('.wb-math').length===1;
      const restoredBoard=new Board();document.body.append(restoredBoard.root);restoredBoard.newPage('Restored');
      for(const action of lesson.s.board)restoredBoard.draw(action,{animate:false});
      const restored=restoredBoard.root.querySelectorAll('.wb-math').length===1 && restoredBoard.items.get('parts')._mathSource.includes('{uv}{2 e^2}');
      board.newPage('New page');
      const pageScoped=board.draw({type:'math',id:'parts.uv',text:'7'})===null && equation._mathSource==='I = e^x(x-1) + C';
      return {sameEquation,firstChange,secondChange,wholeChange,restored,pageScoped,missingIgnored,noKatexErrors:!document.querySelector('.katex-error')};
    })()`);
    fs.writeFileSync(report, JSON.stringify(result));
  } catch (error) { fs.writeFileSync(report, JSON.stringify({ error: String(error.stack || error) })); }
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  app.exit();
});
