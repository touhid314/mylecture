import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("spoken references stay visible through highlight expiry and background generation", { timeout: 45000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-scroll-report-"));
  const report = path.join(dir, "report.json");
  try {
    try { await promisify(execFile)(createRequire(import.meta.url)("electron"), [fileURLToPath(new URL("fixtures/study-scroll.mjs", import.meta.url)), report], { timeout: 35000, windowsHide: true }); } catch (e) { if (!fs.existsSync(report)) throw e; }
    const result = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(result.error, undefined, result.error);
    for (const key of ["initiallyOffscreen", "pendingScrollCancelled", "heldPastHighlight", "nextContentVisible", "equationDocked", "earlierEquationCopied", "copiedEquationEditable", "tallPartVisible", "earlierPageVisible", "returnsForNewContent", "replayNotMoved"]) assert.equal(result[key], true, key + ": " + JSON.stringify(result));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
