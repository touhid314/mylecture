import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DEMO_TEXT, demoFile, readDemo, kokoroDemoFile } from "../electron/tts/demos.js";
import { OMNIVOICE_VOICES, OmniVoice } from "../electron/tts/omnivoice.js";

const src = fs.readFileSync(new URL("../electron/tts/index.js", import.meta.url), "utf8");
const KOKORO = [...src.slice(src.indexOf("KOKORO_VOICES"), src.indexOf("];", src.indexOf("KOKORO_VOICES"))).matchAll(/\["([a-z]{2}_\w+)"/g)].map((m) => m[1]);

test("every bundled voice ships a saved demo, so play never generates", () => {
  assert(KOKORO.length >= 10);
  for (const v of KOKORO) assert(fs.existsSync(kokoroDemoFile(v)), `missing Kokoro demo: ${v}`);
  // Voices that ship (electron/tts/voices); dev-only voices in voices-dev get their demo on first play.
  const shipped = OMNIVOICE_VOICES.filter(([id]) => fs.existsSync(new URL(`../electron/tts/voices/${id}/reference.wav`, import.meta.url)));
  assert(shipped.length >= 4);
  for (const [id, name] of shipped) {
    assert(!name.includes(" - "), `voice labels should contain only names: ${name}`);
    assert(fs.existsSync(demoFile("omnivoice", id)), `missing OmniVoice demo: ${id}`);
    const folder = new URL(`../electron/tts/voices/${id}/`, import.meta.url);
    assert(fs.readFileSync(new URL("transcript.txt", folder), "utf8").trim(), `missing reference transcript: ${id}`);
    const wav = fs.readFileSync(new URL("reference.wav", folder));
    assert.equal(wav.readUInt32LE(24), 24000, `reference must be 24 kHz: ${id}`);
    assert.equal(wav.readUInt16LE(22), 1, `reference must be mono: ${id}`);
  }
  assert.match(readDemo("kokoro", KOKORO[0]), /^data:audio\/mpeg;base64,/);
});

test("demo lookup rejects unsafe ids and unknown engines", () => {
  assert.equal(demoFile("kokoro", "../x"), null);
  assert.equal(demoFile("system", "af_heart"), null);
  assert.equal(readDemo("omnivoice", "custom-doesnotexist", os.tmpdir()), null);
});

test("generated OmniVoice references and previews use the shared narration-purpose script", () => {
  const root = new URL("../electron/tts/voices/", import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL("generated-references.json", root), "utf8"));
  assert.equal(manifest.generator, "OmniVoice");
  assert.match(manifest.text, /narrate lessons, explainers, and stories in MyLecture/);
  assert.equal(manifest.voices.length, 23);
  for (const voice of manifest.voices) {
    const folder = new URL(`${voice.id}/`, root);
    assert.equal(fs.readFileSync(new URL("transcript.txt", folder), "utf8").trim(), manifest.text);
    for (const [file, expected] of [["reference.wav", voice.referenceSha256], ["demo.mp3", voice.demoSha256]]) {
      assert.equal(crypto.createHash("sha256").update(fs.readFileSync(new URL(file, folder))).digest("hex"), expected, `${voice.id}: ${file}`);
    }
  }
});

test("adding an own voice records its demo into the voice folder", async () => {
  const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-demo-voices-"));
  const omni = new OmniVoice({ modelDir: os.tmpdir(), getSettings: () => ({}), customDir });
  const spoken = [];
  // Stand-in for the model: write a short valid WAV for the requested text.
  omni.synth = async (text, file) => {
    spoken.push(text);
    const pcm = Buffer.alloc(24000 * 2);
    const head = Buffer.alloc(44);
    head.write("RIFF", 0); head.writeUInt32LE(36 + pcm.length, 4); head.write("WAVEfmt ", 8);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(24000, 24);
    head.writeUInt32LE(48000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(file, Buffer.concat([head, pcm]));
  };
  const sample = fs.readFileSync(demoFile("omnivoice", OMNIVOICE_VOICES[0][0]));
  const [id] = await omni.addVoice({ name: "Mine", transcript: "Hello! This is my voice. Let's learn something new together.", data: sample, ext: ".mp3" }, DEMO_TEXT);
  assert.deepEqual(spoken, [DEMO_TEXT]);
  assert(fs.existsSync(path.join(customDir, id, "demo.mp3")));
  assert.match(readDemo("omnivoice", id, customDir), /^data:audio\/mpeg;base64,/);
});
