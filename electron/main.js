import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu, nativeTheme } from "electron";
import { lecturegenCatalog } from "./lecturegen/run.js";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEngines, API_PROVIDERS } from "./engines/index.js";
import { createUsageService } from "./usage.js";
import { listRenderedVideos } from "./video-library.js";
import { TTSService, KOKORO_VOICES, OMNIVOICE_VOICES } from "./tts/index.js";
import { Generator, audioUrl, sceneUrl } from "./generator.js";
import { IdeService } from "./ide.js";
import { getSettings, saveSettings, getSecret, setSecret, hasSecret, lectures, sessions, paths, newId } from "./store.js";
import { exportMp4, exportStandaloneHtml, exportContractBundle, captions, safeName } from "./exporter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const APP_DIR = path.join(ROOT, "app");
const NM = path.join(ROOT, "node_modules");
const DEV = process.argv.includes("--dev");

app.setName("MyLecture");
if (process.platform === "win32") app.setAppUserModelId("ai.mylecture.app");
fixPathForGuiLaunch();

// Apps opened from Finder (or the Dock) do not inherit the shell's PATH, so
// agent CLIs installed with Homebrew, npm or the official installers would
// not be found. Take PATH from the user's login shell, plus the usual places.
function fixPathForGuiLaunch() {
  if (process.platform === "win32") return;
  const home = process.env.HOME || "";
  const parts = (process.env.PATH || "").split(":");
  try {
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    const out = execFileSync(shell, ["-ilc", 'printf "__ML_PATH__%s__ML_PATH__" "$PATH"'], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/__ML_PATH__(.*)__ML_PATH__/s);
    if (m) parts.unshift(...m[1].split(":"));
  } catch {}
  parts.push("/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/.npm-global/bin`, `${home}/.claude/local`, `${home}/.bun/bin`, "/usr/bin", "/bin");
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(":");
}

protocol.registerSchemesAsPrivileged([
  { scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let win = null;
let engines, tts, generator, ide;
const exportJobs = new Map();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// mylecture://app/... -> local files (app UI, vendor libs, cached audio).
function resolveAppUrl(u) {
  const url = new URL(u);
  let p = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const map = [
    ["vendor/katex/", path.join(NM, "katex", "dist")],
    ["vendor/hljs/", path.join(NM, "@highlightjs", "cdn-assets")],
    ["vendor/fonts/", path.join(NM, "@fontsource")],
    ["vendor/markdown-it/", path.join(NM, "markdown-it", "dist")],
    ["tts/", paths.tts],
    ["lib/", paths.library],
    ["exports/", paths.exports],
  ];
  for (const [prefix, dir] of map) {
    if (p.startsWith(prefix)) return safeJoin(dir, p.slice(prefix.length));
  }
  return safeJoin(APP_DIR, p);
}

function safeJoin(base, rel) {
  const full = path.normalize(path.join(base, rel));
  if (!full.startsWith(path.normalize(base))) return null;
  return full;
}

function createWindow() {
  const s = getSettings();
  nativeTheme.themeSource = s.uiTheme === "light" ? "light" : "dark";
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    title: "MyLecture",
    backgroundColor: "#0c0d11",
    icon: path.join(APP_DIR, "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  Menu.setApplicationMenu(null);
  win.loadURL("mylecture://app/index.html");
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("mylecture://")) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i"))) {
      win.webContents.toggleDevTools();
    }
    if (input.type === "keyDown" && input.key === "F11") win.setFullScreen(!win.isFullScreen());
  });
  if (DEV) win.webContents.openDevTools({ mode: "detach" });
}

function apiConfig() {
  const s = getSettings();
  return { provider: s.api.provider, model: s.api.model, baseUrl: s.api.baseUrl, apiKey: getSecret(`api:${s.api.provider}`) };
}

function hydrate(lec) {
  // Attach playable URLs for the renderer.
  if (!lec) return lec;
  for (const sc of lec.scenes || []) {
    if (sc.kind === "html" && sc.file) sc.src = sceneUrl(lec.id, sc.file);
    for (const b of sc.beats || []) b.url = audioUrl(b.audio);
  }
  return lec;
}

function registerIpc() {
  const readUsage = createUsageService(engines);
  ipcMain.handle("engines:usage", (_event, id) => readUsage(id || getSettings().engine));
  const h = (name, fn) => ipcMain.handle(name, async (_e, ...args) => fn(...args));

  h("app:info", () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath("userData"), exportsDir: paths.exports, dev: DEV, styles: lecturegenCatalog() }));

  // create tab (local IDE)
  h("ide:list", () => ide.list());
  h("ide:get", (id) => ide.get(id));
  h("ide:readFile", (id, name) => ide.readFile(id, name));
  h("ide:remove", (id) => ide.remove(id));
  h("ide:generate", (req) => ide.generate(req, generator));
  h("ide:chat", (req) => ide.chat(req, generator));
  h("ide:stop", () => ide.stop());
  h("ide:resolve", (id, o) => ide.resolve(id, o));
  h("ide:render", (id, o) => ide.render(id, o));
  h("ide:editNarration", (id, o) => ide.editNarration(id, o));
  h("ide:visualCandidates", (id, i) => ide.visualCandidates(id, i));
  h("ide:editVisualText", (id, o) => ide.editVisualText(id, o));
  h("ide:editScene", (id, o) => ide.editScene(id, o));

  // settings
  h("settings:get", () => ({ ...getSettings(), apiKeys: Object.fromEntries(Object.keys(API_PROVIDERS).map((p) => [p, hasSecret(`api:${p}`)])) }));
  h("settings:set", (patch) => {
    const s = saveSettings(patch);
    if (patch?.uiTheme) nativeTheme.themeSource = patch.uiTheme === "light" ? "light" : "dark";
    if (patch?.voiceEngine === "kokoro") tts.startKokoro();
    if (patch?.omnivoicePython !== undefined) tts.omni.stop();
    if (s.voiceEngine === "omnivoice" && (patch?.voiceEngine || patch?.omnivoicePython !== undefined)) tts.omni.start().catch(() => {});
    return s;
  });
  h("secret:set", (name, value) => {
    setSecret(name, value);
    return true;
  });

  // engines
  h("engines:list", async () => {
    const out = [];
    for (const e of engines.list) out.push({ id: e.id, name: e.name, kind: e.kind, defaultModel: e.defaultModel || "", installHint: e.installHint || "" });
    return { engines: out, apiProviders: API_PROVIDERS };
  });
  h("engines:status", async (id) => {
    try {
      return await engines.get(id).status();
    } catch (e) {
      return { installed: false, ready: false, message: String(e.message || e) };
    }
  });
  const modelRequests = new Map();
  h("engines:models", async (id) => {
    const s = getSettings();
    const key = id === "api" ? JSON.stringify([id, s.api.provider, s.api.baseUrl]) : id;
    if (modelRequests.has(key)) return modelRequests.get(key);
    const selected = engines.get(id);
    const engine = selected.snapshot?.() || selected;
    const request = engine.models().finally(() => modelRequests.delete(key));
    modelRequests.set(key, request);
    return request;
  });
  h("engines:test", async (id) => {
    const eng = engines.get(id);
    const t0 = Date.now();
    let text = "";
    let first = 0;
    const s = getSettings();
    const model = id === "api" ? s.api.model : s.models?.[id] || eng.defaultModel;
    await eng.generate({
      system: "You are a connectivity check. Reply with exactly: MYLECTURE-OK",
      user: "Reply now.",
      model,
      effort: "low",
      onDelta: (d) => {
        if (!first) first = Date.now() - t0;
        text += d;
      },
    });
    return { ok: /MYLECTURE-OK/i.test(text), text: text.slice(0, 200), firstTokenMs: first, totalMs: Date.now() - t0 };
  });

  // voice
  h("tts:status", () => tts.status());
  h("tts:voices", () => ({ kokoro: KOKORO_VOICES, omnivoice: OMNIVOICE_VOICES, system: tts.sapi.voices }));
  h("tts:preview", async (text, opts) => {
    const r = await tts.synth(text || "Hi! I'm your MyLecture tutor. Ask me anything.", opts || {});
    return { url: audioUrl(r.key), dur: r.dur };
  });
  h("tts:synth", async (text) => {
    const r = await tts.synth(text);
    return { key: r.key, url: audioUrl(r.key), dur: r.dur };
  });
  h("tts:retry", () => {
    if (getSettings().voiceEngine === "omnivoice") { tts.omni.stop(); tts.omni.start().catch(() => {}); }
    else tts.retryKokoro();
  });

  // generation
  h("gen:start", (req) => generator.start(req));
  h("gen:cancel", (jobId) => generator.cancel(jobId));
  h("gen:editScene", (req) => generator.editScene(req).then((sc) => hydrate({ scenes: [sc] }).scenes[0]));

  // library
  h("lectures:list", () => lectures.list());
  h("videos:list", () => listRenderedVideos(paths.exports));
  h("lectures:get", (id) => hydrate(lectures.get(id)));
  h("lectures:save", async (lec) => {
    const clean = JSON.parse(JSON.stringify(lec));
    for (const sc of clean.scenes || []) for (const b of sc.beats || []) delete b.url;
    // Fill in audio for edited narration.
    await generator.ensureAudio(clean);
    lectures.save(clean);
    return hydrate(clean);
  });
  h("lectures:create", (init) => {
    const s = getSettings();
    const lec = {
      id: newId("lec-"),
      format: "stream-1",
      title: init?.title || "Untitled video",
      question: init?.title || "",
      aspect: init?.aspect || s.aspect,
      theme: init?.theme || s.theme,
      source: "ide",
      status: "ready",
      createdAt: new Date().toISOString(),
      scenes: init?.scenes || [
        {
          id: "sc1",
          title: "Title",
          beats: [{ text: "Welcome to this video." }],
          html: `<style>.s .big{color:var(--yellow)}</style>\n<div class="s ml-fill">\n  <div class="ml-title big" id="t">Your title here</div>\n  <div class="ml-body" id="sub">A subtitle that appears on beat 1</div>\n</div>`,
          js: `const t = ML.$('#t'), sub = ML.$('#sub');\nfunction render(s) {\n  ML.show(t, s.at(0, 0, 0.8), { y: 40 });\n  ML.show(sub, s.at(0, 0.6, 0.8));\n}`,
        },
      ],
    };
    lectures.save(lec);
    return lec;
  });
  h("lectures:duplicate", (id) => {
    const l = lectures.get(id);
    if (!l) return null;
    l.id = newId("lec-");
    l.title = (l.title || "Untitled") + " (copy)";
    l.source = "ide";
    l.createdAt = new Date().toISOString();
    lectures.save(l);
    return l;
  });
  h("lectures:remove", (id) => lectures.remove(id));

  // sessions
  h("sessions:list", () => sessions.list());
  h("sessions:get", (id) => sessions.get(id));
  h("sessions:new", () => ({ id: newId("ses-") }));
  h("sessions:remove", (id) => sessions.remove(id));
  h("sessions:rename", (id, title) => {
    const s = sessions.get(id);
    if (s) {
      s.title = title;
      sessions.save(s);
    }
    return s;
  });

  // export
  h("export:start", async ({ lectureId, kind, fps, captions: cap, height }) => {
    const jobId = newId("exp-");
    const ac = new AbortController();
    exportJobs.set(jobId, ac);
    (async () => {
      const progress = (p) => send("export:progress", { jobId, lectureId, kind, ...p });
      try {
        let lec = lectures.get(lectureId);
        progress({ phase: "audio", progress: 0 });
        await generator.ensureAudio(lec, (p) => progress({ phase: "audio", progress: p }));
        lectures.save(lec);
        const ttsFile = (k) => tts.fileFor(k);
        const outDir = paths.exports;
        let out;
        if (kind === "mp4") out = await exportMp4(lec, { ttsFile, outDir, fps: fps || 30, captionsOn: !!cap, height, onProgress: progress, signal: ac.signal });
        else if (kind === "html") out = await exportStandaloneHtml(lec, { ttsFile, outDir, appDir: APP_DIR });
        else if (kind === "contract") out = exportContractBundle(lec, { ttsFile, outDir, appDir: APP_DIR });
        else if (kind === "srt" || kind === "vtt") {
          fs.mkdirSync(outDir, { recursive: true });
          out = path.join(outDir, safeName(lec.title) + "." + kind);
          fs.writeFileSync(out, captions(lec, kind));
        }
        send("export:progress", { jobId, lectureId, kind, phase: "done", progress: 1, file: out });
      } catch (e) {
        send("export:progress", { jobId, lectureId, kind, phase: "error", message: String(e.message || e) });
      } finally {
        exportJobs.delete(jobId);
      }
    })();
    return { jobId };
  });
  h("export:cancel", (jobId) => exportJobs.get(jobId)?.abort());

  // shell helpers
  h("shell:showItem", (p) => shell.showItemInFolder(p));
  h("shell:openPath", (p) => shell.openPath(p));
  h("shell:openExternal", (url) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : null));
  h("shell:openExports", () => {
    fs.mkdirSync(paths.exports, { recursive: true });
    return shell.openPath(paths.exports);
  });
  h("dialog:importHtml", async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: "HTML", extensions: ["html", "htm"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], "utf8") };
  });
}

