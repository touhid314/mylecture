// Measures how close the estimated word onsets (electron/tts/timing.js) are
// to Whisper's word timestamps on real Kokoro speech, and compares them with
// the old "character position x duration" estimate.
//   node tests/scratch/study-word-timing.mjs
import os from "node:os";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { pcmToWav, normalizeForSpeech } from "../../electron/tts/audio.js";
import { wordTimings } from "../../electron/tts/timing.js";
console.error = () => {}; // phonemizer prints its whole bundle on some warnings

const cacheDir = path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "MyLecture", "models");
env.cacheDir = cacheDir;
env.allowLocalModels = true;

const SENTENCES = [
  "Okay, so this is what one actually looks like, a real mitochondrion under an electron microscope.",
  "First the outer membrane, then inside it these folds, the cristae, and right in the middle the matrix.",
  "Now, the derivative is the slope. The slope, right at that point. That's all it is, really.",
  "So in nineteen oh five, Einstein wrote down E equals m c squared, and, well, everything changed.",
  "Hmm, why would that be? Think about it for a second: the packet travels from you, to the provider, to the site.",
];

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
// Word timestamps need a Whisper export with cross attentions; it goes in a
// temporary cache, not the app's model folder.
env.cacheDir = path.join(os.tmpdir(), "ml-word-timing-models");
const asr = await pipeline("automatic-speech-recognition", process.env.ASR_MODEL || "onnx-community/whisper-base_timestamped", { device: "cpu", dtype: "fp32" });

function trimSilence(pcm, sr) {
  const thr = 300;
  let a = 0, b = pcm.length - 1;
  while (a < b && Math.abs(pcm[a]) < thr) a++;
  while (b > a && Math.abs(pcm[b]) < thr) b--;
  a = Math.max(0, a - Math.round(sr * 0.04));
  b = Math.min(pcm.length - 1, b + Math.round(sr * 0.12));
  return pcm.slice(a, b + 1);
}

function resample(input, from, to) {
  const ratio = from / to, n = Math.floor(input.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
let newErr = [], oldErr = [];
for (const text of SENTENCES) {
  const audio = await tts.generate(normalizeForSpeech(text), { voice: "af_heart", speed: 0.95 });
  const sr = audio.sampling_rate;
  const f32 = audio.audio;
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
  const trimmed = trimSilence(i16, sr);
  const wav = pcmToWav(trimmed, sr);
  const dur = trimmed.length / sr;
  const est = wordTimings(wav, text);
  const floats = Float32Array.from(trimmed, (v) => v / 32768);
  const r = await asr(resample(floats, sr, 16000), { return_timestamps: "word" });
  const truth = (r.chunks || []).map((c) => ({ w: norm(c.text), t: c.timestamp[0] }));
  const words = text.match(/\S+/g);
  // Match each text word to the next Whisper word with the same spelling.
  let j = 0, pos = 0;
  const rows = [];
  for (let i = 0; i < words.length; i++) {
    const at = text.indexOf(words[i], pos);
    pos = at + words[i].length;
    const want = norm(words[i]);
    let k = j;
    while (k < truth.length && truth[k].w !== want && k - j < 3) k++;
    if (k < truth.length && truth[k].w === want) {
      const old = (at / text.length) * dur - 0.15;
      rows.push([words[i], truth[k].t, est[i][0], old]);
      newErr.push(Math.abs(est[i][0] - truth[k].t));
      oldErr.push(Math.abs(old - truth[k].t));
      j = k + 1;
    }
  }
  console.log(`\n${text}  (${dur.toFixed(2)} s)`);
  for (const [w, t, e, o] of rows) console.log(`  ${w.padEnd(14)} whisper ${t.toFixed(2)}  new ${e.toFixed(2)} (${(e - t >= 0 ? "+" : "") + (e - t).toFixed(2)})  old ${o.toFixed(2)} (${(o - t >= 0 ? "+" : "") + (o - t).toFixed(2)})`);
}
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return `mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3)} s, median ${s[Math.floor(s.length / 2)].toFixed(3)} s, p90 ${s[Math.floor(s.length * 0.9)].toFixed(3)} s, max ${s[s.length - 1].toFixed(3)} s`;
};
console.log(`\nWords compared: ${newErr.length}`);
console.log(`New (pauses + syllables): ${stat(newErr)}`);
console.log(`Old (character position):  ${stat(oldErr)}`);
