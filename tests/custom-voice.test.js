import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { addCustomVoice, customVoices, removeCustomVoice, OMNIVOICE_VOICES, OmniVoice } from "../electron/tts/omnivoice.js";

const ff = createRequire(import.meta.url)("ffmpeg-static");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ml-voices-test-"));
function clip(seconds, ext = ".mp3") {
  const file = path.join(tmp(), "clip" + ext);
  // A loud tone stands in for speech; silence padding checks the trimming.
  const r = spawnSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=f=220:d=${seconds}`, "-af", "adelay=1000,apad=pad_dur=1", "-ac", "2", "-ar", "44100", file]);
  assert.equal(r.status, 0, String(r.stderr));
  return fs.readFileSync(file);
}

test("a recording becomes a 24 kHz mono reference voice that OmniVoice lists", async () => {
  const dir = tmp();
  const [id, name] = await addCustomVoice(dir, { name: "  Glenn  ", transcript: "Hello, this is my voice for MyLecture.", data: clip(6), ext: ".mp3" });
  assert.match(id, /^custom-[0-9a-f]{12}$/);
  assert.equal(name, "Glenn");
  const wav = fs.readFileSync(path.join(dir, id, "reference.wav"));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(22), 1, "mono");
  assert.equal(wav.readUInt32LE(24), 24000, "24 kHz");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, id, "voice.json"), "utf8"));
  // The 1 s of leading silence is removed; ffmpeg builds differ on how much trailing silence they keep.
  assert.ok(meta.seconds >= 5.5 && meta.seconds <= 7.5, `silence trimmed: ${meta.seconds}s`);
  assert.equal(fs.readFileSync(path.join(dir, id, "transcript.txt"), "utf8").trim(), "Hello, this is my voice for MyLecture.");
  assert.deepEqual(customVoices(dir).map(([v, n]) => [v, n]), [[id, "Glenn"]]);
  const omni = new OmniVoice({ modelDir: tmp(), getSettings: () => ({}), customDir: dir });
  assert.deepEqual(omni.voices().slice(0, OMNIVOICE_VOICES.length), OMNIVOICE_VOICES, "built-in voices come first");
  assert.equal(omni.voices().at(-1)[0], id, "own voices are listed last");
  removeCustomVoice(dir, id);
  assert.deepEqual(customVoices(dir), []);
});

test("long recordings are capped at 20 seconds", async () => {
  const dir = tmp();
  const [id] = await addCustomVoice(dir, { name: "Long", transcript: "A long reading of a passage.", data: clip(30, ".wav"), ext: ".wav" });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, id, "voice.json"), "utf8")).seconds <= 20);
});

test("bad input is rejected and leaves nothing behind", async () => {
  const dir = tmp();
  await assert.rejects(addCustomVoice(dir, { name: "", transcript: "Hello there friend", data: clip(5), ext: ".mp3" }), /name/);
  await assert.rejects(addCustomVoice(dir, { name: "A", transcript: "hi", data: clip(5), ext: ".mp3" }), /exactly what is said/);
  await assert.rejects(addCustomVoice(dir, { name: "A", transcript: "Hello there friend", data: Buffer.from("x"), ext: ".exe" }), /audio file/);
  await assert.rejects(addCustomVoice(dir, { name: "A", transcript: "Hello there friend", data: clip(1), ext: ".mp3" }), /at least 3 seconds/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.throws(() => removeCustomVoice(dir, "maruf"), /Only your own voices/);
  assert.throws(() => removeCustomVoice(dir, "custom-../x"), /Only your own voices/);
});
