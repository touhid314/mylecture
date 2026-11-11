import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TUTOR_SYSTEM } from "../electron/tutor/prompt.js";

test("the prompt offers hands-on activities, not only mcq", () => {
  assert.match(TUTOR_SYSTEM, /"task": true/);
  assert.match(TUTOR_SYSTEM, /tutor\.submit\(/);
  assert.match(TUTOR_SYSTEM, /Don't make every check an mcq/);
});

test("what the student does in a hands-on activity reaches the tutor as an answer", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-activity-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-activity.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 45000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Activity test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    const q = "Click two numbers to swap them, then press Check";
    assert.deepEqual(r.wrong.answers, [{ kind: "activity", type: "activity", id: "sw", q, answer: "[2,5,8,1] after 1 swaps", correct: false }]);
    assert.equal(r.wrong.status, "Not quite · sent to your tutor");
    assert.equal(r.wrong.kicker, "Your turn");
    assert.equal(r.order, "1,2,5,8");
    assert.deepEqual(r.right.answers[1], { kind: "activity", type: "activity", id: "sw", q, answer: "[1,2,5,8] after 4 swaps", correct: true });
    assert.equal(r.right.status, "Correct · sent to your tutor");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
