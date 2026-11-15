import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODELS, fetchVerified, fileUrl, verifyFile } from "../scripts/prefetch-models.mjs";
import { isTransientFailure, parseArgs } from "../scripts/smoke-packaged.mjs";

const BODY = Buffer.from("model-bytes-0123456789");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const gitSha1 = (b) => crypto.createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const weights = { size: BODY.length, sha256: sha256(BODY) };

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-prefetch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fetch that answers with the given replies in turn and records Range headers.
function fakeFetch(replies) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, range: opts.headers?.range || "" });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    if (r === "stall") {
      // Sends nothing until aborted, like a stalled Hugging Face download.
      return new Response(new ReadableStream({ start(c) { opts.signal.addEventListener("abort", () => c.error(new Error("aborted"))); } }), { status: 200 });
    }
    return new Response(r.body, { status: r.status || 200 });
  };
  return { impl, calls };
}
const quiet = { wait: async () => {}, log: () => {} };

test("verifyFile checks size, SHA-256 for weights and the git blob hash for small files", async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, "a.onnx");
  assert.equal(await verifyFile(f, weights), "missing");
  fs.writeFileSync(f, BODY.subarray(0, 5));
  assert.match(await verifyFile(f, weights), /^size 5/);
  fs.writeFileSync(f, Buffer.alloc(BODY.length, 1));
  assert.match(await verifyFile(f, weights), /^checksum/);
  fs.writeFileSync(f, BODY);
  assert.equal(await verifyFile(f, weights), "");
  assert.equal(await verifyFile(f, { size: BODY.length, gitSha1: gitSha1(BODY) }), "");
  assert.match(await verifyFile(f, { size: BODY.length, gitSha1: "0".repeat(40) }), /^checksum/);
});

test("a dropped connection, a server error and a stall are retried, resuming the partial file", async (t) => {
  const dest = path.join(tmp(t), "m", "model.onnx");
  const { impl, calls } = fakeFetch([
    { body: BODY.subarray(0, 8) }, // cut short
    new TypeError("fetch failed"),
    { status: 503, body: "busy" },
    "stall",
    { status: 206, body: BODY.subarray(8) },
  ]);
  const lines = [];
  const how = await fetchVerified("https://hf.test/m", dest, weights, { fetchImpl: impl, stallMs: 50, wait: async () => {}, log: (l) => lines.push(l) });
  assert.equal(how, "downloaded");
  assert.deepEqual(fs.readFileSync(dest), BODY);
  assert.ok(!fs.existsSync(dest + ".part"));
  assert.equal(calls.length, 5);
  assert.equal(calls[0].range, "");
  assert.equal(calls[4].range, "bytes=8-");
  assert.ok(lines.some((l) => /stalled/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /HTTP 503/.test(l)));
});

test("a complete download with the wrong bytes starts over, and gives up after the last attempt", async (t) => {
  const dest = path.join(tmp(t), "model.onnx");
  const bad = Buffer.alloc(BODY.length, 7);
  const ok = fakeFetch([{ body: bad }, { body: BODY }]);
  assert.equal(await fetchVerified("u", dest, weights, { fetchImpl: ok.impl, ...quiet }), "downloaded");
  assert.equal(ok.calls[1].range, "", "a corrupt file is downloaded from the start");
  fs.rmSync(dest);
  const never = fakeFetch([{ body: bad }]);
  await assert.rejects(fetchVerified("u", dest, weights, { fetchImpl: never.impl, attempts: 3, ...quiet }), /after 3 attempts: checksum/);
  assert.equal(never.calls.length, 3);
  assert.ok(!fs.existsSync(dest));
});

test("a verified cached file isn't downloaded again", async (t) => {
  const dest = path.join(tmp(t), "model.onnx");
  fs.writeFileSync(dest, BODY);
  const { impl, calls } = fakeFetch([new Error("should not fetch")]);
  assert.equal(await fetchVerified("u", dest, weights, { fetchImpl: impl, ...quiet }), "cached");
  assert.equal(calls.length, 0);
});

test("the pinned models match what the app loads", () => {
  const kokoro = MODELS.find((m) => m.id === "onnx-community/Kokoro-82M-v1.0-ONNX");
  const whisper = MODELS.find((m) => m.id === "onnx-community/whisper-base.en");
  assert.ok(kokoro.files.some((f) => f.path === "onnx/model.onnx"), "Kokoro fp32");
  assert.ok(whisper.files.some((f) => f.path === "onnx/encoder_model.onnx"), "Whisper encoder fp32");
  assert.ok(whisper.files.some((f) => f.path === "onnx/decoder_model_merged_quantized.onnx"), "Whisper decoder q8");
  const stt = fs.readFileSync(new URL("../electron/tutor/stt.js", import.meta.url), "utf8");
  assert.match(stt, /STT_MODEL = "onnx-community\/whisper-base\.en"/);
  const worker = fs.readFileSync(new URL("../electron/tutor/stt-worker.js", import.meta.url), "utf8");
  assert.match(worker, /encoder_model: "fp32", decoder_model_merged: "q8"/);
  assert.match(fs.readFileSync(new URL("../electron/tts/index.js", import.meta.url), "utf8"), /dtype: "fp32"/);
  for (const m of MODELS) for (const f of m.files) {
    assert.ok(f.sha256 || f.gitSha1, `${m.id}/${f.path} has a checksum`);
    assert.match(fileUrl(m, f), new RegExp(`/resolve/${m.revision}/`));
  }
});

test("the smoke test retries only download and slow-runner failures", () => {
  for (const r of [
    "Smoke test timed out after 300s",
    "SMOKE_TEST_FAILED timed out",
    "SMOKE_TEST_FAILED kokoro: fetch failed",
    "SMOKE_TEST_FAILED speech recognition: Load model from /x/encoder_model.onnx failed:Protobuf parsing failed.",
    "SMOKE_TEST_FAILED validator: HTML contract validation failed for index1.html: Error: Timeout 10000ms exceeded navigating to file:///x/index1.html?export=1",
    "SMOKE_TEST_FAILED kokoro: Unable to determine content-length from response headers",
  ]) assert.equal(isTransientFailure(r), true, r);
  for (const r of [
    "SMOKE_TEST_OK win32-x64 2.0.3",
    "SMOKE_TEST_FAILED ffmpeg: spawn ENOENT",
    "SMOKE_TEST_FAILED study board: no Study view",
    "SMOKE_TEST_FAILED validator: HTML contract validation failed for index1.html:\n - renderSection threw",
    "(no result written; exit code 1)",
  ]) assert.equal(isTransientFailure(r), false, r);
});

test("smoke options come from flags and the environment", () => {
  assert.deepEqual(parseArgs([], {}), { deep: false, models: "", exe: "", timeoutS: 120 });
  assert.deepEqual(parseArgs(["--deep", "--models", "m", "app.exe"], {}), { deep: true, models: "m", exe: "app.exe", timeoutS: 300 });
  assert.deepEqual(parseArgs([], { MYLECTURE_SMOKE_DEEP: "1", MYLECTURE_SMOKE_MODELS: "d", MYLECTURE_SMOKE_TIMEOUT: "60" }), { deep: true, models: "d", exe: "", timeoutS: 60 });
});
