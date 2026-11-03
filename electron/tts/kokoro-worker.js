// Runs inside an Electron utilityProcess so ONNX inference never blocks the
// main process or UI. Protocol (parentPort messages):
//   -> {type:"init", cacheDir, dtype}
//   -> {type:"synth", id, text, voice, speed}
//   <- {type:"progress", file, progress, loaded, total}
//   <- {type:"ready"} | {type:"init-error", message}
//   <- {type:"done", id, pcm: Int16Array buffer, sampleRate} | {type:"error", id, message}
import fs from "node:fs";
import path from "node:path";
import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

const port = process.parentPort;
let tts = null;
let loading = null;
const queue = [];
let busy = false;

function cleanCorruptedFiles(cacheDir) {
  try {
    const onnxDir = path.join(cacheDir, "onnx-community", "Kokoro-82M-v1.0-ONNX", "onnx");
    if (fs.existsSync(onnxDir)) {
      const files = fs.readdirSync(onnxDir);
      for (const f of files) {
        const full = path.join(onnxDir, f);
        const stat = fs.statSync(full);
        // model.onnx should be ~325 MB. If it's less than 300 MB, it was aborted mid-download.
        if (f === "model.onnx" && stat.size < 300 * 1024 * 1024) {
          console.warn("[kokoro-worker] removing incomplete model.onnx:", stat.size, "bytes");
          fs.rmSync(full, { force: true });
        }
      }
    }
  } catch (err) {
    console.error("[kokoro-worker] clean error:", err);
  }
}

async function init(msg, isRetry = false) {
  if (loading && !isRetry) return loading;
  if (msg.cacheDir) {
    env.cacheDir = msg.cacheDir;
    cleanCorruptedFiles(msg.cacheDir);
  }
  loading = (async () => {
    try {
      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: msg.dtype || "fp32",
        device: "cpu",
        progress_callback: (p) => {
          if (p.status === "progress") {
            port.postMessage({ type: "progress", file: p.file, progress: p.progress, loaded: p.loaded, total: p.total });
          }
        },
      });
      // Warm-up so the first real sentence is fast.
      await tts.generate("Ready.", { voice: "af_heart" });
      port.postMessage({ type: "ready", voices: Object.keys(tts.voices) });
    } catch (e) {
      loading = null;
      const errMsg = String(e?.message || e);
      if (!isRetry && (errMsg.includes("Protobuf parsing failed") || errMsg.includes("invalid") || errMsg.includes("corrupt"))) {
        console.warn("[kokoro-worker] protobuf parsing failed, wiping corrupted model and retrying download once...");
        try {
          fs.rmSync(path.join(msg.cacheDir, "onnx-community"), { recursive: true, force: true });
        } catch {}
        return init(msg, true);
      }
      port.postMessage({ type: "init-error", message: errMsg });
    }
  })();
  return loading;
}

async function pump() {
  if (busy || !tts) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const audio = await tts.generate(job.text, { voice: job.voice || "af_heart", speed: job.speed || 1 });
      const f = audio.audio;
      const pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const v = Math.max(-1, Math.min(1, f[i]));
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      port.postMessage({ type: "done", id: job.id, pcm: pcm.buffer, sampleRate: audio.sampling_rate });
    } catch (e) {
      port.postMessage({ type: "error", id: job.id, message: String(e?.message || e) });
    }
  }
  busy = false;
}

port.on("message", async (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    await init(msg);
    pump();
  } else if (msg.type === "synth") {
    queue.push(msg);
    pump();
  }
});
