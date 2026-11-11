import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TUTOR_SYSTEM, formatHistory } from "../electron/tutor/prompt.js";

test("pointing at a whole visual while naming a part highlights only that part", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-point-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-point-parts.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 45000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Point test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    // An svg part named by its id, a loose id, a text label; the whole
    // diagram only when no part is named; an equation term (\htmlId).
    assert.deepEqual(r.parts, { spoken: "left-ventricle", loose: "left-ventricle", label: "Right atrium", whole: "whole", term: "numerator" });
    // Inside an HTML visual: the named element glows and the frame isn't boxed.
    assert.deepEqual(r.named, { lit: ["Sorted part"], boxes: 0 });
    // Nothing named: the whole visual is boxed.
    assert.deepEqual(r.unnamed, { lit: [], boxes: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the tutor prompt stays compact and asks for the smallest part", () => {
  assert.ok(TUTOR_SYSTEM.length < 27000, `system prompt is ${TUTOR_SYSTEM.length} characters`);
  assert.match(TUTOR_SYSTEM, /REF must be the smallest thing you mean/);
  assert.match(TUTOR_SYSTEM, /give every part you will talk about its own id/);
});

test("earlier versions of a rewritten visual are not resent in the history", () => {
  const big = (v) => `html#bs: {"html":"${"x".repeat(2000)}","v":${v}}`;
  const map = `map#m1: {"places":[${'{"id":"a","lon":1,"lat":2},'.repeat(60)}{}]}`;
  const out = formatHistory([
    { role: "tutor", text: big(1) }, { role: "tutor", text: map }, { role: "tutor", text: "say: Now watch." },
    { role: "tutor", text: big(2) }, { role: "tutor", text: 'map#m1: {"focus":"Japan"}' },
  ]).split("\n");
  assert.match(out[0], /^html#bs: \(earlier version, \d+ characters, replaced below\)$/);
  assert.equal(out[1], map); // a map rewrite can keep the old contents
  assert.equal(out[3], big(2));
});