app.whenReady().then(() => {
  protocol.handle("mylecture", async (req) => {
    const file = resolveAppUrl(req.url);
    if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    // The stage runs in an opaque-origin sandbox; fonts need CORS headers.
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "no-cache");
    return new Response(res.body, { status: res.status, headers });
  });

  engines = createEngines(apiConfig);
  tts = new TTSService({ cacheDir: paths.tts, modelDir: paths.models, getSettings });
  tts.on("status", (st) => send("tts:status", st));
  generator = new Generator({
    engines,
    tts,
    send: (ch, p) => {
      send(ch, p);
      if (ch === "gen:event" && p?.type === "done") ide?.generationFinished(p.lectureId);
    },
  });
  ide = new IdeService({ engines, tts, send });
  registerIpc();
  createWindow();

  // Warm up voices in the background so the first answer speaks immediately.
  tts.sapi.start().catch(() => {});
  if (!process.argv.includes("--smoke-test")) {
    if (getSettings().voiceEngine === "kokoro") tts.startKokoro();
    if (getSettings().voiceEngine === "omnivoice") tts.omni.start().catch(() => {});
  }

  if (process.argv.includes("--smoke-test")) runSmokeTest();
});

app.on("window-all-closed", () => {
  tts?.stop();
  app.quit();
});

