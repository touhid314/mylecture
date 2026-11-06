import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ComponentManager, COMPONENTS, kokoroModelFile, runHidden } from "../electron/components.js";

function harness({ platform = "win32", have = [], settings = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-components-"));
  const found = new Set(have);
  const runs = [];
  const tts = Object.assign(new EventEmitter(), {
    kokoro: { state: "idle" },
    status() { return { kokoro: this.kokoro }; },
    startKokoro() {
      this.kokoro = { state: "downloading", progress: 0.5 };
      this.emit("status", this.status());
      const file = kokoroModelFile(path.join(dir, "models"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "");
      fs.truncateSync(file, 301 * 1024 * 1024);
      this.kokoro = { state: "ready" };
      this.emit("status", this.status());
    },
  });
  let saved = { ...settings };
  const manager = new ComponentManager({
    userData: dir, modelDir: path.join(dir, "models"), tts, platform,
    getSettings: () => saved, saveSettings: (patch) => { saved = { ...saved, ...patch }; },
    resolvePython: (configured) => configured || "python",
    hasNvidiaGpu: () => found.has("nvidia-smi"),
    find: (names) => names.some(n => found.has(n)) ? `C:\\bin\\${names[0]}.exe` : null,
    run: async (file, args, opts) => {
      runs.push([file, ...args].join(" "));
      // Simulate what each official installer leaves behind.
      const joined = args.join(" ");
      if (/claude\.ai\/install/.test(joined)) { opts.onLine?.("Downloading Claude Code... 42%"); found.add("claude"); }
      if (/antigravity\.google/.test(joined)) found.add("agy");
      if (/OpenAI\.Codex|@openai\/codex/.test(joined)) found.add("codex");
      if (/astral\.sh\/uv/.test(joined)) { fs.mkdirSync(opts.env.UV_INSTALL_DIR, { recursive: true }); fs.writeFileSync(path.join(opts.env.UV_INSTALL_DIR, "uv.exe"), ""); }
      if (args[0] === "venv") { fs.mkdirSync(path.join(args.at(-1), "Scripts"), { recursive: true }); fs.writeFileSync(path.join(args.at(-1), "Scripts", "python.exe"), ""); }
      return [];
    },
  });
  const events = [];
  manager.on("progress", e => events.push(e));
  return { manager, runs, events, dir, found, settings: () => saved };
}

test("component list: engines and Kokoro ticked by default, OmniVoice not", () => {
  assert.deepEqual(COMPONENTS.map(c => [c.id, c.byDefault]), [["claude-code", true], ["codex", true], ["antigravity", true], ["hermes", false], ["kokoro", true], ["omnivoice", false]]);
});

test("engines install with the official installers, hidden, and are then found", async () => {
  const t = harness({ have: ["winget"] });
  for (const id of ["claude-code", "codex", "antigravity"]) await t.manager.install(id);
  assert.match(t.runs[0], /^powershell\.exe .*irm https:\/\/claude\.ai\/install\.ps1 \| iex$/);
  assert.match(t.runs[1], /^winget install --id OpenAI\.Codex --exact --source winget --silent/);
  assert.match(t.runs[2], /irm https:\/\/antigravity\.google\/cli\/install\.ps1 \| iex$/);
  assert.deepEqual(t.manager.status().filter(c => c.kind === "engine" && c.id !== "hermes").map(c => c.installed), [true, true, true]);
  assert.equal(t.events.at(-1).state, "done");
});

test("already-installed components are skipped; Codex falls back to npm, else explains", async () => {
  const t = harness({ have: ["claude", "npm"] });
  await t.manager.install("claude-code");
  assert.equal(t.runs.length, 0);
  assert.equal(t.manager.progress["claude-code"].message, "Already installed.");
  await t.manager.install("codex");
  assert.match(t.runs[0], /npm\.exe install -g @openai\/codex$/);

  const none = harness();
  await assert.rejects(none.manager.install("codex"), /needs winget \(Windows\) or Node\.js/);
  assert.equal(none.manager.progress.codex.state, "error");
});

test("an installer that leaves nothing behind is reported, not treated as success", async () => {
  const t = harness();
  t.manager.run = async () => [];
  await assert.rejects(t.manager.install("claude-code"), /cannot find it/);
});

test("Kokoro downloads its model through the voice service", async () => {
  const t = harness();
  assert.equal(t.manager.installed("kokoro"), false);
  await t.manager.install("kokoro");
  assert.equal(t.manager.installed("kokoro"), true);
  assert.ok(t.events.some(e => /Downloading the Kokoro voice… 50%/.test(e.message || "")));
});

test("OmniVoice: private uv + Python 3.11, CUDA PyTorch with an NVIDIA GPU, model, check, setting", async () => {
  const t = harness({ have: ["nvidia-smi"] });
  await t.manager.install("omnivoice");
  const steps = t.runs.join("\n");
  assert.match(steps, /astral\.sh\/uv\/install\.ps1/);
  assert.match(steps, /uv\.exe venv --python 3\.11 --seed .*omnivoice[\\/]env/);
  assert.match(steps, /pip install --python .*python\.exe torch==2\.5\.1 torchaudio==2\.5\.1 --index-url https:\/\/download\.pytorch\.org\/whl\/cu121/);
  assert.match(steps, /pip install --python .*python\.exe omnivoice==0\.2\.1 transformers==5\.15\.0 accelerate==1\.12\.0 huggingface_hub==1\.27\.0 soundfile/);
  assert.match(steps, /snapshot_download\('k2-fsa\/OmniVoice'\)/);
  assert.match(steps, /import torch, soundfile, omnivoice/);
  assert.equal(t.settings().omnivoicePython, t.manager.omniPython);
  assert.equal(t.manager.installed("omnivoice"), true);

  const cpu = harness();
  await cpu.manager.install("omnivoice");
  assert.match(cpu.runs.join("\n"), /whl\/cpu/);
});

test("installs run one at a time", async () => {
  const t = harness();
  let active = 0, peak = 0;
  t.manager.run = async (file, args) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; if (/claude/.test(args.join(" "))) t.found.add("claude"); if (/antigravity/.test(args.join(" "))) t.found.add("agy"); return []; };
  await Promise.all([t.manager.install("claude-code"), t.manager.install("antigravity")]);
  assert.equal(peak, 1);
});

test("runHidden reports lines and fails with the output tail", async () => {
  const lines = [];
  await runHidden(process.execPath, ["-e", "console.log('one'); console.error('two')"], { onLine: l => lines.push(l) });
  assert.deepEqual(lines.sort(), ["one", "two"]);
  await assert.rejects(runHidden(process.execPath, ["-e", "console.log('bad thing'); process.exit(3)"]), /exited with code 3: bad thing/);
});

test("OmniVoice reuses an installed uv and Python 3.10-3.12 instead of downloading them", async () => {
  const t = harness({ have: ["uv"] });
  const run = t.manager.run;
  t.manager.run = async (file, args, opts) => {
    if (args[0] === "python" && args[1] === "find") {
      t.runs.push([file, ...args].join(" "));
      return ["warning: something", "C:\\Python310\\python.exe"];
    }
    return run(file, args, opts);
  };
  await t.manager.install("omnivoice");
  const steps = t.runs.join("\n");
  assert.doesNotMatch(steps, /astral\.sh/);
  assert.match(steps, /^C:\\bin\\uv\.exe python find >=3\.10,<3\.13$/m);
  assert.match(steps, /uv\.exe venv --python C:\\Python310\\python\.exe --seed/);
});


test("installer output is forwarded live, and download percentages drive the bar", async () => {
  const t = harness({ have: [] });
  await t.manager.install("claude-code");
  const live = t.events.find((e) => e.id === "claude-code" && e.detail);
  assert.equal(live.detail, "Downloading Claude Code... 42%");
  assert.equal(live.percent, 42);
  assert.ok(live.startedAt > 0, "the popup can show elapsed time");
  const last = t.events.at(-1);
  assert.equal(last.state, "done");
  assert.equal(last.detail, "");
});

test("Hermes installs from its pinned release with uv: no git, locked packages, Python 3.14", async () => {
  const t = harness({ have: ["uv"] });
  const downloads = [];
  t.manager.download = async (url, file) => { downloads.push(url); fs.writeFileSync(file, "zip"); };
  const realRun = t.manager.run;
  t.manager.run = async (file, args, opts) => {
    if (/tar(\.exe)?$/i.test(file)) { fs.mkdirSync(path.join(args[3], "hermes-agent-0.23.0"), { recursive: true }); return []; }
    if (args[0] === "sync") {
      const exe = path.join(opts.env.UV_PROJECT_ENVIRONMENT, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "hermes.exe" : "hermes");
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, "");
    }
    return realRun(file, args, opts);
  };
  assert.equal(t.manager.installed("hermes"), false);
  await t.manager.install("hermes");
  assert.deepEqual(downloads, ["https://github.com/NousResearch/hermes-agent/archive/refs/tags/v0.23.0.zip"]);
  const sync = t.runs.find((r) => / sync /.test(r));
  assert.match(sync, /--frozen --no-dev --python 3\.14/);
  assert(!t.runs.some((r) => /git|hermes-agent\.nousresearch\.com\/install/.test(r)), "no git, no official installer");
  assert.equal(t.manager.installed("hermes"), true);
  assert.equal(t.events.at(-1).state, "done");
});

