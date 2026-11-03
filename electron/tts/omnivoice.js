import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { killTree } from "../engines/cli-util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const OMNIVOICE_VOICES = [
  ["maruf", "Maruf"], ["mike", "Mike"],
  ["american-male-1", "American male 1"], ["american-male-2", "American male 2"],
  ["american-male-3", "American male 3"], ["johnny-harris", "Johnny Harris"],
];

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
  constructor({ modelDir, getSettings }) {
    super();
    this.modelDir = modelDir;
    this.getSettings = getSettings;
    this.status = { state: "idle", progress: 0, message: "Not loaded" };
    this.jobs = new Map();
    this.seq = 0;
  }
  update(patch) { Object.assign(this.status, patch); this.emit("status"); }
  start() {
    if (this.loading) return this.loading;
    this.update({ state: "loading", message: "Loading OmniVoice locally…", progress: 0 });
    let child;
    try {
      // Python cannot read inside Electron's ASAR; stage bundled runtime assets.
      const runtime = path.join(this.modelDir, "omnivoice-runtime");
      fs.mkdirSync(runtime, { recursive: true });
      fs.copyFileSync(path.join(here, "omnivoice-worker.py"), path.join(runtime, "worker.py"));
      fs.cpSync(path.join(here, "voices"), path.join(runtime, "voices"), { recursive: true });
      child = spawn(resolveOmniPython(this.getSettings().omnivoicePython), ["-u", path.join(runtime, "worker.py")], {
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", ML_OMNIVOICE_VOICES: path.join(runtime, "voices") },
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
    if (!OMNIVOICE_VOICES.some(([id]) => id === voice)) throw new Error("Unknown OmniVoice reference voice");
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
