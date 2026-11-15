// Downloads the speech models the deep smoke test needs (the Kokoro voice and
// Whisper speech recognition), so the packaged-app smoke test never depends on
// a live Hugging Face download. Every file is pinned to a commit and checked
// (size, then SHA-256 for model weights or the git blob hash for small files);
// a broken or stalled download is retried and resumed.
//   node scripts/prefetch-models.mjs <models-dir>
// The folder has the app's models layout (<models-dir>/<org>/<model>/<file>),
// as transformers.js caches it, so it can be copied into a profile's models/.
// Files that are already there and verify are not downloaded again.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The files transformers.js loads for the dtypes the app uses: Kokoro fp32
// (electron/tts/index.js) and Whisper encoder fp32 + decoder q8
// (electron/tutor/stt-worker.js). Change these with the app.
export const MODELS = [
  {
    id: "onnx-community/Kokoro-82M-v1.0-ONNX",
    revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
    files: [
      { path: "config.json", size: 44, gitSha1: "790faf216e7e3f490e71e8bc80df79ed8941101c" },
      { path: "tokenizer.json", size: 3497, gitSha1: "4280f55fc1c32211bc9bb4d55545759a00054ecd" },
      { path: "tokenizer_config.json", size: 113, gitSha1: "5c81e9a3a06db9139900d6ee5b60e8bb701ccb0b" },
      { path: "onnx/model.onnx", size: 325532232, sha256: "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb" },
    ],
  },
  {
    id: "onnx-community/whisper-base.en",
    revision: "51eefc0af78b103839eda9e7e4f4186acc6517fe",
    files: [
      { path: "config.json", size: 2197, gitSha1: "1d26eef96852a247a15abeee24630b81de8c5835" },
      { path: "generation_config.json", size: 1556, gitSha1: "84c050f8e56d93c2b29d9768be849360960483a7" },
      { path: "preprocessor_config.json", size: 339, gitSha1: "91876762a536a746d268353c5cba57286e76b058" },
      { path: "tokenizer.json", size: 2405679, gitSha1: "b5bd266de2f9b9a68efe13fb48ac6830ca71c0bb" },
      { path: "tokenizer_config.json", size: 282662, gitSha1: "220314442bbc85c24bb2ee0b4b8d682615dd79e7" },
      { path: "onnx/encoder_model.onnx", size: 82468078, sha256: "1cc86302d480b061452d348638064383ab41b6f3333ddd0e423532d14edaf535" },
      { path: "onnx/decoder_model_merged_quantized.onnx", size: 53692803, sha256: "dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909" },
    ],
  },
];

export const fileUrl = (model, file, host = "https://huggingface.co") => `${host}/${model.id}/resolve/${model.revision}/${file.path}`;

// "" when the file is complete and intact, otherwise why it isn't.
export async function verifyFile(file, expected) {
  let size;
  try { size = fs.statSync(file).size; } catch { return "missing"; }
  if (size !== expected.size) return `size ${size}, expected ${expected.size}`;
  const hash = crypto.createHash(expected.sha256 ? "sha256" : "sha1");
  if (!expected.sha256) hash.update(`blob ${size}\0`); // git's blob hash
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const got = hash.digest("hex");
  const want = expected.sha256 || expected.gitSha1;
  return got === want ? "" : `checksum ${got}, expected ${want}`;
}

// One attempt: resumes from <dest>.part with a Range request when the server
// allows it; gives up when no bytes arrive for stallMs.
async function downloadOnce(url, part, { fetchImpl, stallMs }) {
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), stallMs);
  const poke = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), stallMs); };
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: ctrl.signal, headers: have ? { range: `bytes=${have}-` } : {} });
    if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    // Opened on the first bytes, so a reply that stalls at once keeps the partial file.
    let out = null;
    try {
      for await (const chunk of res.body) {
        poke();
        out ||= fs.createWriteStream(part, { flags: res.status === 206 ? "a" : "w" });
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      }
    } finally {
      if (out) await new Promise((r) => out.end(r));
    }
  } catch (e) {
    throw ctrl.signal.aborted ? new Error(`stalled: no data for ${Math.round(stallMs / 1000)} s`) : e;
  } finally {
    clearTimeout(timer);
  }
}

// Downloads url to dest and verifies it; retries (resuming) up to `attempts`
// times. A file that downloads completely but fails the checksum starts over.
export async function fetchVerified(url, dest, expected, {
  fetchImpl = globalThis.fetch, attempts = 5, stallMs = 60000,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log,
} = {}) {
  if (!(await verifyFile(dest, expected))) return "cached";
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + ".part";
  let problem = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await downloadOnce(url, part, { fetchImpl, stallMs });
      problem = await verifyFile(part, expected);
      if (!problem) {
        fs.renameSync(part, dest);
        return "downloaded";
      }
      // Too long or the wrong bytes: resuming can't fix that.
      if (fs.statSync(part).size >= expected.size) fs.rmSync(part, { force: true });
    } catch (e) {
      problem = String(e?.message || e);
    }
    if (attempt < attempts) {
      const ms = Math.min(30000, 2000 * 2 ** (attempt - 1));
      log(`[prefetch] ${url}: ${problem}; retrying in ${ms / 1000} s (attempt ${attempt + 1} of ${attempts})`);
      await wait(ms);
    }
  }
  throw new Error(`Could not download ${url} after ${attempts} attempts: ${problem}`);
}

export async function prefetchModels(dir, options = {}) {
  const log = options.log || console.log;
  for (const model of MODELS) {
    for (const file of model.files) {
      const dest = path.join(dir, ...model.id.split("/"), ...file.path.split("/"));
      const how = await fetchVerified(fileUrl(model, file), dest, file, options);
      log(`[prefetch] ${model.id}/${file.path}: ${how}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/prefetch-models.mjs <models-dir>");
    process.exit(2);
  }
  prefetchModels(path.resolve(dir)).catch((e) => {
    console.error(`[prefetch] ${e.message}`);
    process.exit(1);
  });
}