test("Hermes installs from the source bundled with the app: nothing but Python and packages is downloaded", async () => {
  const t = harness({ have: ["uv"] });
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "ml-hermes-bundle-"));
  fs.writeFileSync(path.join(bundle, "pyproject.toml"), "[project]\nname = \"hermes-agent\"\n");
  fs.writeFileSync(path.join(bundle, "MYLECTURE-HERMES-VERSION"), "0.23.0\n");
  t.manager.hermesSource = bundle;
  t.manager.download = async () => { throw new Error("must not download Hermes"); };
  const realRun = t.manager.run;
  t.manager.run = async (file, args, opts) => {
    assert(!/tar(\.exe)?$/i.test(file), "nothing to unpack");
    if (args[0] === "sync") {
      assert(fs.existsSync(path.join(args[2], "pyproject.toml")), "the bundled source is copied before uv runs");
      const exe = path.join(opts.env.UV_PROJECT_ENVIRONMENT, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "hermes.exe" : "hermes");
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, "");
    }
    return realRun(file, args, opts);
  };
  await t.manager.install("hermes");
  assert.equal(t.manager.installed("hermes"), true);
  assert(fs.existsSync(path.join(bundle, "pyproject.toml")), "the app's own copy is left untouched");

  // A bundle from another Hermes version is not used.
  fs.writeFileSync(path.join(bundle, "MYLECTURE-HERMES-VERSION"), "0.22.0\n");
  fs.rmSync(path.join(t.dir, "tools", "hermes"), { recursive: true, force: true });
  let downloaded = false;
  t.manager.download = async (url, file) => { downloaded = true; throw new Error("offline"); };
  await assert.rejects(t.manager.install("hermes"), /offline/);
  assert(downloaded);
});
