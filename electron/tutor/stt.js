// Speech-to-text for "hold Space to talk": a local Whisper model, loaded on
// first use and kept warm while the app runs.
import { utilityProcess } from "electron";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const STT_MODEL = "onnx-community/whisper-base.en";

export class SpeechToText extends EventEmitter {
  constructor({ modelDir }) {
    super();
    this.modelDir = modelDir;
    this.worker = null;
    this.state = { state: "idle", progress: 0, message: "" };
    this.jobs = new Map();
    this.seq = 0;
  }

  _set(patch) {
    Object.assign(this.state, patch);
    this.emit("status", { ...this.state });
  }

  start() {
    if (this.worker) return;
    this._set({ state: "loading", message: "Loading speech recognition…" });
    const w = utilityProcess.fork(path.join(here, "stt-worker.js"), [], { serviceName: "MyLecture Speech Recognition", stdio: "pipe" });
    this.worker = w;
    w.stdout?.on("data", () => {});
    w.stderr?.on("data", (d) => log("warn", "stt.stderr", { text: String(d).slice(0, 300) }));
    const files = {};
    w.on("message", (m) => {
      if (m.type === "progress") {
        files[m.file] = { loaded: m.loaded || 0, total: m.total || 0 };
        const tot = Object.values(files).reduce((a, f) => a + f.total, 0);
        const got = Object.values(files).reduce((a, f) => a + f.loaded, 0);
        this._set({ state: "downloading", progress: tot ? got / tot : 0, message: `Downloading speech recognition ${tot ? Math.round((100 * got) / tot) : 0}%` });
      } else if (m.type === "ready") {
        this._set({ state: "ready", progress: 1, message: "Speech recognition ready" });
      } else if (m.type === "init-error") {
        log("error", "stt.initFailed", { message: m.message });
        this._set({ state: "error", message: m.message });
      } else if (m.type === "done" || m.type === "error") {
        const job = this.jobs.get(m.id);
        this.jobs.delete(m.id);
        if (!job) return;
        if (m.type === "done") job.resolve(m.text);
        else job.reject(new Error(m.message));
      }
    });
    w.on("exit", (code) => {
      this.worker = null;
      for (const j of this.jobs.values()) j.reject(new Error("speech recognition stopped"));
      this.jobs.clear();
      if (this.state.state !== "error") this._set({ state: "idle", message: `Speech recognition stopped (${code})` });
    });
    w.postMessage({ type: "init", cacheDir: this.modelDir, model: STT_MODEL });
  }

  // pcm: Float32Array, 16 kHz mono
  transcribe(pcm) {
    this.start();
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.jobs.set(id, {
        resolve: (text) => {
          log("info", "stt.done", { ms: Date.now() - started, seconds: Math.round((pcm.length / 16000) * 10) / 10, chars: text.length });
          resolve(text);
        },
        reject,
      });
      const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
      this.worker.postMessage({ type: "transcribe", id, pcm: buf });
    });
  }

  stop() {
    try {
      this.worker?.kill();
    } catch {}
  }
}
