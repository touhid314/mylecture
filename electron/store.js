// Local persistence: settings, study sessions, and the lecture library.
// Everything lives in the user's app-data folder; nothing leaves the machine
// except prompts sent to the AI engine the user chose.
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_SETTINGS = {
  engine: "antigravity",
  models: { antigravity: "", codex: "", "claude-code": "", api: "" },
  codexEffort: "", // empty uses the selected provider's native default
  engineEfforts: {},
  api: { provider: "gemini", model: "", baseUrl: "" },
  voiceEngine: "kokoro", // kokoro | omnivoice | system
  omnivoiceVoice: "maruf",
  omnivoicePython: "",
  voice: "af_heart",
  systemVoice: "",
  voiceSpeed: 1,
  playbackRate: 1,
  captions: true,
  theme: "dark",
  teachingStyle: "default",
  lgTheme: "default",
  lgTeachingStyle: "default",
  length: "standard",
  aspect: "16:9",
  language: "",
  autoplay: true,
  uiTheme: "dark",
  onboarded: false,
};

function root() {
  return app.getPath("userData");
}

export const paths = {
  get settings() {
    return path.join(root(), "settings.json");
  },
  get secrets() {
    return path.join(root(), "secrets.bin");
  },
  get library() {
    return path.join(root(), "library");
  },
  get sessions() {
    return path.join(root(), "sessions");
  },
  get tts() {
    return path.join(root(), "tts-cache");
  },
  get models() {
    return path.join(root(), "models");
  },
  get exports() {
    // A separate profile (MYLECTURE_PROFILE) keeps its videos with it.
    if (process.env.MYLECTURE_PROFILE) return path.join(root(), "videos");
    return path.join(app.getPath("videos"), "MyLecture");
  },
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) && base[k] && typeof base[k] === "object") out[k] = deepMerge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

// ---------- settings ----------
let settingsCache = null;
export function getSettings() {
  if (!settingsCache) settingsCache = deepMerge(DEFAULT_SETTINGS, readJson(paths.settings, {}));
  return settingsCache;
}
export function saveSettings(patch) {
  settingsCache = deepMerge(getSettings(), patch || {});
  writeJson(paths.settings, settingsCache);
  return settingsCache;
}

// ---------- secrets (API keys), encrypted with the OS keychain/DPAPI ----------
function readSecrets() {
  try {
    const buf = fs.readFileSync(paths.secrets);
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
    return JSON.parse(txt);
  } catch {
    return {};
  }
}
export function getSecret(name) {
  return readSecrets()[name] || "";
}
export function setSecret(name, value) {
  const all = readSecrets();
  if (value) all[name] = value;
  else delete all[name];
  const txt = JSON.stringify(all);
  fs.mkdirSync(path.dirname(paths.secrets), { recursive: true });
  fs.writeFileSync(paths.secrets, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt));
}
export function hasSecret(name) {
  return !!readSecrets()[name];
}

// ---------- ids ----------
export function newId(prefix = "") {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return prefix + stamp + "-" + crypto.randomBytes(3).toString("hex");
}

// ---------- lectures ----------
export const lectures = {
  dir(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error("bad lecture id");
    return path.join(paths.library, id);
  },
  get(id) {
    return readJson(path.join(this.dir(id), "lecture.json"), null);
  },
  save(lec) {
    lec.updatedAt = new Date().toISOString();
    writeJson(path.join(this.dir(lec.id), "lecture.json"), lec);
    return lec;
  },
  list() {
    let ids = [];
    try {
      ids = fs.readdirSync(paths.library);
    } catch {}
    const out = [];
    for (const id of ids) {
      const l = readJson(path.join(paths.library, id, "lecture.json"), null);
      if (!l) continue;
      out.push({
        id: l.id,
        title: l.title,
        question: l.question,
        aspect: l.aspect,
        theme: l.theme,
        source: l.source,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
        scenes: (l.scenes || []).length,
        duration: l.duration || 0,
        status: l.status,
      });
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },
  remove(id) {
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  },
};

// ---------- study sessions ----------
export const sessions = {
  file(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error("bad session id");
    return path.join(paths.sessions, id + ".json");
  },
  get(id) {
    return readJson(this.file(id), null);
  },
  save(s) {
    s.updatedAt = new Date().toISOString();
    writeJson(this.file(s.id), s);
    return s;
  },
  list() {
    let files = [];
    try {
      files = fs.readdirSync(paths.sessions).filter((f) => f.endsWith(".json"));
    } catch {}
    return files
      .map((f) => readJson(path.join(paths.sessions, f), null))
      .filter(Boolean)
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, count: (s.messages || []).length }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },
  remove(id) {
    fs.rmSync(this.file(id), { force: true });
  },
};
