// Local speech recognition (Whisper via transformers.js) in a utilityProcess.
//   -> {type:"init", cacheDir, model}
//   -> {type:"transcribe", id, pcm: Float32Array buffer (16 kHz mono)}
//   <- {type:"progress", file, loaded, total} | {type:"ready"} | {type:"init-error", message}
//   <- {type:"done", id, text} | {type:"error", id, message}
import { env, pipeline } from "@huggingface/transformers";

const port = process.parentPort;
let asr = null;
let loading = null;
let initMsg = null;
let initError = "";

async function init({ cacheDir, model }) {
  if (loading) return loading;
  initMsg = { cacheDir, model };
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  loading = pipeline("automatic-speech-recognition", model || "onnx-community/whisper-base.en", {
    device: "cpu",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    progress_callback: (p) => {
      if (p.status === "progress") port.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
    },
  })
    .then((p) => {
      asr = p;
      port.postMessage({ type: "ready" });
    })
    .catch((e) => {
      loading = null;
      initError = String(e?.message || e);
      port.postMessage({ type: "init-error", message: String(e?.message || e) });
    });
  return loading;
}

const queue = [];
let busy = false;
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const job = queue.shift();
  try {
    if (!asr) await loading;
    // A failed load (a network blip mid-download) is retried once per request.
    if (!asr && initMsg) await init(initMsg);
    if (!asr) throw new Error(`Speech recognition couldn't load: ${initError || "unknown error"}`);
    const audio = new Float32Array(job.pcm);
    const r = await asr(audio, { language: undefined });
    port.postMessage({ type: "done", id: job.id, text: String(r?.text || "").trim() });
  } catch (e) {
    port.postMessage({ type: "error", id: job.id, message: String(e?.message || e) });
  } finally {
    busy = false;
    pump();
  }
}

port.on("message", (e) => {
  const m = e.data;
  if (m.type === "init") init(m);
  else if (m.type === "transcribe") {
    queue.push(m);
    pump();
  }
});
