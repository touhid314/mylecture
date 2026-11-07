import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { killTree } from "../engines/cli-util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALL_VOICES = [
  ["maruf", "Maruf"], ["haroon", "Haroon"], ["ovi", "Ovi"], ["onik", "Onik"],
  ["adam", "Adam"], ["alex", "Alex"], ["arabella", "Arabella"],
  ["bradford", "Bradford"], ["cassidy", "Cassidy"],
  ["christopher", "Christopher"], ["christopher-2", "Christopher 2"],
  ["david-castlemore", "David Castlemore"], ["declan-sage", "Declan Sage"],
  ["frederick-surrey", "Frederick Surrey"], ["hope", "Hope"],
  ["ian-cartwell", "Ian Cartwell"], ["james", "James"],
  ["jessica-anne-bogart", "Jessica Anne Bogart"], ["jessica-anne-bogart-2", "Jessica Anne Bogart 2"],
  ["john-doe", "John Doe"], ["jon", "Jon"], ["mark", "Mark"], ["mark-2", "Mark 2"],
  ["michael-c-vincent", "Michael C. Vincent"], ["nassim", "Nassim"],
  ["peter", "Peter"], ["spuds-oxley", "Spuds Oxley"],
  ["johnny-harris", "Johnny Harris"],
];
// Saved settings may name voices that were renamed or removed.
export const VOICE_ALIASES = { "american-male-1": "haroon", "american-male-2": "ovi", "american-male-3": "onik", mike: "maruf" };
export const resolveVoiceId = (id) => VOICE_ALIASES[id] || id;
// Reference voices ship in electron/tts/voices. Voices that must not ship in
// releases (e.g. clones of real people) live in voices-dev/ at the repo root,
// which packaging never includes; they are offered only when present.
const VOICE_DIRS = [path.join(here, "voices"), path.resolve(here, "../../voices-dev")];
const voiceDir = (id) => VOICE_DIRS.map((d) => path.join(d, id)).find((d) => fs.existsSync(path.join(d, "reference.wav")));
export const OMNIVOICE_VOICES = ALL_VOICES.filter(([id]) => voiceDir(id));
// Folder of a bundled or user voice (holds reference.wav, transcript.txt, demo.mp3).
export function omniVoiceFolder(id, customDir) {
  if (!/^[\w-]+$/.test(String(id))) return null;
  if (String(id).startsWith("custom-")) return customDir && fs.existsSync(path.join(customDir, id, "reference.wav")) ? path.join(customDir, id) : null;
  return voiceDir(id) || null;
}

// ---------- the user's own reference voices ----------
// Stored outside the app (userData/voices/<id>/) in the same format as the
// bundled voices: reference.wav (24 kHz mono) + transcript.txt, plus voice.json.
export const CUSTOM_PREFIX = "custom-";
export const REFERENCE_MAX_SECONDS = 20;
export const REFERENCE_MIN_SECONDS = 3;
const AUDIO_EXT = /^\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|webm|mp4|mov|mkv)$/i;

