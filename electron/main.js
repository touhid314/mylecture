import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu, nativeTheme } from "electron";
import { lecturegenCatalog } from "./lecturegen/run.js";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEngines, API_PROVIDERS, OFFERED_API_PROVIDERS, verifyApiProvider } from "./engines/index.js";
import { setHermesToolsDir } from "./engines/hermes.js";
import { createUsageService } from "./usage.js";
import { accountRemovalPatch, accountRevisionPatch } from "./account-connections.js";
import { listRenderedVideos } from "./video-library.js";
import { TTSService, KOKORO_VOICES, OMNIVOICE_VOICES } from "./tts/index.js";
import { VOICE_ALIASES } from "./tts/omnivoice.js";
import { DEMO_TEXT, readDemo } from "./tts/demos.js";
import { Generator, audioUrl, sceneUrl } from "./generator.js";
import { IdeService, hydrateProject } from "./ide.js";
import { SERVICES, connectService } from "./connect.js";
import { prepareAttachments } from "./attachments.js";
// What the tutor can take in: pictures it can see, documents it can read.
const STUDY_FILE = /\.(png|jpe?g|webp|gif|pdf|docx?|pptx?|xlsx?|txt|md|csv)$/i;
import { getSettings, saveSettings, getSecret, setSecret, hasSecret, lectures, sessions, tutorSessions, paths, newId } from "./store.js";
import { TutorService, tutorEngineChoice } from "./tutor/service.js";
import { SpeechToText } from "./tutor/stt.js";
import { ImageFinder } from "./tutor/images.js";
import { exportMp4, exportStandaloneHtml, exportContractBundle, captions, safeName } from "./exporter.js";
import { sendLaunchPing, launchPingSuppressed } from "./telemetry.js";
import { createUpdater } from "./updater.js";
import { ComponentManager, COMPONENT_IDS } from "./components.js";
import { configureLogger, log, getLogInfo, readLogTail, onLogEntry, registerLogSecret } from "./logger.js";
import { Readable } from "node:stream";
import { mediaRange, contentType } from "./media-range.js";
import { exportProject, importProject } from "./project-archive.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const APP_DIR = path.join(ROOT, "app");
const NM = path.join(ROOT, "node_modules");
const DEV = process.argv.includes("--dev");
// MyLecture's server (launch counts + updates): ../mylecture-app-admin/server.
let serverUrl = "";
try {
  serverUrl = JSON.parse(fs.readFileSync(path.join(here, "server-config.json"), "utf8")).url || "";
} catch {}
const telemetryEndpoint = process.env.MYLECTURE_TELEMETRY_URL ?? serverUrl;
const updateFeed = process.env.MYLECTURE_UPDATE_URL || (serverUrl && `${serverUrl}/updates`);
const telemetrySuppressed = launchPingSuppressed({ isPackaged: app.isPackaged, argv: process.argv, env: process.env });

app.setName("MyLecture");
// MYLECTURE_PROFILE=<folder>: run with a separate profile (settings, projects,
// voices, videos), e.g. to see the app exactly as a fresh install does.
if (process.env.MYLECTURE_PROFILE) app.setPath("userData", path.resolve(process.env.MYLECTURE_PROFILE));
configureLogger({ directory: path.join(app.getPath("userData"), "logs") });
log("info", "app.start", { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, dev: DEV, testProfile: !!process.env.MYLECTURE_PROFILE });
process.on("uncaughtExceptionMonitor", error => log("error", "process.uncaughtException", { error }));
process.on("unhandledRejection", reason => log("error", "process.unhandledRejection", { error: reason instanceof Error ? reason : String(reason) }));
app.on("child-process-gone", (_event, details) => log("error", "process.childGone", details));
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
let engines, tts, generator, ide, tutor, stt, images;
const exportJobs = new Map();
let updater;
let components;
// --setup-components=claude-code,codex,...: run by the Windows installer for the
// engines and voices ticked on its "AI engines" page. Shows a progress window,
// installs them, then exits. No main window, update check or launch ping.
const SETUP_IDS = (process.argv.find(a => a.startsWith("--setup-components="))?.split("=")[1] || "")
  .split(",").filter(id => COMPONENT_IDS.includes(id));
const SETUP_MODE = process.argv.some(a => a.startsWith("--setup-components="));
let lastTtsLogState = "", lastTtsLogAt = 0;