// --smoke-test: the packaged app starts, the UI boots into Create, then quits.
// CI reads the result from MYLECTURE_SMOKE_OUT (GUI apps have no console on Windows).
function runSmokeTest() {
  const report = (ok, detail) => {
    const line = `${ok ? "SMOKE_TEST_OK" : "SMOKE_TEST_FAILED"} ${detail}`;
    console.log(line);
    if (process.env.MYLECTURE_SMOKE_OUT) {
      try {
        fs.writeFileSync(process.env.MYLECTURE_SMOKE_OUT, line + "\n", "utf8");
      } catch {}
    }
    tts?.stop();
    app.exit(ok ? 0 : 1);
  };
  const timer = setTimeout(() => report(false, "timed out"), process.env.MYLECTURE_SMOKE_DEEP ? 900000 : 60000);
  const check = async () => {
    try {
      const r = await win.webContents.executeJavaScript(`({ view: document.querySelector(".view.active")?.id || "", tabs: [...document.querySelectorAll(".rail-btn[data-view]")].map(b => b.dataset.view).join(",") })`);
      if (r.view === "view-create") {
        const deep = process.env.MYLECTURE_SMOKE_DEEP ? await deepSmoke() : "";
        clearTimeout(timer);
        report(true, `${process.platform}-${process.arch} ${app.getVersion()} tabs=${r.tabs}${deep}`);
      } else setTimeout(check, 500);
    } catch (e) {
      if (e?.smoke) return report(false, e.message);
      setTimeout(check, 500);
    }
  };
  win.webContents.once("did-finish-load", () => setTimeout(check, 500));
}

