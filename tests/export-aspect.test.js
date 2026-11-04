import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("MP4 export preserves aspect, resolution and geometry beyond the monitor bounds", { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-export-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/export-aspect.mjs", import.meta.url));
  let failure;
  try { await promisify(execFile)(electron, [fixture, report], { timeout: 110000, windowsHide: true }); }
  catch (error) { failure = error; }
  assert.ok(fs.existsSync(report), `Electron render test did not report: ${failure?.message || ""}`);
  const result = JSON.parse(fs.readFileSync(report, "utf8"));
  if (path.dirname(result.temp) === os.tmpdir() && path.basename(result.temp).startsWith("ml-export-aspect-")) fs.rmSync(result.temp, { recursive: true, force: true });
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("ml-export-report-")) fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.ok, true, result.error);
  assert.equal(failure, undefined);
  assert.equal(result.results.length, 6);
});
