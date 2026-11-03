import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OmniVoice, OMNIVOICE_VOICES, resolveOmniPython } from "../electron/tts/omnivoice.js";

test("every advertised OmniVoice reference includes bundled audio and a transcript", () => {
  const base = fileURLToPath(new URL("../electron/tts/voices/", import.meta.url));
  for (const [id] of OMNIVOICE_VOICES) {
    const wav = fs.readFileSync(path.join(base, id, "reference.wav"));
    assert.equal(wav.toString("ascii", 0, 4), "RIFF", id);
    assert(wav.length > 1000, id);
    assert(fs.readFileSync(path.join(base, id, "transcript.txt"), "utf8").trim(), id);
  }
});

test("OmniVoice honors an explicit interpreter and surfaces startup failure without a fallback", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-omni-failure-"));
  const missing = path.join(dir, "missing-python.exe");
  const voice = new OmniVoice({ modelDir: dir, getSettings: () => ({ omnivoicePython: missing }) });
  try {
    assert.equal(resolveOmniPython(` ${missing} `), missing);
    await assert.rejects(voice.start(), /OmniVoice Python:.*ENOENT/);
    assert.equal(voice.status.state, "error");
    assert.equal(voice.child, null);
    assert.equal(voice.jobs.size, 0);
  } finally {
    voice.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("OmniVoice rejects staging failures and can retry after the directory is repaired", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-omni-staging-"));
  const modelDir = path.join(dir, "models");
  fs.writeFileSync(modelDir, "not a directory");
  const voice = new OmniVoice({
    modelDir,
    getSettings: () => ({ omnivoicePython: path.join(dir, "missing-python.exe") }),
  });
  try {
    let startup;
    assert.doesNotThrow(() => { startup = voice.start().catch(error => { throw error; }); });
    await assert.rejects(startup, /OmniVoice startup:.*(?:ENOTDIR|EEXIST|ENOENT)/);
    assert.equal(voice.status.state, "error");
    assert.match(voice.status.message, /OmniVoice startup:/);
    assert.equal(voice.child, null);
    assert.equal(voice.loading, null);
    assert.equal(voice.jobs.size, 0);

    fs.unlinkSync(modelDir);
    fs.mkdirSync(modelDir);
    // Reaching the missing interpreter proves staging recovered without inference.
    await assert.rejects(voice.start(), /OmniVoice Python:.*ENOENT/);
    assert(fs.existsSync(path.join(modelDir, "omnivoice-runtime", "worker.py")));
    assert(fs.existsSync(path.join(modelDir, "omnivoice-runtime", "voices", "maruf", "reference.wav")));
    assert.equal(voice.status.state, "error");
    assert.equal(voice.child, null);
    assert.equal(voice.loading, null);
    assert.equal(voice.jobs.size, 0);
  } finally {
    voice.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
