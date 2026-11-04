// Local Kokoro and OmniVoice speech, with explicit legacy Windows voice support.
// Audio is cached by content hash, so replays and re-exports are free.
import { utilityProcess } from "electron";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SapiVoice } from "./sapi.js";
import { OmniVoice, OMNIVOICE_VOICES } from "./omnivoice.js";
import { log } from "../logger.js";
export { OMNIVOICE_VOICES };

const here = path.dirname(fileURLToPath(import.meta.url));

export const KOKORO_VOICES = [
  ["af_heart", "Heart (US, female)"],
  ["af_bella", "Bella (US, female)"],
  ["af_nicole", "Nicole (US, female, soft)"],
  ["af_sarah", "Sarah (US, female)"],
  ["am_michael", "Michael (US, male)"],
  ["am_fenrir", "Fenrir (US, male)"],
  ["am_puck", "Puck (US, male)"],
  ["bf_emma", "Emma (UK, female)"],
  ["bm_george", "George (UK, male)"],
  ["bm_fable", "Fable (UK, male)"],
];

export function normalizeForSpeech(text) {
  return String(text || "")
    .replace(/[*_`#]/g, "")
    .replace(/\s*→\s*/g, " to ")
    .replace(/\s*⇒\s*/g, " implies ")
    .replace(/≈/g, " approximately ")
    .replace(/×/g, " times ")
    .replace(/÷/g, " divided by ")
    .replace(/≤/g, " less than or equal to ")
    .replace(/≥/g, " greater than or equal to ")
    .replace(/≠/g, " not equal to ")
    .replace(/√/g, " square root of ")
    .replace(/π/g, " pi ")
    .replace(/θ/g, " theta ")
    .replace(/λ/g, " lambda ")
    .replace(/Δ/g, " delta ")
    .replace(/∑/g, " the sum of ")
    .replace(/∞/g, " infinity ")
    .replace(/(\w)\^2\b/g, "$1 squared")
    .replace(/(\w)\^3\b/g, "$1 cubed")
    .replace(/²/g, " squared")
    .replace(/³/g, " cubed")
    .replace(/\s+/g, " ")
    .trim();
}

export function wavInfo(buf) {
  // Walk RIFF chunks; returns {sampleRate, channels, bits, dataBytes}.
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === "data") {
      if (off + 8 + size > buf.length) size = buf.length - off - 8;
      return fmt ? { ...fmt, dataOffset: off + 8, dataBytes: size } : null;
    }
    off += 8 + size + (size & 1);
  }
  return null;
}

export function wavDuration(file) {
  try {
    const info = wavInfo(fs.readFileSync(file));
    if (!info) return 0;
    return info.dataBytes / (info.sampleRate * info.channels * (info.bits / 8));
  } catch {
    return 0;
  }
}

export function pcmToWav(pcm16, sampleRate) {
  const data = Buffer.from(pcm16.buffer ? pcm16.buffer : pcm16);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export class TTSService extends EventEmitter {
  constructor({ cacheDir, modelDir, getSettings }) {
    super();
    this.cacheDir = cacheDir;
    this.modelDir = modelDir;
    this.getSettings = getSettings;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });
    this.kokoro = { state: "idle", progress: 0, message: "" };
    this.worker = null;
    this.jobs = new Map();
    this.seq = 0;
    this.sapi = new SapiVoice();
    this.omni = new OmniVoice({ modelDir, getSettings });
    this.omni.on("status", () => this.emit("status", this.status()));
    this.inflight = new Map();
  }

  status() {
    return { kokoro: this.kokoro, omnivoice: this.omni.status, sapiVoices: this.sapi.voices };
  }

  _setKokoro(patch) {
    Object.assign(this.kokoro, patch);
    this.emit("status", this.status());
  }

  startKokoro() {
    if (this.worker) return;
    this._setKokoro({ state: "loading", message: "Loading neural voice…" });
    const w = utilityProcess.fork(path.join(here, "kokoro-worker.js"), [], { serviceName: "MyLecture Voice", stdio: "pipe" });
    this.worker = w;
    w.stdout?.on("data", () => {});
    w.stderr?.on("data", (d) => console.error("[kokoro]", String(d).trim().slice(0, 300)));
    const files = {};
    w.on("message", (m) => {
      if (m.type === "progress") {
        files[m.file] = { loaded: m.loaded || 0, total: m.total || 0 };
        const tot = Object.values(files).reduce((a, f) => a + f.total, 0);
        const got = Object.values(files).reduce((a, f) => a + f.loaded, 0);
        this._setKokoro({ state: "downloading", progress: tot ? got / tot : 0, message: `Downloading neural voice ${tot ? Math.round((100 * got) / tot) : 0}%` });
      } else if (m.type === "ready") {
        this._setKokoro({ state: "ready", progress: 1, message: "Neural voice ready" });
      } else if (m.type === "init-error") {
        this._setKokoro({ state: "error", message: m.message });
      } else if (m.type === "done" || m.type === "error") {
        const job = this.jobs.get(m.id);
        this.jobs.delete(m.id);
        if (!job) return;
        if (m.type === "done") job.resolve({ pcm: new Int16Array(m.pcm), sampleRate: m.sampleRate });
        else job.reject(new Error(m.message));
      }
    });
    w.on("exit", (code) => {
      this.worker = null;
      for (const j of this.jobs.values()) j.reject(new Error("voice worker exited"));
      this.jobs.clear();
      if (this.kokoro.state !== "error") this._setKokoro({ state: "error", message: `Voice worker exited (${code})` });
    });
    w.postMessage({ type: "init", cacheDir: this.modelDir, dtype: "fp32" });
  }

  _kokoroSynth(text, voice, speed) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ type: "synth", id, text, voice, speed });
    });
  }

  // Honor the selected neural engine while it loads; legacy settings use Kokoro.
  activeEngine() {
    const s = this.getSettings();
    return s.voiceEngine === "omnivoice" ? "omnivoice" : "kokoro";
  }

  keyFor(text, engine, voice, speed) {
    return crypto.createHash("sha1").update(`${engine}|${voice}|${speed}|${text}`).digest("hex").slice(0, 20);
  }

  fileFor(key) {
    return path.join(this.cacheDir, key + ".wav");
  }

  // spokenText is the exact normalized string submitted to the voice engine.
  // -> {key, file, dur, engine, spokenText}
  async synth(rawText, opts = {}) {
    const s = this.getSettings();
    const text = normalizeForSpeech(rawText);
    const engine = opts.engine || this.activeEngine();
    const speed = opts.speed || s.voiceSpeed || 1;
    if (!["kokoro", "omnivoice", "system"].includes(engine)) throw new Error(`Unknown voice engine: ${engine}`);
    const voice = engine === "kokoro" ? opts.voice || s.voice || "af_heart"
      : engine === "omnivoice" ? opts.voice || s.omnivoiceVoice || "maruf" : opts.systemVoice || s.systemVoice || "";
    const key = this.keyFor(text, engine, voice, speed);
    const started = Date.now();
    log("info", "tts.request", { engine, voice, speed, key, characters: text.length });
    const file = this.fileFor(key);
    if (fs.existsSync(file)) {
      const dur = wavDuration(file);
      if (dur > 0) {
        log("info", "tts.cacheHit", { engine, key, durationSeconds: dur });
        return { key, file, dur, engine, spokenText: text };
      }
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = (async () => {
      if (!text) {
        fs.writeFileSync(file, pcmToWav(new Int16Array(2400), 24000));
      } else if (engine === "kokoro") {
        if (!this.worker) this.startKokoro();
        if (this.kokoro.state !== "ready") await this._waitKokoro();
        const { pcm, sampleRate } = await this._kokoroSynth(text, voice, speed);
        fs.writeFileSync(file, pcmToWav(trimSilence(pcm, sampleRate), sampleRate));
      } else if (engine === "omnivoice") {
        const tmp = file + ".tmp.wav";
        try {
          await this.omni.synth(text, tmp, { voice, speed });
          if (!(wavDuration(tmp) > 0)) throw new Error("OmniVoice produced an invalid audio file");
          fs.renameSync(tmp, file);
        } finally { fs.rmSync(tmp, { force: true }); }
      } else {
        const tmp = file + ".tmp.wav";
        await this.sapi.synthToFile(text, tmp, { speed, voice });
        fs.renameSync(tmp, file);
      }
      return { key, file, dur: wavDuration(file), engine, spokenText: text };
    })();
    this.inflight.set(key, job);
    try {
      const result = await job;
      log("info", "tts.done", { engine, key, durationMs: Date.now() - started, audioSeconds: result.dur });
      return result;
    } catch (error) {
      log("error", "tts.failed", { engine, key, durationMs: Date.now() - started, error });
      throw error;
    } finally {
      this.inflight.delete(key);
    }
  }

  _waitKokoro() {
    return new Promise((resolve, reject) => {
      const on = (st) => {
        if (st.kokoro.state === "ready") {
          this.off("status", on);
          resolve();
        } else if (st.kokoro.state === "error") {
          this.off("status", on);
          reject(new Error(st.kokoro.message));
        }
      };
      this.on("status", on);
      on(this.status());
    });
  }

  retryKokoro() {
    try {
      this.worker?.kill();
    } catch {}
    this.worker = null;
    try {
      fs.rmSync(path.join(this.modelDir, "onnx-community"), { recursive: true, force: true });
    } catch {}
    this._setKokoro({ state: "loading", progress: 0, message: "Retrying neural voice download..." });
    this.startKokoro();
  }

  stop() {
    this.omni.stop();
    try {
      this.worker?.kill();
    } catch {}
    this.sapi.stop();
  }
}

// Kokoro adds a little silence at both ends; trimming keeps pacing snappy.
function trimSilence(pcm, sr) {
  const thr = 300;
  let a = 0,
    b = pcm.length - 1;
  while (a < b && Math.abs(pcm[a]) < thr) a++;
  while (b > a && Math.abs(pcm[b]) < thr) b--;
  a = Math.max(0, a - Math.round(sr * 0.04));
  b = Math.min(pcm.length - 1, b + Math.round(sr * 0.12));
  return pcm.slice(a, b + 1);
}
