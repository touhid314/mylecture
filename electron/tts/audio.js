// Pure helpers for speech text and WAV files (no Electron imports).
import fs from "node:fs";

export { normalizeForSpeech } from "../../app/shared/speech-text.js";

export function wavInfo(buf) {
  // Walk RIFF chunks; returns {sampleRate, channels, bits, dataBytes}.
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === "data") {
      if (off + 8 + size > buf.length) size = buf.length - off - 8;
      return fmt ? { ...fmt, dataOffset: off + 8, dataBytes: size } : null;
    }
    off += 8 + size + (size & 1);
  }
  return null;
}

export function wavDuration(file) {
  try {
    const info = wavInfo(fs.readFileSync(file));
    if (!info) return 0;
    return info.dataBytes / (info.sampleRate * info.channels * (info.bits / 8));
  } catch {
    return 0;
  }
}

export function pcmToWav(pcm16, sampleRate) {
  const data = Buffer.from(pcm16.buffer ? pcm16.buffer : pcm16);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
