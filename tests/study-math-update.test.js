import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { replaceMathTerm } from "../app/js/study/math-update.js";
import { lineToAction } from "../electron/tutor/protocol.js";

test("equation term updates parse and preserve nested TeX and other terms", () => {
  const source = String.raw`y = \htmlId{term}{\frac{x}{2}} + \htmlId{other}{3}`;
  assert.equal(replaceMathTerm(source, "term", String.raw`\frac{y+1}{3}`), String.raw`y = \htmlId{term}{\frac{y+1}{3}} + \htmlId{other}{3}`);
  assert.equal(replaceMathTerm(source, "missing", "5"), null);
  assert.equal(replaceMathTerm(String.raw`\htmlId{term}{\{x\}} + z`, "term", "5"), String.raw`\htmlId{term}{5} + z`);
  const action = lineToAction("math#parts.uv: x e^x");
  assert.equal(action.type, "math");
  assert.equal(action.id, "parts.uv");
  assert.equal(action.text, "x e^x");
});

test("equations and individual terms update in place on their spoken cues", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-equation-update-"));
  const report = path.join(dir, "report.json");
  try {
    try { await promisify(execFile)(createRequire(import.meta.url)("electron"), [fileURLToPath(new URL("fixtures/study-math-update.mjs", import.meta.url)), report], { timeout: 45000, windowsHide: true }); } catch (e) { if (!fs.existsSync(report)) throw e; }
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    for (const key of ["sameEquation", "firstChange", "secondChange", "wholeChange", "restored", "pageScoped", "missingIgnored", "noKatexErrors"]) assert.equal(r[key], true, key);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
