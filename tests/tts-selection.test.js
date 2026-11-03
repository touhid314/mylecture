import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";

// Keep Electron and DOM rendering inert; exercise the actual selection/synth code.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: "test:electron-tts", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "test:electron-tts") return {
      format: "module", shortCircuit: true,
      source: 'export const utilityProcess = { fork() { throw new Error("Unexpected real worker"); } };',
    };
    if (url.endsWith("/app/js/ui.js")) return {
      format: "module", shortCircuit: true,
      source: `export function h(tag, attrs = {}, ...children) {
        return { tag, style: {}, ...attrs, children: children.flat().filter(x => x != null),
          replaceChildren(...next) { this.children = next; } };
      }
      export const icon = name => name;
      export const toast = () => {};
      export const bus = {};`,
    };
    return nextLoad(url, context);
  },
});
const { TTSService, pcmToWav } = await import("../electron/tts/index.js");
const { SettingsView } = await import("../app/js/settings.js");
hooks.deregister();

function service(settings, dir) {
  const tts = Object.assign(new EventEmitter(), {
    getSettings: () => settings, cacheDir: dir,
    kokoro: { state: "loading", progress: 0, message: "Loading" },
    omni: { status: { state: "idle" } }, sapi: { voices: [] },
    worker: {}, inflight: new Map(),
  });
  Object.setPrototypeOf(tts, TTSService.prototype);
  return tts;
}

test("selected neural engine never changes with Kokoro readiness or legacy settings", () => {
  for (const state of ["idle", "loading", "downloading", "ready", "error"]) {
    for (const selected of [undefined, "system", "kokoro", "omnivoice"]) {
      const tts = service({ voiceEngine: selected });
      tts.kokoro.state = state;
      assert.equal(tts.activeEngine(), selected === "omnivoice" ? "omnivoice" : "kokoro");
    }
  }
});

test("Kokoro synthesis waits for readiness, surfaces load failure, and preserves explicit system requests", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-tts-selection-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tts = service({ voiceEngine: "system" }, dir);
  let neuralCalls = 0;
  let systemCalls = 0;
  tts._kokoroSynth = async () => {
    neuralCalls++;
    return { pcm: new Int16Array(2400).fill(500), sampleRate: 24000 };
  };
  tts.sapi.synthToFile = async (_text, file) => {
    systemCalls++;
    fs.writeFileSync(file, pcmToWav(new Int16Array(2400), 24000));
  };
  const pending = tts.synth("Wait for Kokoro");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(neuralCalls, 0);
  assert.equal(systemCalls, 0);
  tts._setKokoro({ state: "ready" });
  assert.equal((await pending).engine, "kokoro");
  assert.equal(neuralCalls, 1);
  assert.equal(tts.listenerCount("status"), 0);

  tts._setKokoro({ state: "loading" });
  const failed = tts.synth("Expose neural initialization error");
  const rejection = assert.rejects(failed, /Model initialization failed/);
  tts._setKokoro({ state: "error", message: "Model initialization failed" });
  await rejection;
  assert.equal(systemCalls, 0);
  assert.equal(tts.listenerCount("status"), 0);
  assert.equal((await tts.synth("Explicit legacy voice", { engine: "system" })).engine, "system");
  assert.equal(systemCalls, 1);
});

test("Settings displays Kokoro for legacy system selections and retains honest load errors", () => {
  const view = Object.create(SettingsView.prototype);
  view.state = { settings: { voiceEngine: "system" } };
  view.voices = { kokoro: [["af_heart", "Heart"]], system: ["Legacy voice"] };
  const card = view._voiceCard();
  const nodes = [];
  const walk = node => {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    node.children?.forEach(walk);
  };
  walk(card);
  assert.equal(nodes.find(node => node.tag === "button" && node.children.includes("Kokoro")).class, "on");
  assert(!JSON.stringify(card).includes("Windows"));
  assert(!JSON.stringify(card).includes("Legacy voice"));
  assert(nodes.some(node => node.children.includes("Neural voice")));
  view._ttsStatus({ kokoro: { state: "loading" } });
  assert.equal(view.ttsMsg.textContent, "Loading...");
  view._ttsStatus({ kokoro: { state: "error", message: "Missing model" } });
  assert.match(JSON.stringify(view.ttsMsg.children), /Error: Missing model/);
});
