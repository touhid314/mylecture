import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-scroll-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
const katexDir = fileURLToPath(new URL("../../node_modules/katex/dist/", import.meta.url));
app.setPath("userData", dir);
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(async () => {
  protocol.handle("mylecture", req => {
    const url = new URL(req.url);
    if (url.pathname === "/scroll-check") return new Response('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/study.css"><link rel="stylesheet" href="/vendor/katex/katex.min.css"><script src="/vendor/katex/katex.min.js"></script><body style="margin:0;height:650px;display:flex"></body>', { headers: { "content-type": "text/html; charset=utf-8" } });
    const file = url.pathname.startsWith("/vendor/katex/") ? path.join(katexDir, url.pathname.slice("/vendor/katex/".length)) : path.join(appDir, url.pathname.slice(1));
    if (!fs.existsSync(file)) return new Response("Missing", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    await win.loadURL("mylecture://app/scroll-check");
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {Board}=await import('/js/study/board.js');
      const board=new Board(); document.body.append(board.root); board.setLocked(true); board.newPage('Start');
      const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const visible=el=>{const a=board.scroller.getBoundingClientRect(),b=el.getBoundingClientRect();return b.height>0 && b.top>=a.top-1 && b.bottom<=a.bottom+1;};
      const notes=async()=>{for(let i=0;i<24;i++)board.draw({type:'write',text:'Later explanation, step '+i},{animate:false});await frames();};
      board.draw({type:'write',id:'definition',text:'The earlier definition'},{animate:false});await notes();
      const initiallyOffscreen=!visible(board.items.get('definition'));
      board._scrollEnd(true); // A bottom-scroll already queued for the next frame.
      board.point('definition'); await frames();
      const pendingScrollCancelled=visible(board.items.get('definition'));
      board.setLocked(true); // Lookahead reasserts the live lock.
      await new Promise(resolve=>setTimeout(resolve,3500));
      const heldPastHighlight=visible(board.items.get('definition'));
      board.draw({type:'write',id:'latest',text:'Now explain this new step'},{animate:false});await frames();
      const nextContentVisible=visible(board.items.get('latest'));
      board.draw({type:'math',id:'eq',text:${JSON.stringify(String.raw`y = \htmlId{term}{x^2} + 1`)}},{animate:false});await notes();
      board.point('eq.term');await frames();
      const equationDocked=visible(board.items.get('eq')) && board.items.get('eq').classList.contains('wb-stuck');
      board.newPage('Further work');await notes();
      board.point('eq.term');await frames();
      const copy=board.items.get('eq');
      const earlierEquationCopied=board.pages[board.current].el.contains(copy) && visible(copy);
      const copyDetails={onPage:board.pages[board.current].el.contains(copy),top:copy.getBoundingClientRect().top,bottom:copy.getBoundingClientRect().bottom,viewport:board.scroller.getBoundingClientRect().bottom,stuck:copy.classList.contains('wb-stuck')};
      const edited=board.draw({type:'math',id:'eq.term',text:'2x'},{animate:false});
      const copiedEquationEditable=edited===copy && copy._mathSource.includes('{term}{2x}');
      board.newPage('Tall visual');
      board.draw({type:'svg',id:'tall',text:'<svg viewBox="0 0 500 1400"><rect id="top" x="40" y="30" width="150" height="50" fill="blue"/><rect x="40" y="1250" width="150" height="50" fill="red"/></svg>'},{animate:false});await notes();
      board.items.get('tall').querySelector('svg').style.cssText='height:1400px;max-height:none;width:500px';await frames();
      board.point('tall.top');await frames();
      const tallPartVisible=visible(board.items.get('tall').querySelector('#top')) && !board.stuck;
      board.point('definition');await frames();
      const earlierPageVisible=board.viewing===0 && visible(board.items.get('definition'));
      board.draw({type:'write',id:'next',text:'Continue with the current explanation'},{animate:false});await frames();
      const returnsForNewContent=board.viewing===board.current && visible(board.items.get('next'));
      board.setHold(true);board.follow=true;board.scroller.scrollTop=0;board._scrollEnd(true);board.setLocked(true);await frames();
      const replayNotMoved=board.scroller.scrollTop===0;
      return {initiallyOffscreen,pendingScrollCancelled,heldPastHighlight,nextContentVisible,equationDocked,earlierEquationCopied,copyDetails,copiedEquationEditable,tallPartVisible,earlierPageVisible,returnsForNewContent,replayNotMoved};
    })()`);
    fs.writeFileSync(report, JSON.stringify(result));
  } catch (error) { fs.writeFileSync(report, JSON.stringify({ error: String(error.stack || error) })); }
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  app.exit();
});
