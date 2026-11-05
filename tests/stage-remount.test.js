import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Regression: "Scene 1: Cannot read properties of null (reading 'postMessage')"
// when the scene list was cleared and the same HTML scene came back.
test("an HTML scene that leaves and returns to the stage is remounted, not rendered into a dead frame", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-stage-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/stage-remount.mjs", import.meta.url));
  try { await promisify(execFile)(electron, [fixture, report], { timeout: 50000, windowsHide: true }); } catch {}
  assert.ok(fs.existsSync(report), "Electron stage test did not report");
  const result = JSON.parse(fs.readFileSync(report, "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.errors, []);
  assert.equal(result.frames, 1);
});
