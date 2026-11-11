import { app, BrowserWindow, protocol, net, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareHtml } from "../../electron/tutor/html.js";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-picture-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", temp);
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => {
  fs.writeFileSync(report, JSON.stringify(result));
  app.exit(result.error ? 1 : 0);
};
app.whenReady().then(async () => {
  const visual = prepareHtml({ html: `<body><button id="detail">0</button><script>
    const b=document.getElementById('detail');b.onclick=()=>b.textContent=String(Number(b.textContent)+1);b.click();
    let blocked=false;try{parent.document.body}catch{blocked=true}
    parent.postMessage({test:'html-state',count:b.textContent,ipc:typeof window.ml,blocked},'*');
    addEventListener('message',e=>{if(e.data?.type==='tutor:point')setTimeout(()=>parent.postMessage({test:'html-point',animated:b.getAnimations().length>0},'*'),20)});
  </script></body>` }, { workspace: temp, sessionId: "picture-check" });
  const updatedVisual = prepareHtml({ html: `<body><script>parent.postMessage({test:'html-updated'},'*')</script>Updated visual</body>` }, { workspace: temp, sessionId: "picture-check" });
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/picture-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/study.css"><body></body>', { headers: { "content-type": "text/html" } });
    if (url.pathname.startsWith("/tutor-file/picture-check/")) return net.fetch(pathToFileURL(path.join(temp, path.basename(url.pathname))).href);
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  let saves = 0, downloads = 0;
  ipcMain.handle("study:save", (_, session) => { saves++; return { id: session.id, board: session.board }; });
  ipcMain.handle("study:image", () => {
    downloads++;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="lightblue"/></svg>';
    return { url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, credit: "Test diagram" };
  });
  const win = new BrowserWindow({ show: false, width: 960, height: 700, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true } });
  try {
    await win.loadURL("mylecture://app/picture-check");
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      const {pictureRequest,sessionSnapshot} = await import('mylecture://app/js/study/pictures.js');
      const board = new Board(); document.body.append(board.root);
      const action = {type:'image',id:'photo',data:{query:'test diagram'}};
      pictureRequest(action); board.draw(action, {animate:false});
      const image = document.querySelector('.wb-img');
      await new Promise((resolve,reject) => { image.addEventListener('load',resolve); image.addEventListener('error',reject); if(image.complete && image.naturalWidth) resolve(); });
      const annotation = {type:'annotate',data:{target:'photo',marks:[
        {type:'circle',id:'detail',x:50,y:40,w:20,h:30},
        {type:'arrow',id:'arrow',x:10,y:10,x2:40,y2:40},
        {type:'label',id:'label',x:15,y:20,text:'A detail'}]}};
      board.draw(annotation);
      await new Promise(r => setTimeout(r, 700)); // the marks finish popping in
      const stage = document.querySelector('.wb-picture-stage');
      const ratio = () => { const a=stage.getBoundingClientRect(), b=stage.querySelector('[data-id=detail]').getBoundingClientRect();return {x:(b.x+b.width/2-a.x)/a.width,y:(b.y+b.height/2-a.y)/a.height}; };
      const before = ratio(); image.style.width='300px'; await new Promise(r => requestAnimationFrame(r)); const after=ratio();
      const pointed = board.point('photo.detail');
      const labels = stage.querySelectorAll('.wb-picture-label').length;
      const session={id:'picture-check',board:[action,annotation],history:[]};
      // Real contextBridge + Electron IPC serialization, including the old runtime field.
      const saved=await window.ml.study.save(sessionSnapshot({...session,board:[{...action,_image:Promise.resolve(null)},annotation]}));
      board.clear(); for(const a of saved.board) board.draw(a,{animate:false});
      const restored=!!document.querySelector('[data-id=detail]');
      board.draw({type:'annotate',data:{target:'photo',clear:true,marks:[{id:'new',type:'rect',x:10,y:10,w:25,h:30}]}});
      const cleared=!document.querySelector('[data-id=detail]'),rect=!!document.querySelector('rect[data-id=new]');
      board.draw({type:'annotate',id:'a2',data:{target:'photo',marks:[{id:'spot',type:'focus',x:50,y:50,w:30,h:30},{id:'arrow2',type:'arrow',x:5,y:5,x2:45,y2:45}]}});
      const q=(s)=>document.querySelector('.wb-picture-stage '+s);
      const teaching={focus:!!q('path.wb-pmark-focus[data-id=spot]'),oldDimmed:q('rect[data-id=new]').classList.contains('wb-pmark-old'),drawsOn:q('g[data-id=arrow2]').classList.contains('wb-pmark-draw'),focusNotDimmed:!q('.wb-pmark-focus').classList.contains('wb-pmark-old')};
      board.draw({type:'annotate',data:{target:'photo',marks:[{id:'spot2',type:'focus',shape:'rect',x:10,y:10,w:20,h:20}]}});
      teaching.oneSpotlight=document.querySelectorAll('.wb-pmark-focus').length===1;
      board.point('photo.new'); teaching.pointedBack=!q('rect[data-id=new]').classList.contains('wb-pmark-old');
      board.draw({type:'annotate',data:{target:'photo',unfocus:true}}); teaching.unfocused=!q('.wb-pmark-focus');
      const messages=[];addEventListener('message',e=>{if(e.data?.test)messages.push(e.data)});
      const waitFor=async(type)=>{for(let i=0;i<100;i++){const m=messages.find(m=>m.test===type);if(m)return m;await new Promise(r=>setTimeout(r,20))}throw new Error('No frame message: '+type)};
      board.draw({type:'html',id:'demo',data:${JSON.stringify(visual)}});
      const htmlState=await waitFor('html-state');
      const htmlPointed=board.point('demo.detail');await waitFor('html-point');
      board.draw({type:'html',id:'demo',data:${JSON.stringify(updatedVisual)}});await waitFor('html-updated');
      return {teaching,before,after,pointed,labels,restored,cleared,rect,imageWidth:image.naturalWidth,htmlState,htmlPointed,htmlAnimated:messages.find(m=>m.test==='html-point').animated,frames:document.querySelectorAll('iframe.wb-html-frame').length};
    })()`);
    finish({ ...result, saves, downloads });
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
