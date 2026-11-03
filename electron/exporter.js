// Exports: MP4 (deterministic frame capture -> ffmpeg), captions (SRT/VTT),
// a self-contained interactive HTML file, and a MyLecture HTML contract v0.2
// bundle compatible with mylecture-local-ide's resolver/renderer.
import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { wavInfo, pcmToWav } from "./tts/index.js";
import "../app/shared/timeline.js";

const TL = globalThis.MLTimeline;
const require = createRequire(import.meta.url);
const SR = 24000;
const SIZES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };

export function ffmpegPath() {
  let p = require("ffmpeg-static");
  if (p && p.includes("app.asar")) p = p.replace("app.asar", "app.asar.unpacked");
  return p;
}

export function safeName(s) {
  return (
    String(s || "lecture")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "lecture"
  );
}

function uniquePath(dir, base, ext) {
  fs.mkdirSync(dir, { recursive: true });
  let p = path.join(dir, base + ext);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

// Mix every beat's wav onto one 24 kHz mono track positioned by the timeline.
export function buildAudioTrack(lec, ttsFile) {
  const tl = TL.build(lec.scenes);
  const total = Math.ceil((tl.total + 0.2) * SR);
  const mix = new Int16Array(total);
  lec.scenes.forEach((sc, si) => {
    sc.beats.forEach((b, bi) => {
      if (!b.audio) return;
      const f = ttsFile(b.audio);
      if (!fs.existsSync(f)) return;
      const buf = fs.readFileSync(f);
      const info = wavInfo(buf);
      if (!info || info.bits !== 16) return;
      const start = Math.round((tl.scenes[si].start + tl.scenes[si].beats[bi].start) * SR);
      const n = info.dataBytes / 2 / info.channels;
      const ratio = info.sampleRate / SR;
      // Duration budget in the timeline for this beat (never overlap the next).
      const maxN = Math.round(tl.scenes[si].beats[bi].dur * SR) + Math.round(0.25 * SR);
      for (let i = 0; i < Math.min(maxN, Math.floor(n / ratio)); i++) {
        const src = Math.floor(i * ratio) * info.channels;
        const v = buf.readInt16LE(info.dataOffset + src * 2);
        const j = start + i;
        if (j < total) mix[j] = Math.max(-32768, Math.min(32767, mix[j] + v));
      }
    });
  });
  return { wav: pcmToWav(mix, SR), duration: tl.total };
}

function fmtTime(t, sep) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000),
    m = Math.floor((ms % 3600000) / 60000),
    s = Math.floor((ms % 60000) / 1000),
    r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

export function captions(lec, kind = "srt") {
  const tl = TL.build(lec.scenes);
  const cues = [];
  lec.scenes.forEach((sc, si) =>
    sc.beats.forEach((b, bi) => {
      const st = tl.scenes[si].start + tl.scenes[si].beats[bi].start;
      cues.push({ st, en: st + tl.scenes[si].beats[bi].dur, text: b.text });
    }),
  );
  if (kind === "vtt") return "WEBVTT\n\n" + cues.map((c) => `${fmtTime(c.st, ".")} --> ${fmtTime(c.en, ".")}\n${c.text}\n`).join("\n");
  return cues.map((c, i) => `${i + 1}\n${fmtTime(c.st, ",")} --> ${fmtTime(c.en, ",")}\n${c.text}\n`).join("\n");
}

