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
  assert.deepEqual(COMPONENTS.map(c => [c.id, c.byDefault]), [["claude-code", true], ["codex", true], ["antigravity", true], ["kokoro", true], ["omnivoice", false]]);
});

test("engines install with the official installers, hidden, and are then found", async () => {
  const t = harness({ have: ["winget"] });
  for (const id of ["claude-code", "codex", "antigravity"]) await t.manager.install(id);
  assert.match(t.runs[0], /^powershell\.exe .*irm https:\/\/claude\.ai\/install\.ps1 \| iex$/);
  assert.match(t.runs[1], /^winget install --id OpenAI\.Codex --exact --source winget --silent/);
  assert.match(t.runs[2], /irm https:\/\/antigravity\.google\/cli\/install\.ps1 \| iex$/);
  assert.deepEqual(t.manager.status().filter(c => c.kind === "engine").map(c => c.installed), [true, true, true]);
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
