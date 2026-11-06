// Optional components MyLecture can install for the user: the AI engine CLIs
// (Claude Code, Codex, Antigravity) and the voices (Kokoro model, OmniVoice).
// One implementation serves the Windows installer's checkbox page (which runs
// the app with --setup-components=...), Settings and the welcome screen.
// Everything uses the providers' official installers or packages, runs hidden
// (no terminal windows), reports progress and logs output for diagnosis.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { findExecutable, killTree } from "./engines/cli-util.js";
import { resolveOmniPython } from "./tts/omnivoice.js";
import { hermesDirs } from "./engines/hermes.js";

const WIN = process.platform === "win32";

export const COMPONENTS = [
  { id: "claude-code", kind: "engine", title: "Claude", detail: "Claude Code. Needs a Claude Pro or Max plan.", size: "about 250 MB", byDefault: true },
  { id: "codex", kind: "engine", title: "GPT", detail: "Codex. Needs a ChatGPT Plus, Pro, Business or Enterprise plan.", size: "about 450 MB", byDefault: true },
  { id: "antigravity", kind: "engine", title: "Gemini", detail: "Antigravity CLI. Needs a Google account.", size: "about 250 MB", byDefault: true },
  { id: "hermes", kind: "engine", title: "Hermes Agent", detail: "Makes videos with your own API key (Use with API key).", size: "about 700 MB", byDefault: false },
  { id: "kokoro", kind: "voice", title: "Kokoro voice", detail: "Fast, natural voice. The default.", size: "about 325 MB", byDefault: true },
  { id: "omnivoice", kind: "voice", title: "OmniVoice", detail: "High-quality, expressive voice. Best with an NVIDIA graphics card.", size: "about 6 GB", byDefault: false },
];
export const COMPONENT_IDS = COMPONENTS.map(c => c.id);

const ENGINE_BIN = { "claude-code": "claude", codex: "codex", antigravity: "agy", hermes: "hermes" };
const PS = (script) => ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]];
const SH = (script) => ["/bin/bash", ["-lc", script]];

// Runs a command hidden; resolves on exit code 0, otherwise rejects with the
// output's last lines. Every line goes to onLine for progress and the log.
export function runHidden(file, args, { env, onLine = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // Windows .cmd shims (npm.cmd) only run through a shell; our arguments
      // are fixed strings without spaces or shell characters.
      const shell = WIN && /\.(cmd|bat)$/i.test(file);
      const options = { windowsHide: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] };
      child = shell ? spawn(`"${file}" ${args.join(" ")}`, { ...options, shell: true }) : spawn(file, args, options);
    } catch (error) { reject(error); return; }
    const tail = [];
    const onAbort = () => killTree(child);
    signal?.addEventListener("abort", onAbort, { once: true });
    const feed = (chunk) => {
      for (const raw of String(chunk).split(/\r?\n|\r/)) {
        const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
        if (!line) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        onLine(line);
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (error) => { signal?.removeEventListener("abort", onAbort); reject(error); });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(new Error("Cancelled."));
      if (code === 0) resolve(tail);
      else reject(new Error(`${path.basename(file)} exited with code ${code}: ${tail.slice(-6).join(" | ")}`));
    });
  });
}

export function kokoroModelFile(modelDir) {
  return path.join(modelDir, "onnx-community", "Kokoro-82M-v1.0-ONNX", "onnx", "model.onnx");
}

export class ComponentManager extends EventEmitter {
  constructor({ userData, modelDir, tts, getSettings, saveSettings, log = () => {}, run = runHidden, find = findExecutable, platform = process.platform, resolvePython = resolveOmniPython, hasNvidiaGpu }) {
    super();
    Object.assign(this, { userData, modelDir, tts, getSettings, saveSettings, log, run, find, platform, resolvePython });
    this.hasNvidiaGpu = hasNvidiaGpu || (() => platform !== "darwin" && !!(find(["nvidia-smi"]) || (platform === "win32" && fs.existsSync("C:\\Windows\\System32\\nvidia-smi.exe"))));
    this.toolsDir = path.join(userData, "tools");
    this.omniDir = path.join(userData, "omnivoice");
    this.progress = {};
    this.queue = Promise.resolve();
  }

  get omniPython() { return path.join(this.omniDir, "env", this.platform === "win32" ? "Scripts/python.exe" : "bin/python"); }
  get omniMarker() { return path.join(this.omniDir, "installed.json"); }

