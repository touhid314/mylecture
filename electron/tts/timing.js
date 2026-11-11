// Word timings for a synthesized clip, without a speech model.
// The waveform's pauses are matched to the text's word boundaries
// (punctuation makes a pause likely there), and the words between two
// anchors share the time by their estimated syllables. That is close to the
// real word onsets, which is what the board needs to show things on cue.
import { wavInfo, normalizeForSpeech } from "./audio.js";

const FRAME = 0.01; // seconds per energy frame
const MIN_PAUSE = 0.09; // shorter dips are consonants, not pauses

// Estimated syllables of a word as it will be spoken.
export function syllables(word) {
  const spoken = normalizeForSpeech(word).toLowerCase();
  let n = 0;
  for (const w of spoken.split(/\s+/)) {
    if (!w) continue;
    const digits = (w.match(/\d/g) || []).length;
    const letters = w.replace(/[^a-z]/g, "");
    let s = (letters.match(/[aeiouy]+/g) || []).length;
    if (letters.length > 2 && /[^aeiou]e$/.test(letters) && !/[^aeiou]le$/.test(letters) && s > 1) s--;
    if (!s && letters) s = Math.max(1, Math.round(letters.length / 2)); // acronyms, "x"
    n += s + digits * 1.3;
  }
  return Math.max(n, 0.6);
}