function ffmpegBin() {
  let p = createRequire(import.meta.url)("ffmpeg-static");
  if (p && p.includes("app.asar")) p = p.replace("app.asar", "app.asar.unpacked");
  return p;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with ${code}`))));
  });
}

export async function wavToMp3(wav, mp3) {
  await runFfmpeg(["-i", wav, "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k", mp3]);
}

function wavSeconds(file) {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24), channels = b.readUInt16LE(22), bits = b.readUInt16LE(34);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "data") return size / (rate * channels * (bits / 8));
    off += 8 + size + (size % 2);
  }
  return 0;
}

export function customVoices(dir) {
  if (!dir) return [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const id of names) {
    if (!id.startsWith(CUSTOM_PREFIX) || !/^[\w-]+$/.test(id)) continue;
    const folder = path.join(dir, id);
    if (!fs.existsSync(path.join(folder, "reference.wav")) || !fs.existsSync(path.join(folder, "transcript.txt"))) continue;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(folder, "voice.json"), "utf8")); } catch {}
    out.push([id, String(meta.name || "My voice"), { custom: true, createdAt: meta.createdAt || "" }]);
  }
  return out.sort((a, b) => String(a[2].createdAt).localeCompare(String(b[2].createdAt)));
}

// Convert any audio (or video) clip into a reference voice.
export async function addCustomVoice(dir, { name, transcript, data, ext = ".wav" }) {
  name = String(name || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 60);
  transcript = String(transcript || "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Give the voice a name.");
  if (transcript.length < 8) throw new Error("Type exactly what is said in the recording.");
  if (transcript.length > 1000) throw new Error("The transcript is too long. Use a recording of 3 to 20 seconds.");
  ext = String(ext || "").toLowerCase();
  if (!AUDIO_EXT.test(ext)) throw new Error("Use an audio file (WAV, MP3, M4A, OGG, FLAC, WebM) or record one.");
  const bytes = Buffer.isBuffer(data) ? data : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : data instanceof ArrayBuffer ? Buffer.from(data) : null;
  if (!bytes?.length) throw new Error("The recording is empty.");
  if (bytes.length > 100 * 1024 * 1024) throw new Error("The audio file must be 100 MB or smaller.");
  const id = CUSTOM_PREFIX + crypto.randomBytes(6).toString("hex");
  const folder = path.join(dir, id);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-voice-"));
  try {
    const src = path.join(tmp, "source" + ext);
    fs.writeFileSync(src, bytes);
    fs.mkdirSync(folder, { recursive: true });
    const wav = path.join(folder, "reference.wav");
    // 24 kHz mono 16-bit, loudness-normalised, leading/trailing silence removed.
    await runFfmpeg(["-i", src, "-vn", "-ac", "1", "-ar", "24000", "-sample_fmt", "s16",
      "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse,loudnorm=I=-18:TP=-2",
      "-t", String(REFERENCE_MAX_SECONDS), wav]);
    const secs = wavSeconds(wav);
    if (secs < REFERENCE_MIN_SECONDS) throw new Error(`The recording has only ${secs.toFixed(1)} s of speech. Record at least ${REFERENCE_MIN_SECONDS} seconds.`);
    fs.writeFileSync(path.join(folder, "transcript.txt"), transcript + "\n", "utf8");
    fs.writeFileSync(path.join(folder, "voice.json"), JSON.stringify({ name, createdAt: new Date().toISOString(), seconds: Math.round(secs * 10) / 10 }, null, 2));
    return [id, name, { custom: true }];
  } catch (e) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function removeCustomVoice(dir, id) {
  if (!String(id).startsWith(CUSTOM_PREFIX) || !/^[\w-]+$/.test(id)) throw new Error("Only your own voices can be removed.");
  fs.rmSync(path.join(dir, id), { recursive: true, force: true });
}

export function resolveOmniPython(configured = "") {
  if (configured.trim()) return configured.trim();
  if (process.env.MYLECTURE_PYTHON) return process.env.MYLECTURE_PYTHON;
  const root = path.resolve(here, "../..");
  const bin = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
  for (const folder of ["../omnivoice/.venv", "../~others/omnivoice/.venv", "../.venv", ".venv"]) {
    const exe = path.resolve(root, folder, bin);
    if (fs.existsSync(exe)) return exe;
  }
  return process.platform === "win32" ? "python" : "python3";
}

export class OmniVoice extends EventEmitter {
  constructor({ modelDir, getSettings, customDir }) {
    super();
    this.modelDir = modelDir;
    this.customDir = customDir;
    this.getSettings = getSettings;
    this.status = { state: "idle", progress: 0, message: "Not loaded" };
    this.jobs = new Map();
    this.seq = 0;
  }
  update(patch) { Object.assign(this.status, patch); this.emit("status"); }
  voices() { return [...OMNIVOICE_VOICES, ...customVoices(this.customDir)]; }
  // Adds the voice and records its menu demo right away, so playing the demo
  // later never waits for generation.
  async addVoice(input, demoText) {
    const voice = await addCustomVoice(this.customDir, input);
    if (demoText) {
      try { await this.makeDemo(voice[0], demoText); } catch (e) { voice[2] = { ...voice[2], demoError: String(e.message || e) }; }
    }
    return voice;
  }
  async makeDemo(id, text) {
    const folder = omniVoiceFolder(id, this.customDir);
    if (!folder) throw new Error("Unknown voice");
    const wav = path.join(folder, "demo.tmp.wav");
    try {
      await this.synth(text, wav, { voice: id, speed: 1 });
      await wavToMp3(wav, path.join(folder, "demo.mp3"));
    } finally { fs.rmSync(wav, { force: true }); }
    return path.join(folder, "demo.mp3");
  }
  removeVoice(id) { return removeCustomVoice(this.customDir, id); }
  start() {
    if (this.loading) return this.loading;
    this.update({ state: "loading", message: "Loading OmniVoice locally…", progress: 0 });
    let child;
    try {
      // Python cannot read inside Electron's ASAR; stage bundled runtime assets.
      const runtime = path.join(this.modelDir, "omnivoice-runtime");
      fs.mkdirSync(runtime, { recursive: true });
      fs.copyFileSync(path.join(here, "omnivoice-worker.py"), path.join(runtime, "worker.py"));
      for (const [id] of OMNIVOICE_VOICES) fs.cpSync(voiceDir(id), path.join(runtime, "voices", id), { recursive: true });
      child = spawn(resolveOmniPython(this.getSettings().omnivoicePython), ["-u", path.join(runtime, "worker.py")], {
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", ML_OMNIVOICE_VOICES: [path.join(runtime, "voices"), this.customDir].filter(Boolean).join(path.delimiter) },
      });
    } catch (cause) {
      const error = new Error(`OmniVoice startup: ${cause.message}`, { cause });
      this.child = null;
      this.loading = null;
      this.update({ state: "error", message: error.message });
      return Promise.reject(error);
    }
    this.child = child;
    let buffer = "", stderr = "";
    this.loading = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error("OmniVoice load timed out. Check the Python environment and model download.")), 300000);
      const fail = (e) => {
        clearTimeout(timer);
        if (this.child !== child) return;
        this.update({ state: "error", message: e.message });
        reject(e);
        for (const job of this.jobs.values()) { clearTimeout(job.timer); job.reject(e); }
        this.jobs.clear();
        this.child = null;
        this.loading = null;
        killTree(child);
      };
      child.on("error", e => fail(new Error(`OmniVoice Python: ${e.message}. Choose a Python environment with omnivoice installed.`)));
      child.on("close", code => fail(new Error(`OmniVoice worker exited (${code}). ${stderr.slice(-700)}`)));
      child.stdin.on("error", e => fail(e));
      child.stderr.on("data", d => { stderr = (stderr + d).slice(-3000); });
      child.stdout.on("data", d => {
        if (this.child !== child) return;
        buffer += d;
        const lines = buffer.split(/\r?\n/); buffer = lines.pop();
        for (const line of lines) {
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.type === "ready") {
            clearTimeout(timer);
            this.update({ state: "ready", progress: 1, device: m.device, message: `Ready — ${m.device.startsWith("cuda") ? "GPU" : "CPU"}` });
            resolve();
          } else if (m.type === "init-error") fail(new Error(m.message));
          else if (m.type === "done" || m.type === "error") {
            const job = this.jobs.get(m.id);
            if (!job) continue;
            clearTimeout(job.timer); this.jobs.delete(m.id);
            m.type === "done" ? job.resolve() : job.reject(new Error(`OmniVoice: ${m.message}`));
          }
        }
      });
      this.cancel = () => fail(new Error("OmniVoice stopped"));
    });
    this.loading.catch(() => {});
    return this.loading;
  }
  async synth(text, file, { voice, speed }) {
    voice = resolveVoiceId(voice);
    if (!this.voices().some(([id]) => id === voice)) throw new Error("Unknown OmniVoice reference voice. It may have been removed; pick another voice.");
    await this.start();
    const id = ++this.seq;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stop(); reject(new Error("OmniVoice synthesis timed out")); }, 300000);
      this.jobs.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, text, file, voice, speed }) + "\n");
    });
  }
  stop() {
    this.cancel?.();
    this.update({ state: "idle", progress: 0, message: "Not loaded", device: undefined });
  }
}