  installed(id) {
    if (ENGINE_BIN[id]) return !!this.find([ENGINE_BIN[id]], id === "hermes" ? hermesDirs() : undefined);
    if (id === "kokoro") {
      try { return fs.statSync(kokoroModelFile(this.modelDir)).size > 300 * 1024 * 1024; } catch { return false; }
    }
    if (id === "omnivoice") {
      if (fs.existsSync(this.omniMarker) && fs.existsSync(this.omniPython)) return true;
      const py = this.resolvePython(this.getSettings().omnivoicePython || "");
      return path.isAbsolute(py) && fs.existsSync(py);
    }
    return false;
  }

  status() {
    return COMPONENTS.map(c => ({ ...c, installed: this.installed(c.id), progress: this.progress[c.id] || null }));
  }

  _update(id, patch) {
    this.progress[id] = { ...(this.progress[id] || {}), ...patch };
    this.emit("progress", { id, ...this.progress[id] });
  }

  // Installs one component (queued: one at a time). Resolves when done.
  install(id, { signal } = {}) {
    if (!COMPONENT_IDS.includes(id)) return Promise.reject(new Error("Unknown component"));
    if (this.progress[id]?.state === "installing") return this.progress[id].promise;
    const promise = this.queue.then(() => this._install(id, signal));
    this.queue = promise.catch(() => {});
    this._update(id, { state: "installing", message: "Waiting…", percent: null, detail: "", startedAt: Date.now(), promise });
    return promise;
  }

  async _install(id, signal) {
    const title = COMPONENTS.find(c => c.id === id).title;
    const step = (message, percent = null) => this._update(id, { state: "installing", message, percent, detail: "" });
    // The installer's own output is shown live (latest line) so long installs
    // visibly progress. Engine installers print download percentages; those
    // drive the bar. OmniVoice's steps set the bar themselves.
    let lastSent = 0, pending = null, timer = null;
    const flush = () => { timer = null; if (pending) { this._update(id, pending); pending = null; lastSent = Date.now(); } };
    const onLine = (line) => {
      this.log("info", "component.output", { id, line: line.slice(0, 300) });
      const detail = line.slice(0, 200);
      const pct = ENGINE_BIN[id] ? /(\d{1,3}(?:\.\d+)?)\s?%/.exec(line) : null;
      pending = { ...(pending || {}), detail, ...(pct && Number(pct[1]) <= 100 ? { percent: Math.min(99, Math.round(Number(pct[1]))) } : {}) };
      if (Date.now() - lastSent >= 250) flush();
      else timer ||= setTimeout(flush, 250);
    };
    this.log("info", "component.install", { id });
    try {
      if (this.installed(id)) {
        this._update(id, { state: "done", message: "Already installed.", percent: 100 });
        return;
      }
      if (ENGINE_BIN[id]) await this._installEngine(id, step, onLine, signal);
      else if (id === "kokoro") await this._installKokoro(step);
      else await this._installOmniVoice(step, onLine, signal);
      if (!this.installed(id)) throw new Error(`${title} was installed but MyLecture cannot find it. Restart MyLecture and check again.`);
      this.log("info", "component.installed", { id });
      clearTimeout(timer); pending = null;
      this._update(id, { state: "done", message: "Installed.", percent: 100, detail: "" });
    } catch (error) {
      this.log("error", "component.failed", { id, error: String(error.message || error) });
      clearTimeout(timer); pending = null;
      this._update(id, { state: "error", message: String(error.message || error), percent: null, detail: "" });
      throw error;
    }
  }

  async _installEngine(id, step, onLine, signal) {
    const win = this.platform === "win32";
    let cmd;
    if (id === "claude-code") {
      step("Installing Claude Code with Anthropic's installer…");
      cmd = win ? PS("irm https://claude.ai/install.ps1 | iex") : SH("curl -fsSL https://claude.ai/install.sh | bash");
    } else if (id === "hermes") {
      step("Installing Hermes Agent with Nous Research's installer…");
      // Official installer, unattended; no browser or computer-use extras.
      cmd = win
        ? PS("& ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -NonInteractive -SkipSetup -SkipBrowser -SkipComputerUse")
        : SH("curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive --skip-browser");
    } else if (id === "antigravity") {
      step("Installing the Antigravity CLI with Google's installer…");
      cmd = win ? PS("irm https://antigravity.google/cli/install.ps1 | iex") : SH("curl -fsSL https://antigravity.google/cli/install.sh | bash");
    } else if (win && this.find(["winget"])) {
      step("Installing Codex from OpenAI's winget package (large download)…");
      cmd = ["winget", ["install", "--id", "OpenAI.Codex", "--exact", "--source", "winget", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]];
    } else if (this.find(["npm"])) {
      step("Installing Codex from npm…");
      cmd = [this.find(["npm"]), ["install", "-g", "@openai/codex"]];
    } else {
      throw new Error("Installing Codex needs winget (Windows) or Node.js. Install one of them, then try again.");
    }
    await this.run(cmd[0], cmd[1], { onLine, signal });
  }

