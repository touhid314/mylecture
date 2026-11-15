import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearModelCache } from "../electron/tutor/model-cache.js";

test("a failed model load clears only that model's cached files", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-models-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const broken = path.join(dir, "onnx-community", "whisper-base.en", "onnx");
  const other = path.join(dir, "onnx-community", "Kokoro-82M-v1.0-ONNX");
  fs.mkdirSync(broken, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(broken, "encoder_model.onnx"), "truncated");
  fs.writeFileSync(path.join(other, "model.onnx"), "ok");
  assert.equal(clearModelCache(dir, "onnx-community/whisper-base.en"), true);
  assert.ok(!fs.existsSync(path.join(dir, "onnx-community", "whisper-base.en")));
  assert.ok(fs.existsSync(path.join(other, "model.onnx")));
  for (const bad of ["..", "../x", "a/..", "a/b/c", "", "onnx-community"]) assert.equal(clearModelCache(dir, bad), false, bad);
  assert.ok(fs.existsSync(dir));
});
