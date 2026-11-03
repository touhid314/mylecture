// Renders one sample scene in every theme (landscape + one portrait) and saves screenshots.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import { themeIds } from "../../electron/styles.js";

app.on("before-quit", (e) => e.preventDefault());
let started = false;
app.on("browser-window-created", (_e, mainWin) => {
  if (started) return;
  started = true;
  mainWin.webContents.once("did-finish-load", async () => {
    try {
      const scene = {
        title: "Test",
        beats: [{ text: "A fraction is part of a whole.", dur: 2 }, { text: "Cut a pizza into 8 slices.", dur: 2 }],
        html: `<style>.s .eq{font-size:var(--fs-body)} .s svg{width:900px;height:260px}</style>
<div class="s ml-fill"><div class="ml-title">What is a fraction?</div><div class="ml-h2 ml-accent">Part of a whole</div>
<div class="ml-row"><div class="ml-card ml-body">numerator <span style="color:var(--blue)">3</span></div><div class="eq" data-tex="\\frac{3}{8}" data-display></div></div>
<svg viewBox="0 0 900 260"><circle cx="130" cy="130" r="110" fill="none" stroke="var(--fg)" stroke-width="3"/><path d="M300 200 Q 500 20 860 120" fill="none" stroke="var(--blue)" stroke-width="4"/></svg>
<div class="ml-label">labels and notes</div></div>`,
        js: "function render(s){}",
      };
      fs.mkdirSync("tests/scratch/themes", { recursive: true });
      const out = [];
      const runs = [...themeIds.map((t) => [t, "16:9"]), ["reel", "9:16"]];
      for (const [theme, aspect] of runs) {
        const [W, H] = aspect === "9:16" ? [540, 960] : [960, 540];
        const w = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true } });
        await w.loadURL("mylecture://app/stage/stage.html?export=1");
        await w.webContents.executeJavaScript(`window.__ML.load(${JSON.stringify({ aspect, theme, scenes: [scene] })}, {captions:true}); window.__ML.fonts()`);
        await w.webContents.executeJavaScript(`window.__ML.seek(1.5)`);
        await new Promise((r) => setTimeout(r, 400));
        const info = await w.webContents.executeJavaScript(`(()=>{const st=document.getElementById('stage');const t=document.querySelector('.ml-title');return {cls:st.className,font:getComputedStyle(t).fontFamily.split(',')[0],size:getComputedStyle(t).fontSize,bg:getComputedStyle(st).backgroundColor,loaded:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family).filter((v,i,a)=>a.indexOf(v)===i)}})()`);
        out.push({ theme, aspect, ...info });
        fs.writeFileSync(`tests/scratch/themes/${theme}-${aspect.replace(":", "x")}.png`, (await w.webContents.capturePage()).toPNG());
        w.destroy();
      }
      console.log("THEMES_OK", JSON.stringify(out, null, 1));
      app.exit(0);
    } catch (e) {
      console.error(e);
      app.exit(1);
    }
  });
});
await import("../../electron/main.js");