function send(channel, payload) {
  if (channel === "gen:event" && !["activity", "answer", "progress", "script", "beat", "delta"].includes(payload?.type)) {
    log(payload?.type === "error" ? "error" : "info", `generation.${payload?.type || "event"}`, {
      jobId: payload?.jobId, lectureId: payload?.lectureId, index: payload?.index,
      message: payload?.message, aborted: payload?.aborted,
      engine: payload?.engine, model: payload?.model, elapsed: payload?.elapsed,
      sceneCount: payload?.lecture?.scenes?.length, status: payload?.lecture?.status,
    });
  }
  if (channel === "ide:job") log("info", "job.state", payload);
  if (channel === "tts:status") {
    const engine = getSettings().voiceEngine;
    const state = `${engine}:${payload?.kokoro?.state}:${payload?.omnivoice?.state}`;
    if (state !== lastTtsLogState || Date.now() - lastTtsLogAt >= 5000) {
      lastTtsLogState = state;
      lastTtsLogAt = Date.now();
      log(/error/.test(state) ? "error" : "info", "tts.status", { engine, kokoro: payload?.kokoro?.state, kokoroMessage: payload?.kokoro?.message, omnivoice: payload?.omnivoice?.state, omnivoiceMessage: payload?.omnivoice?.message });
    }
  }
  if (channel === "export:progress" && ["done", "error"].includes(payload?.phase)) log(payload.phase === "error" ? "error" : "info", "export." + payload.phase, { jobId: payload.jobId, lectureId: payload.lectureId, kind: payload.kind, message: payload.message });
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
onLogEntry(entry => send("logs:entry", entry));

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
    ["tutor-img/", path.join(paths.tutor, "images")],
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
  win.webContents.on("did-finish-load", () => log("info", "renderer.loaded"));
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => log("error", "renderer.loadFailed", { errorCode, errorDescription, isMainFrame }));
  win.webContents.on("render-process-gone", (_event, details) => log("error", "renderer.gone", details));
  win.webContents.on("console-message", details => {
    if (details.level === "error") log("error", "renderer.consoleError", { message: details.message, line: details.lineNumber, source: details.sourceId });
  });
  win.on("unresponsive", () => log("warn", "renderer.unresponsive"));
  win.on("enter-full-screen", () => send("window:fullscreen", true));
  win.on("leave-full-screen", () => send("window:fullscreen", false));
  win.on("responsive", () => log("info", "renderer.responsive"));
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
  return hydrateProject(lec);
}

