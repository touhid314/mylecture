import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pcmToWav } from "../electron/tts/audio.js";
import { alignWords, findPauses, syllables, wordTimings } from "../electron/tts/timing.js";
import { cueTime } from "../app/js/study/speech.js";
import { TUTOR_SYSTEM } from "../electron/tutor/prompt.js";

// Speech-like audio: loud runs (with syllable dips) separated by silences.
function speech(runs, sr = 16000) {
  const end = runs[runs.length - 1][1] + 0.1;
  const pcm = new Int16Array(Math.round(end * sr));
  for (const [a, b] of runs) for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) {
    const t = i / sr;
    pcm[i] = Math.round(Math.sin(t * 900) * 9000 * (0.55 + 0.45 * Math.cos(t * 2 * Math.PI * 4)));
  }
  return pcmToWav(pcm, sr);
}

test("syllable estimates follow the spoken form", () => {
  assert.equal(syllables("the"), 1);
  assert.ok(syllables("mitochondria") >= 4);
  assert.ok(syllables("x^2") >= 2); // "x squared"
  assert.ok(syllables("1905") > syllables("in"));
});

test("pauses in the audio anchor the words after punctuation", () => {
  const text = "Hello there, my friend. This is the cell.";
  const wav = speech([[0.1, 0.8], [1.1, 1.7], [2.2, 3.4]]);
  const words = wordTimings(wav, text);
  assert.equal(words.length, 8);
  // "my" starts after the first pause, "This" after the second.
  assert.ok(Math.abs(words[2][0] - 1.1) < 0.05, `my at ${words[2][0]}`);
  assert.ok(Math.abs(words[4][0] - 2.2) < 0.05, `This at ${words[4][0]}`);
  assert.ok(Math.abs(words[0][0] - 0.1) < 0.05);
  for (let i = 1; i < words.length; i++) assert.ok(words[i][0] >= words[i - 1][0]);
});

test("without pauses, words still spread across the speech", () => {
  const frames = new Float32Array(300).fill(0.3);
  const out = alignWords(["one", "two", "three", "four"], findPauses(frames));
  assert.equal(out.length, 4);
  assert.ok(out[0][0] < out[1][0] && out[2][0] < out[3][0] && out[3][1] <= 3.01);
});

test("cue times use word onsets, falling back to text position", () => {
  const text = "First this apple, and then this banana here.";
  const words = [[0, 0.3], [0.3, 0.6], [1.0, 1.4], [1.6, 1.8], [1.8, 2.0], [2.0, 2.2], [2.2, 2.7], [2.7, 3.0]];
  assert.equal(cueTime(text, text.indexOf("apple"), words, 3), 1.0);
  assert.equal(cueTime(text, text.indexOf("banana"), words, 3), 2.2);
  assert.equal(cueTime(text, text.length, words, 3), 3.0); // a cue at the end
  const t = cueTime(text, text.indexOf("banana"), null, 3);
  assert.ok(t > 1.8 && t < 2.6);
});

test("the tutor is told to prefer real pictures and to cue visuals on words", () => {
  assert.match(TUTOR_SYSTEM, /Real pictures first for real things/);
  assert.match(TUTOR_SYSTEM, /mitochondri/i);
  assert.match(TUTOR_SYSTEM, /\{show:ID\}/);
  assert.match(TUTOR_SYSTEM, /tutor:cue/);
  assert.match(TUTOR_SYSTEM, /# Teach ON the picture/);
  assert.match(TUTOR_SYSTEM, /annotate#a1: .*\n\s*say: .*\{show:a1\}/);
  assert.match(TUTOR_SYSTEM, /"type":"focus"/);
});

test("lesson playback shows {show:id} visuals on their words", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-sync-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-sync.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 45000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Sync test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.events.slice(0, 3), ["play", "playing", "ended"]);
    // Words at 1.0 s and 2.2 s; the board leads the voice by 0.15 s.
    assert.ok(r.seen.a > 0.7 && r.seen.a < 1.1, `apple shown at ${r.seen.a}`);
    assert.ok(r.seen.b > 1.9 && r.seen.b < 2.3, `banana shown at ${r.seen.b}`);
    // Written after its word was spoken: shown as soon as it arrives (~2.6 s).
    assert.ok(r.seen.c > 2.4 && r.seen.c < 3.2, `late item shown at ${r.seen.c}`);
    // Map cues spoken in a sentence move the camera and trace the route.
    assert.deepEqual(r.mapCues, { zoomed: true, traced: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