// MYLECTURE_SMOKE_DEEP=1: also exercise what packaging can break — the
// Kokoro voice (transformers + onnxruntime), ffmpeg, and the scene checker.
async function deepSmoke() {
  const fail = (what, e) => Object.assign(new Error(`${what}: ${e?.message || e}`), { smoke: true });
  const parts = [];
  try {
    tts.startKokoro();
    const r = await tts.synth("MyLecture is ready.", { engine: "kokoro" });
    if (!(r?.dur > 0)) throw new Error("no audio");
    parts.push(`kokoro=${r.dur.toFixed(2)}s`);
  } catch (e) {
    throw fail("kokoro", e);
  }
  try {
    const { ffmpegPath } = await import("./exporter.js");
    const out = execFileSync(ffmpegPath(), ["-hide_banner", "-version"], { encoding: "utf8", timeout: 20000 });
    parts.push(`ffmpeg=${out.split(" ")[2] || "ok"}`);
  } catch (e) {
    throw fail("ffmpeg", e);
  }
  try {
    const { lecturegen } = await import("./lecturegen/run.js");
    const lg = await lecturegen();
    const dir = fs.mkdtempSync(path.join(app.getPath("temp"), "ml-smoke-"));
    fs.writeFileSync(path.join(dir, "index1.html"), `<!doctype html><html><head><style>body{margin:0;width:1920px;height:1080px;overflow:hidden}</style></head><body><h1 id="t">Hi</h1><script>
window.__VIDEO_METADATA__={contractVersion:"0.2",title:"Smoke",aspectRatio:"16:9"};
const VIDEO_PLAN=[{id:"i1",kind:"narration+visual",audio:"audio/i1.wav",text:"Hello."}];window.__VIDEO_PLAN__=VIDEO_PLAN;
function renderSection(s,l,g){document.getElementById("t").style.opacity=String(Math.min(1,l));}
window.__RENDER_SECTION__=renderSection;renderSection(VIDEO_PLAN[0],0,0);
</script></body></html>`);
    const browser = await lg.chromium.launch();
    try {
      const v = await lg.validateHtmlInBrowser("index1.html", dir, browser, { width: 1920, height: 1080 });
      if (!String(v).includes("validation passed")) throw new Error(v);
    } finally {
      await browser.close();
    }
    parts.push("validator=ok");
  } catch (e) {
    throw fail("validator", e);
  }
  return " " + parts.join(" ");
}