function registerIpc() {
  const readUsage = createUsageService(engines);
  const statusCache = new Map();
  const modelRequests = new Map();
  const invalidateAccount = id => { statusCache.delete(id); modelRequests.delete(id); readUsage.invalidate(id); };
  ipcMain.handle("engines:usage", async (_event, id) => {
    const s = getSettings();
    id ||= s.engine;
    if (!id || (id !== "api" && !s.connected?.[id])) return { available: false, groups: [], message: "Connect an account to see its limits." };
    const revision = s.accountRevision?.[id] ?? 0;
    const result = await readUsage(id);
    if (revision !== (getSettings().accountRevision?.[id] ?? 0) || (id !== "api" && !getSettings().connected?.[id])) return { available: false, groups: [], message: "Account changed. Refresh to see its limits." };
    if (id === "codex" && s.accountChangedAt?.[id] && (!result.measuredAt || Date.parse(result.measuredAt) < s.accountChangedAt[id])) return { available: false, groups: [], message: "Make a video with this GPT account, then refresh its limits." };
    return result;
  });
  const h = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    if (name.startsWith("logs:")) return fn(...args);
    const started = Date.now();
    log("info", "ipc.start", { operation: name });
    try {
      const result = await fn(...args);
      log("info", "ipc.done", { operation: name, durationMs: Date.now() - started });
      return result;
    } catch (error) {
      log("error", "ipc.failed", { operation: name, durationMs: Date.now() - started, error });
      throw error;
    }
  });
  h("logs:info", () => getLogInfo());
  h("logs:read", () => readLogTail());
  h("logs:openFolder", () => shell.openPath(getLogInfo().directory));
  ipcMain.on("logs:renderer", (_event, entry) => {
    if (!entry || !["error", "unhandledrejection"].includes(entry.kind)) return;
    log("error", "renderer." + entry.kind, { message: String(entry.message || "").slice(0, 2000), stack: String(entry.stack || "").slice(0, 4000), line: entry.line });
  });

  h("app:info", () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath("userData"), exportsDir: paths.exports, dev: DEV, styles: lecturegenCatalog()}));

  // create tab (local IDE)
  h("ide:list", () => ide.list());
  h("ide:get", (id) => ide.get(id));
  h("ide:readFile", (id, name) => ide.readFile(id, name));
  h("ide:narration", (id) => ide.narration(id));
  h("ide:remove", (id) => ide.remove(id));
  h("ide:exportProject", async (id) => {
    if (ide.job) throw new Error("Wait for the current job to finish.");
    const lecture = lectures.get(id);
    if (!lecture) throw new Error("Project not found.");
    const selected = await dialog.showSaveDialog(win, { title: "Export project", defaultPath: path.join(app.getPath("documents"), safeName(lecture.title) + ".lecture"), filters: [{ name: "MyLecture project", extensions: ["lecture"] }] });
    if (selected.canceled || !selected.filePath) return null;
    const abort = ide._begin("project export", id);
    try {
      const destination = /\.lecture$/i.test(selected.filePath) ? selected.filePath : selected.filePath + ".lecture";
      const file = await exportProject({ lecture, workspaceDir: lectures.dir(id), audioDir: paths.tts, file: destination, signal: abort.signal });
      return { file };
    } finally { ide._end(id); }
  });
  h("ide:importProject", async () => {
    if (ide.job) throw new Error("Wait for the current job to finish.");
    const selected = await dialog.showOpenDialog(win, { title: "Import project", properties: ["openFile"], filters: [{ name: "MyLecture project", extensions: ["lecture"] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const id = newId("lec-");
    const abort = ide._begin("project import", id);
    try {
      await importProject({ file: selected.filePaths[0], libraryDir: paths.library, audioDir: paths.tts, id, signal: abort.signal });
      return { id };
    } finally { ide._end(id); }
  });
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
    registerLogSecret(value);
    setSecret(name, value);
    return true;
  });

  // engines
  h("engines:list", async () => {
    const out = [];
    for (const e of engines.list) out.push({ id: e.id, name: e.name, kind: e.kind, defaultModel: e.defaultModel || "", installHint: e.installHint || "" });
    return { engines: out, apiProviders: OFFERED_API_PROVIDERS };
  });
  h("connect:services", () => SERVICES);
  // "Use with API key": check a key for real before it is saved.
  h("api:verify", ({ provider, apiKey, baseUrl } = {}) => verifyApiProvider({ provider, apiKey: apiKey || getSecret(`api:${provider}`), baseUrl }));
  h("connect:run", async (id, action, options = {}) => {
    log("info", "account.action", { provider: id, action });
    if (action === "install") return components.install(id).then(() => true);
    if (!["remove-account", "switch-account", "complete-account", "connect-account"].includes(action)) {
      if (action === "login") invalidateAccount(id);
      return connectService(id, action);
    }
    if (!Object.hasOwn(SERVICES, id)) throw new Error("Unknown account provider");
    if (generator.jobs.size || ide.job || exportJobs.size) throw new Error("Stop the current job before changing accounts.");
    if (action === "complete-account" || action === "connect-account") {
      const s = getSettings();
      const switching = action === "complete-account";
      if ((switching ? !s.accountSwitch?.[id] : !!s.accountSwitch?.[id]) || options.revision !== (s.accountRevision?.[id] ?? 0)) throw new Error("This sign-in was cancelled. Try again.");
      const revision = s.accountRevision?.[id] ?? 0;
      const st = await engines.get(id).status();
      if ((getSettings().accountRevision?.[id] ?? 0) !== revision || (switching ? !getSettings().accountSwitch?.[id] : !!getSettings().accountSwitch?.[id])) throw new Error("This sign-in was cancelled.");
      if (!st.ready || (switching && (options.email || "") !== (st.account?.email || ""))) throw new Error("The signed-in account changed. Check the account shown and try again.");
      if (options.automatic && (!s.accountSwitchFrom?.[id] || s.accountSwitchFrom[id].toLowerCase() === (st.account?.email || "").toLowerCase())) throw new Error("Finish signing in with the new account, or select Use this account.");
      invalidateAccount(id);
      return saveSettings({ connected: { [id]: true }, accountSwitch: { [id]: false }, accountSwitchFrom: { [id]: "" }, accountChangedAt: { [id]: Date.now() }, engine: id, ...accountRevisionPatch(getSettings(), id) });
    }
    let previousEmail = "";
    if (action === "switch-account") {
      const revision = getSettings().accountRevision?.[id] ?? 0;
      const previous = await engines.get(id).status();
      if (revision !== (getSettings().accountRevision?.[id] ?? 0)) throw new Error("The account changed. Try again.");
      previousEmail = previous.account?.email || "";
    }
    invalidateAccount(id);
    const s = saveSettings({ ...accountRemovalPatch(getSettings(), id), accountSwitchFrom: { [id]: previousEmail }, accountChangedAt: { [id]: Date.now() }, accountSwitch: { [id]: action === "switch-account" } });
    if (action === "switch-account") {
      try { connectService(id, action); }
      catch (error) { saveSettings({ accountSwitch: { [id]: false } }); throw error; }
    }
    return s;
  });
  // Cached briefly: the connect cards poll, and the checks start the provider tools.
  h("engines:status", async (id, { fresh = false } = {}) => {
    if (!id || !engines.list.some(e => e.id === id)) return { installed: false, ready: false, message: "Connect an account in Settings." };
    const revision = getSettings().accountRevision?.[id] ?? 0;
    const hit = statusCache.get(id);
    if (!fresh && hit && Date.now() - hit.at < (hit.value?.ready ? 60000 : 8000)) {
      const result = await hit.promise;
      return revision === (getSettings().accountRevision?.[id] ?? 0) ? result : { installed: true, ready: false, message: "Account changed. Refresh to check sign-in." };
    }
    const promise = engines
      .get(id)
      .status()
      .catch((e) => ({ installed: false, ready: false, message: String(e.message || e) }));
    statusCache.set(id, { at: Date.now(), promise });
    promise.then((value) => {
      const entry = statusCache.get(id);
      if (entry?.promise === promise) entry.value = value;
    });
    const result = await promise;
    log("info", "account.status", { provider: id, ready: result.ready, installed: result.installed, hasEmail: !!result.account?.email, message: result.ready ? undefined : result.message });
    return revision === (getSettings().accountRevision?.[id] ?? 0) ? result : { installed: true, ready: false, message: "Account changed. Refresh to check sign-in." };
  });
  h("engines:models", async (id) => {
    const s = getSettings();
    const key = id === "api" ? JSON.stringify([id, s.api.provider, s.api.baseUrl]) : id;
    if (modelRequests.has(key)) return modelRequests.get(key);
    const selected = engines.get(id);
    const engine = selected.snapshot?.() || selected;
    const revision = s.accountRevision?.[id] ?? 0;
    const request = engine.models().then(models => {
      if (revision !== (getSettings().accountRevision?.[id] ?? 0)) throw new Error("Account changed. Refresh the model list.");
      return models;
    }).finally(() => { if (modelRequests.get(key) === request) modelRequests.delete(key); });
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
  h("tts:voices", () => ({ kokoro: KOKORO_VOICES, omnivoice: tts.omni.voices(), system: tts.sapi.voices }));
  h("tts:addVoice", (input) => tts.omni.addVoice(input || {}, DEMO_TEXT));
  // Voice-menu demo: the saved recording. Only a voice without one (for
  // example, its demo failed when it was added) is generated, once, and saved.
  h("tts:demo", async (engine, voice) => {
    const saved = readDemo(engine, voice, paths.voices);
    if (saved) return { url: saved, saved: true };
    if (engine === "omnivoice" && String(voice).startsWith("custom-")) {
      await tts.omni.makeDemo(voice, DEMO_TEXT);
      return { url: readDemo(engine, voice, paths.voices), saved: true };
    }
    const r = await tts.synth(DEMO_TEXT, { engine, voice, speed: 1 });
    return { url: audioUrl(r.key), saved: false };
  });
  h("tts:removeVoice", (id) => {
    tts.omni.removeVoice(id);
    const s = getSettings();
    if (s.omnivoiceVoice === id) saveSettings({ omnivoiceVoice: "maruf" });
    return tts.omni.voices();
  });
  h("tts:preview", async (text, opts) => {
    const r = await tts.synth(text || "Hi! I'm your MyLecture tutor. Ask me anything.", opts || {});
    return { url: audioUrl(r.key), dur: r.dur };
  });
  h("tts:synth", async (text, opts) => {
    const o = opts && typeof opts === "object" ? { engine: opts.engine, voice: opts.voice, speed: Number(opts.speed) || undefined } : {};
    const r = await tts.synth(text, o);
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
  // study: live tutor
  h("study:turn", (req) => tutor.turn(req));
  h("study:cancel", (turnId) => tutor.cancel(turnId));
  h("study:engine", () => tutorEngineChoice(getSettings()));
  h("study:list", () => tutorSessions.list());
  h("study:get", (id) => tutorSessions.get(id));
  h("study:save", (session) => tutorSessions.save(session));
  h("study:remove", (id) => tutorSessions.remove(id));
  h("study:newId", () => newId("tut-"));
  h("study:image", (query) => images.find(query));
  // Files the student shares with the tutor: stored with the lesson; the
  // records (name, type, extracted text, path) go back into the session.
  h("study:attach", async ({ sessionId, files }) => {
    const ok = (files || []).filter((f) => STUDY_FILE.test(String(f?.name || "")));
    if (ok.length < (files || []).length) throw new Error("The tutor can read pictures (PNG, JPG, WebP, GIF) and documents (PDF, Word, PowerPoint, Excel, text).");
    return prepareAttachments(ok, tutorSessions.dir(sessionId));
  });
  h("stt:warm", () => { stt.start(); return stt.state; });
  h("stt:status", () => stt.state);
  ipcMain.handle("stt:transcribe", (_e, pcm) => stt.transcribe(pcm instanceof Float32Array ? pcm : new Float32Array(pcm)));
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
        const projectDir = lectures.dir(lec.id);
        if (kind === "mp4") out = await exportMp4(lec, { ttsFile, outDir, projectDir, fps: fps || 30, captionsOn: !!cap, height, onProgress: progress, signal: ac.signal });
        else if (kind === "html") out = await exportStandaloneHtml(lec, { ttsFile, outDir, appDir: APP_DIR, projectDir });
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
  h("components:status", () => components.status().map(({ progress, ...c }) => ({ ...c, progress: progress && { state: progress.state, message: progress.message, percent: progress.percent } })));
  h("components:install", async (id) => {
    await components.install(id);
    return true;
  });
  h("update:state", () => updater?.state || { status: "idle", mode: "off" });
  h("update:install", (options) => updater?.install({ force: !!options?.force }) || { ok: false });
  h("update:openTerminal", () => updater?.openTerminal() || { ok: false });
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
    // Media (music, narration, video clips) must be seekable: answer Range
    // requests with 206 Partial Content, or Chromium treats the file as a
    // non-seekable stream and seeking stalls playback.
    const range = mediaRange(req.headers.get("range"), fs.statSync(file).size);
    if (range) {
      const headers = new Headers({
        "Content-Type": contentType(file),
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        ...(range.ok ? { "Content-Range": `bytes ${range.start}-${range.end}/${range.size}`, "Content-Length": String(range.end - range.start + 1) } : { "Content-Range": `bytes */${range.size}` }),
      });
      if (!range.ok) return new Response(null, { status: 416, headers });
      return new Response(Readable.toWeb(fs.createReadStream(file, { start: range.start, end: range.end })), { status: 206, headers });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    // The stage runs in an opaque-origin sandbox; fonts need CORS headers.
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "no-cache");
    headers.set("Accept-Ranges", "bytes");
    return new Response(res.body, { status: res.status, headers });
  });

  setHermesToolsDir(path.join(app.getPath("userData"), "tools"));
  engines = createEngines(apiConfig);
  tts = new TTSService({ cacheDir: paths.tts, modelDir: paths.models, voicesDir: paths.voices, getSettings });
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
  tutor = new TutorService({ engines, getSettings, send });
  stt = new SpeechToText({ modelDir: paths.models });
  images = new ImageFinder({ dir: path.join(paths.tutor, "images") });
  stt.on("status", (st) => send("stt:status", st));
  components = new ComponentManager({
    userData: app.getPath("userData"), modelDir: paths.models, tts, getSettings, saveSettings, log,
    hermesSource: app.isPackaged ? path.join(process.resourcesPath, "hermes") : path.join(here, "..", "vendor", "hermes"),
  });
  components.on("progress", ({ promise, ...p }) => {
    send("components:progress", p);
    if (p.id === "omnivoice" && p.state === "done") tts.omni.stop();
  });
  // Renamed or removed OmniVoice voices: move saved settings to the new id.
  { const v = getSettings().omnivoiceVoice; if (VOICE_ALIASES[v]) saveSettings({ omnivoiceVoice: VOICE_ALIASES[v] }); }
  registerIpc();
  if (SETUP_MODE) return runSetupMode();
  createWindow();
  updater = createUpdater({
    app, shell, send, log, feedUrl: updateFeed,
    isBusy: () => !!(generator.jobs.size || ide.job || exportJobs.size),
  });
  updater.start();
  void sendLaunchPing({
    endpoint: telemetryEndpoint,
    version: app.getVersion(),
    platform: process.platform,
    enabled: !telemetrySuppressed,
  });

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
  stt?.stop();
  app.quit();
});
app.on("before-quit", () => log("info", "app.quit"));

async function runSetupMode() {
  log("info", "setup.start", { components: SETUP_IDS });
  win = new BrowserWindow({
    width: 560, height: 520, title: "Setting up MyLecture", backgroundColor: "#111010", autoHideMenuBar: true,
    icon: path.join(APP_DIR, "assets", "icon.png"),
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  await win.loadURL(`mylecture://app/setup.html?ids=${encodeURIComponent(SETUP_IDS.join(","))}`);
  let failed = 0;
  for (const id of SETUP_IDS) {
    if (win.isDestroyed()) break;
    try { await components.install(id); } catch { failed++; }
  }
  log("info", "setup.done", { failed });
  if (win.isDestroyed()) return app.quit();
  send("components:setup-done", { failed });
  // Close by itself when everything worked; otherwise leave the errors visible.
  if (!failed) setTimeout(() => app.quit(), 2500);
}

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
      if (r.view === "view-create" || r.view === "view-study") {
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
  // Study: hold-to-talk speech recognition (Whisper in a utility process)
  // hears the Kokoro sentence back, and the lesson board draws.
  try {
    const r = await tts.synth("Hello, the tutor is ready.", { engine: "kokoro" });
    const wav = fs.readFileSync(r.file);
    const rate = wav.readUInt32LE(24);
    const pcm16 = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length - ((wav.length - 44) % 2)));
    const n = Math.floor((pcm16.length * 16000) / rate);
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = (pcm16[Math.min(pcm16.length - 1, Math.round((i * rate) / 16000))] || 0) / 32768;
    const text = await stt.transcribe(pcm);
    if (!/ready/i.test(text)) throw new Error(`heard "${text}"`);
    parts.push("stt=ok");
  } catch (e) {
    throw fail("speech recognition", e);
  } finally {
    stt.stop();
  }
  try {
    const r = await win.webContents.executeJavaScript(`(() => {
      const v = window.__mlStudy;
      if (!v) return "no Study view";
      v._enter({ id: "tut-smoke", topic: "Smoke", title: "Smoke", plan: ["One"], section: 1, history: [], board: [] });
      const b = v.board;
      b.draw({ type: "page", text: "Smoke" });
      b.draw({ type: "math", id: "eq", text: "\\\\frac{\\\\htmlId{top}{a}}{b} = c" });
      b.draw({ type: "svg", id: "fig", text: '<svg viewBox="0 0 100 50"><rect id="box" x="10" y="10" width="30" height="20"/></svg>' });
      b.draw({ type: "scene", id: "sc", data: { items: [{ type: "emoji", id: "car", char: "🚗", x: 50, y: 50 }], anim: [{ target: "car", to: { x: 300 }, dur: 1 }] } });
      const ok = document.querySelector(".wb-math .katex") && document.querySelector(".wb-svg #box") && b.point("eq.top") && b.point("fig.box") && b.point("sc.car");
      v.lesson?.stop?.();
      return ok ? "ok" : "board did not draw";
    })()`);
    if (r !== "ok") throw new Error(r);
    parts.push("board=ok");
  } catch (e) {
    throw fail("study board", e);
  }
  return " " + parts.join(" ");
}