// ---------- MP4 ----------
export async function exportMp4(lec, { ttsFile, outDir, fps = 30, captionsOn = false, height, onProgress, signal }) {
  const [W, H] = SIZES[lec.aspect] || SIZES["16:9"];
  // Optional downscale for faster export (e.g. 720p).
  const scale = height && height < Math.min(W, H) ? height / Math.min(W, H) : 1;
  const OW = Math.round((W * scale) / 2) * 2,
    OH = Math.round((H * scale) / 2) * 2;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-export-"));
  const { wav, duration } = buildAudioTrack(lec, ttsFile);
  const audioFile = path.join(tmp, "audio.wav");
  fs.writeFileSync(audioFile, wav);
  const out = uniquePath(outDir, safeName(lec.title), ".mp4");
  const pendingOut = out + ".rendering";

  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true },
  });
  win.webContents.setFrameRate(60);
  let ff, ffDone;
  try {
    await win.loadURL("mylecture://app/stage/stage.html?export=1");
    await win.webContents.executeJavaScript(`window.__ML.load(${JSON.stringify({ aspect: lec.aspect, theme: lec.theme, scenes: lec.scenes })}, {captions: ${!!captionsOn}}); window.__ML.fonts && window.__ML.fonts()`);
    const frames = Math.ceil(duration * fps);
    ff = spawn(
      ffmpegPath(),
      [
        "-y",
        "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${OW}x${OH}`, "-r", String(fps), "-i", "-",
        "-i", audioFile,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
        "-f", "mp4", pendingOut,
      ],
      { windowsHide: true },
    );
    let ffErr = "";
    ff.stderr.on("data", (d) => (ffErr = (ffErr + d).slice(-4000)));
    ff.stdin.on("error", () => {}); // individual writes report pipe errors
    ffDone = new Promise((resolve, reject) => { ff.on("close", resolve); ff.on("error", reject); });
    ffDone.catch(() => {});
    const write = (buf) =>
      new Promise((resolve, reject) => {
        if (ff.stdin.destroyed) return reject(new Error("ffmpeg stopped: " + ffErr.slice(-500)));
        ff.stdin.write(buf, (e) => (e ? reject(e) : resolve()));
      });
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new Error("Export cancelled");
      const t = i / fps;
      await win.webContents.executeJavaScript(`window.__ML.seek(${t}).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);
      let img = await win.webContents.capturePage();
      const sz = img.getSize();
      if (sz.width !== OW || sz.height !== OH) img = img.resize({ width: OW, height: OH, quality: "good" });
      await write(img.toBitmap());
      if (i % 10 === 0) {
        const el = (Date.now() - started) / 1000;
        onProgress?.({ phase: "frames", progress: i / frames, eta: i ? (el / i) * (frames - i) : 0 });
      }
    }
    ff.stdin.end();
    const code = await ffDone;
    if (code !== 0) throw new Error("ffmpeg failed: " + ffErr.slice(-800));
    fs.renameSync(pendingOut, out);
    onProgress?.({ phase: "done", progress: 1 });
    return out;
  } catch (e) {
    if (ff && ff.exitCode === null) {
      ff.kill();
      await ffDone?.catch(() => {});
    }
    try {
      fs.rmSync(pendingOut, { force: true });
    } catch {}
    throw e;
  } finally {
    win.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- standalone interactive HTML (one file, shareable) ----------
export async function exportStandaloneHtml(lec, { ttsFile, outDir, appDir }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-html-"));
  try {
    const { wav } = buildAudioTrack(lec, ttsFile);
    const wf = path.join(tmp, "a.wav");
    const of = path.join(tmp, "a.mp3");
    fs.writeFileSync(wf, wav);
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath(), ["-y", "-i", wf, "-c:a", "libmp3lame", "-b:a", "64k", of], { windowsHide: true });
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("audio encode failed"))));
    });
    const audio = "data:audio/mpeg;base64," + fs.readFileSync(of).toString("base64");
    const read = (p) => fs.readFileSync(path.join(appDir, p), "utf8");
    const data = JSON.stringify({ title: lec.title, aspect: lec.aspect, theme: lec.theme, scenes: lec.scenes.map((s) => ({ title: s.title, beats: s.beats.map((b) => ({ text: b.text, dur: b.dur })), html: s.html, js: s.js })) }).replace(/</g, "\\u003c");
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(lec.title)} — MyLecture</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=JetBrains+Mono:wght@400;700&family=Lato:ital,wght@0,400;0,700;1,400&family=Playfair+Display:wght@400;700&family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/styles/atom-one-dark.min.css" id="hljs-theme">
<script src="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/highlight.min.js"></script>
<style>${read("stage/stage.css")}
#viewport{bottom:56px}
#bar{position:fixed;left:0;right:0;bottom:0;height:56px;display:flex;align-items:center;gap:14px;padding:0 16px;background:#111318;color:#ddd;font:14px Segoe UI,Arial,sans-serif}
#bar button{background:#2a2e38;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:14px}
#bar input{flex:1;accent-color:#58c4dd}
#bar a{color:#58c4dd;text-decoration:none;font-size:12px}
</style></head><body>
<div id="viewport"><div id="stage" class="theme-dark"><div id="scene-root"></div><div id="fallback"></div><div id="caption"><span></span></div></div></div>
<div id="bar"><button id="pp">▶ Play</button><span id="tm">0:00</span><input id="sk" type="range" min="0" max="1000" value="0"><button id="cc">CC</button><a href="https://github.com/" target="_blank">Made with MyLecture</a></div>
<audio id="au" src="${audio}" preload="auto"></audio>
<script>${read("shared/timeline.js").replace(/<\/script/gi, "<\\/script")}</script>
<script>${read("stage/runtime.js").replace(/<\/script/gi, "<\\/script")}</script>
<script>
const L=${data};const total=__ML.load(L,{captions:true});const au=document.getElementById('au');
const pp=document.getElementById('pp'),sk=document.getElementById('sk'),tm=document.getElementById('tm');let cc=true;
const f=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
pp.onclick=()=>au.paused?au.play():au.pause();au.onplay=()=>pp.textContent='❚❚ Pause';au.onpause=()=>pp.textContent='▶ Play';
sk.oninput=()=>{au.currentTime=sk.value/1000*total;__ML.seek(au.currentTime)};
document.getElementById('cc').onclick=()=>{cc=!cc;document.getElementById('caption').classList.toggle('on',cc)};
document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();pp.onclick()}});
(function loop(){const t=au.currentTime;__ML.seek(t);sk.value=Math.round(t/total*1000);tm.textContent=f(t)+' / '+f(total);requestAnimationFrame(loop)})();
</script></body></html>`;
    const out = uniquePath(outDir, safeName(lec.title), ".html");
    fs.writeFileSync(out, html);
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- MyLecture HTML contract v0.2 bundle ----------
export function exportContractBundle(lec, { ttsFile, outDir, appDir }) {
  const dir = uniquePath(outDir, safeName(lec.title) + " (contract)", "");
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  const plan = [];
  lec.scenes.forEach((sc, si) =>
    sc.beats.forEach((b, bi) => {
      const id = `s${si + 1}b${bi + 1}`;
      if (b.audio && fs.existsSync(ttsFile(b.audio))) fs.copyFileSync(ttsFile(b.audio), path.join(dir, "audio", id + ".wav"));
      plan.push({ id, kind: "narration+visual", audio: `audio/${id}.wav`, text: b.text, _scene: si, _beat: bi });
    }),
  );
  const read = (p) => fs.readFileSync(path.join(appDir, p), "utf8");
  const [W, H] = SIZES[lec.aspect] || SIZES["16:9"];
  const data = JSON.stringify({ aspect: lec.aspect, theme: lec.theme, scenes: lec.scenes.map((s) => ({ title: s.title, beats: s.beats.map((b) => ({ text: b.text, dur: b.dur })), html: s.html, js: s.js })) }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(lec.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=JetBrains+Mono:wght@400;700&family=Lato:ital,wght@0,400;0,700;1,400&family=Playfair+Display:wght@400;700&family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/styles/atom-one-dark.min.css" id="hljs-theme">
<script src="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/highlight.min.js"></script>
<style>${read("stage/stage.css")} html,body{width:${W}px;height:${H}px}</style></head><body>
<div id="viewport"><div id="stage" class="theme-dark"><div id="scene-root"></div><div id="fallback"></div><div id="caption"><span></span></div></div></div>
<script>${read("shared/timeline.js")}</script>
<script>${read("stage/runtime.js")}</script>
<script>
const LEC=${data};
window.__ML.load(LEC,{captions:false});
const _TL=MLTimeline.build(LEC.scenes);
window.__VIDEO_METADATA__={contractVersion:"0.2",title:${JSON.stringify(lec.title || "MyLecture")},aspectRatio:${JSON.stringify(lec.aspect || "16:9")}};
const VIDEO_PLAN=${JSON.stringify(plan.map(({ _scene, _beat, ...p }) => p))};
const _MAP=${JSON.stringify(plan.map((p) => [p._scene, p._beat]))};
window.__VIDEO_PLAN__=VIDEO_PLAN;
function renderSection(segment, localTime, globalTime){
  const i=VIDEO_PLAN.findIndex(p=>p.id===segment.id); if(i<0) return;
  const [si,bi]=_MAP[i]; const sc=_TL.scenes[si];
  window.__ML.seek(sc.start+sc.beats[bi].start+Math.max(0,localTime));
}
window.__RENDER_SECTION__=renderSection;
</script></body></html>`;
  fs.writeFileSync(path.join(dir, "index.html"), html);
  fs.writeFileSync(path.join(dir, "captions.srt"), captions(lec, "srt"));
  return dir;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