  _installKokoro(step) {
    const tts = this.tts;
    return new Promise((resolve, reject) => {
      const check = (st = tts.status()) => {
        const k = st.kokoro;
        if (k.state === "ready") { tts.off("status", check); resolve(); }
        else if (k.state === "error") { tts.off("status", check); reject(new Error(k.message || "The Kokoro voice could not be downloaded.")); }
        else step(k.state === "downloading" ? `Downloading the Kokoro voice… ${Math.round((k.progress || 0) * 100)}%` : "Preparing the Kokoro voice…", k.state === "downloading" ? Math.round((k.progress || 0) * 100) : null);
      };
      tts.on("status", check);
      if (tts.kokoro.state === "error" && tts.retryKokoro) tts.retryKokoro();
      else tts.startKokoro();
      check();
    });
  }

  async _installOmniVoice(step, onLine, signal) {
    const win = this.platform === "win32";
    const env = {
      UV_INSTALL_DIR: path.join(this.toolsDir, "uv"), UV_NO_MODIFY_PATH: "1",
      UV_PYTHON_INSTALL_DIR: path.join(this.toolsDir, "python"),
      UV_CACHE_DIR: path.join(this.toolsDir, "uv-cache"), UV_LINK_MODE: "copy",
      PYTHONIOENCODING: "utf-8",
    };
    fs.mkdirSync(this.toolsDir, { recursive: true });
    // Use uv if it is already installed; otherwise get a private copy.
    const privateUv = path.join(env.UV_INSTALL_DIR, win ? "uv.exe" : "uv");
    let uvExe = fs.existsSync(privateUv) ? privateUv : this.find(["uv"]);
    if (!uvExe) {
      step("Getting the Python installer (uv)…", 2);
      const [f, a] = win ? PS("irm https://astral.sh/uv/install.ps1 | iex") : SH("curl -LsSf https://astral.sh/uv/install.sh | sh");
      await this.run(f, a, { env, onLine, signal });
      uvExe = privateUv;
    }
    const uv = (args, more = {}) => this.run(uvExe, args, { env: { ...env, ...more }, onLine, signal });
    const envDir = path.join(this.omniDir, "env");
    if (!fs.existsSync(this.omniPython)) {
      // Reuse a Python 3.10-3.12 already on the computer (PyTorch 2.5.1 and
      // OmniVoice support these); download Python 3.11 only if there is none.
      let python = null;
      try { python = (await uv(["python", "find", ">=3.10,<3.13"])).findLast((l) => /python(3(\.\d+)?)?(\.exe)?$/i.test(l)) || null; } catch {}
      step(python ? "Using the Python already on this computer…" : "Installing Python 3.11…", 5);
      await uv(["venv", "--python", python || "3.11", "--seed", envDir]);
    }
    const gpu = this.hasNvidiaGpu();
    step(gpu ? "Installing PyTorch for your NVIDIA graphics card (about 2.5 GB)…" : "Installing PyTorch (CPU)…", 10);
    const torchIndex = this.platform === "darwin" ? [] : ["--index-url", `https://download.pytorch.org/whl/${gpu ? "cu121" : "cpu"}`];
    await uv(["pip", "install", "--python", this.omniPython, "torch==2.5.1", "torchaudio==2.5.1", ...torchIndex]);
    step("Installing OmniVoice…", 45);
    // Versions known to work together with torch 2.5.1 (newer transformers fails to import).
    await uv(["pip", "install", "--python", this.omniPython, "omnivoice==0.2.1", "transformers==5.15.0", "accelerate==1.12.0", "huggingface_hub==1.27.0", "soundfile"]);
    step("Downloading the OmniVoice model (about 3 GB)…", 60);
    await this.run(this.omniPython, ["-c", "from huggingface_hub import snapshot_download; snapshot_download('k2-fsa/OmniVoice')"], { env, onLine, signal });
    step("Checking OmniVoice…", 95);
    await this.run(this.omniPython, ["-c", "import torch, soundfile, omnivoice; print('cuda' if torch.cuda.is_available() else 'cpu')"], { env, onLine, signal });
    try { fs.rmSync(env.UV_CACHE_DIR, { recursive: true, force: true }); } catch {}
    fs.writeFileSync(this.omniMarker, JSON.stringify({ installedAt: new Date().toISOString(), gpu }) + "\n");
    this.saveSettings({ omnivoicePython: this.omniPython });
  }
}