// How likely the voice pauses after a word: 0 (no) to 1 (end of a sentence).
function pauseAfter(word) {
  if (/[.!?…]["')\]]*$/.test(word)) return 1;
  if (/[,;:—–-]["')\]]*$/.test(word) || /\.\.\.$/.test(word)) return 0.6;
  return 0;
}

function energyFrames(buf) {
  const info = wavInfo(buf);
  if (!info || info.bits !== 16) return null;
  const { sampleRate: sr, channels: ch, dataOffset } = info;
  const total = Math.floor(info.dataBytes / (2 * ch));
  const per = Math.max(1, Math.round(sr * FRAME));
  const frames = new Float32Array(Math.ceil(total / per));
  for (let f = 0; f < frames.length; f++) {
    let sum = 0, n = 0;
    for (let i = f * per; i < Math.min(total, (f + 1) * per); i++) {
      const v = buf.readInt16LE(dataOffset + i * 2 * ch) / 32768;
      sum += v * v;
      n++;
    }
    frames[f] = n ? Math.sqrt(sum / n) : 0;
  }
  return { frames, dur: total / sr };
}

// -> {start, end, pauses: [{a, b}]} in seconds.
export function findPauses(frames) {
  const sorted = Array.from(frames).sort((x, y) => x - y);
  const loud = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const thr = Math.max(0.004, loud * 0.08);
  let start = 0, end = frames.length;
  while (start < end && frames[start] < thr) start++;
  while (end > start && frames[end - 1] < thr) end--;
  const pauses = [];
  let run = -1;
  for (let f = start; f <= end; f++) {
    const quiet = f < end && frames[f] < thr;
    if (quiet && run < 0) run = f;
    else if (!quiet && run >= 0) {
      if ((f - run) * FRAME >= MIN_PAUSE) pauses.push({ a: run * FRAME, b: f * FRAME });
      run = -1;
    }
  }
  return { start: start * FRAME, end: end * FRAME, pauses, frames, thr };
}

// Syllable boundaries inside [t0, t1]: the energy dips between syllable
// nuclei (the loud vowel peaks). -> [t0, dip, dip, ..., t1]
export function syllableBounds(frames, thr, t0, t1) {
  const a = Math.round(t0 / FRAME), b = Math.round(t1 / FRAME);
  if (!frames || b - a < 6) return [t0, t1];
  // Smooth over ~50 ms.
  const sm = [];
  for (let f = a; f < b; f++) {
    let sum = 0, n = 0;
    for (let k = f - 2; k <= f + 2; k++) if (k >= a && k < b) { sum += frames[k]; n++; }
    sm.push(sum / n);
  }
  const peaks = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] > thr * 2) peaks.push(i);
  }
  // Merge peaks without a real dip between them (or too close together).
  const kept = [];
  for (const p of peaks) {
    const q = kept[kept.length - 1];
    if (q == null) { kept.push(p); continue; }
    let lo = Infinity;
    for (let i = q; i <= p; i++) lo = Math.min(lo, sm[i]);
    if (p - q < 8 || lo > 0.75 * Math.min(sm[p], sm[q])) { if (sm[p] > sm[q]) kept[kept.length - 1] = p; }
    else kept.push(p);
  }
  const out = [t0];
  for (let k = 1; k < kept.length; k++) {
    let at = kept[k - 1];
    for (let i = kept[k - 1]; i <= kept[k]; i++) if (sm[i] < sm[at]) at = i;
    out.push((a + at) * FRAME);
  }
  out.push(t1);
  return out;
}

// words: the text's words; speech: findPauses() output.
// -> [[start, end], ...] one per word, in seconds.
export function alignWords(words, speech) {
  const n = words.length;
  if (!n) return [];
  const { start, end } = speech;
  const w = words.map(syllables);
  const p = words.map(pauseAfter);
  // Expected timeline in syllable units: a sentence end is worth about two
  // syllables of silence, a comma about one.
  const PAUSE_UNITS = 2;
  const at = [0]; // expected time of boundary after word i, in units
  let u = 0;
  for (let i = 0; i < n; i++) {
    u += w[i];
    at.push(u);
    if (i < n - 1) u += p[i] * PAUSE_UNITS;
  }
  const scale = (end - start) / Math.max(u, 1e-6);
  const expect = (i) => start + at[i + 1] * scale + (p[i] * PAUSE_UNITS * scale) / 2;

  // Monotonic match of pauses to boundaries 0..n-2 (dynamic programming).
  // Unmatched pauses cost their length; unmatched punctuation costs a little.
  const pauses = speech.pauses.filter((q) => q.a > start && q.b < end);
  const m = pauses.length, B = n - 1;
  const span = Math.max(end - start, 0.3);
  const INF = 1e9;
  const cost = Array.from({ length: m + 1 }, () => new Float64Array(B + 1).fill(INF));
  const from = Array.from({ length: m + 1 }, () => new Int8Array(B + 1));
  cost[0][0] = 0;
  const skipB = (b) => p[b] * 0.35;
  const skipP = (q) => 0.3 + (q.b - q.a) * 4;
  const match = (q, b) => Math.abs(expect(b) - (q.a + q.b) / 2) / span * 6 - p[b] * 0.4;
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= B; j++) {
      const c = cost[i][j];
      if (c >= INF) continue;
      if (j < B && c + skipB(j) < cost[i][j + 1]) { cost[i][j + 1] = c + skipB(j); from[i][j + 1] = 1; }
      if (i < m && c + skipP(pauses[i]) < cost[i + 1][j]) { cost[i + 1][j] = c + skipP(pauses[i]); from[i + 1][j] = 2; }
      if (i < m && j < B) {
        const v = c + match(pauses[i], j);
        if (v < cost[i + 1][j + 1]) { cost[i + 1][j + 1] = v; from[i + 1][j + 1] = 3; }
      }
    }
  }
  // Anchors: word index -> [end of word i, start of word i+1].
  const anchors = new Map();
  for (let i = m, j = B; i > 0 || j > 0;) {
    const f = from[i][j];
    if (f === 3) anchors.set(j - 1, pauses[i - 1]);
    if (f === 1) j--;
    else if (f === 2) i--;
    else { i--; j--; }
  }
  // Between anchors, words take their share of the detected syllables
  // (or of the time, when the waveform isn't available).
  const out = new Array(n);
  let i0 = 0, t0 = start;
  const fill = (i1, t1) => {
    const total = w.slice(i0, i1 + 1).reduce((a, b) => a + b, 0) || 1;
    const bounds = syllableBounds(speech.frames, speech.thr, t0, t1);
    const P = bounds.length - 1;
    const at = (x) => {
      const u = Math.max(0, Math.min(P, x * P));
      const k = Math.min(P - 1, Math.floor(u));
      return bounds[k] + (bounds[k + 1] - bounds[k]) * (u - k);
    };
    let c = 0;
    for (let k = i0; k <= i1; k++) {
      const s0 = at(c / total);
      c += w[k];
      out[k] = [round(s0), round(at(c / total))];
    }
  };
  for (const k of [...anchors.keys()].sort((a, b) => a - b)) {
    const q = anchors.get(k);
    fill(k, q.a);
    i0 = k + 1;
    t0 = q.b;
  }
  fill(n - 1, end);
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;

// buf: a 16-bit WAV; text: what the caller will display (its words map 1:1
// to the result). -> [[start, end], ...] or null.
export function wordTimings(buf, text) {
  const words = String(text || "").match(/\S+/g) || [];
  if (!words.length) return [];
  const e = energyFrames(buf);
  if (!e || !e.frames.length) return null;
  return alignWords(words, findPauses(e.frames));
}
