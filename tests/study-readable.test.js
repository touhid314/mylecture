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
import { MATH_BRIDGE } from "../electron/tutor/html.js";

const DARK = "rgb(31, 35, 40)", LIGHT = "rgb(248, 250, 252)";

test("the tutor is told to write LaTeX everywhere, and its examples keep their backslashes", () => {
  assert.match(TUTOR_SYSTEM, /Equations are ALWAYS LaTeX/);
  assert.ok(TUTOR_SYSTEM.includes("$\\mathrm{softmax}(QK^\\top/\\sqrt{d})\\,V$"));
  assert.ok(TUTOR_SYSTEM.includes("\\frac{\\htmlId{rise}{f(x+h) - f(x)}}{\\htmlId{run}{h}}"));
  // A lost backslash turns \t, \f, \b into control characters.
  assert.equal((TUTOR_SYSTEM.match(/[\t\x08\x0b\f]/g) || []).length, 0);
  assert.match(MATH_BRIDGE, /katex\.min\.js/);
});

test("text in diagrams stays readable and LaTeX renders inside visuals", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-readable-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-readable.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 45000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Readability test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.repairedSvg, true, "escaped SVG attributes must still create real positioned shapes");
    assert.equal(r.repairedMath, true, "escaped math must render in the repaired diagram");
    assert.equal(r.captionMath, true, "captions must render inline math rather than expose dollar markers");
    assert.equal(r.spokenText, "Use the derivative of u with respect to x then u times v.");
    assert.equal(r.cuePosition, r.spokenText.indexOf("u times v"), "cues must use positions in the spoken words");
    // The user's scene on the blackboard: chalk-coloured and white text on pale boxes turns dark...
    assert.deepEqual([r.qkv, r.nn, r.sram], [DARK, DARK, DARK]);
    // ...while text on the board itself keeps the chalk colour.
    assert.notEqual(r.hbm, DARK);
    // An svg diagram (shown inverted on the blackboard): judged before the filter.
    assert.equal(r.filtered, true);
    assert.deepEqual([r.t1, r.t2, r.free], [DARK, LIGHT, DARK]);
    // LaTeX in svg text, with readable colour; money stays text.
    assert.equal(r.eqKatex, true);
    assert.equal(r.eqColor, DARK);
    assert.equal(r.moneyPlain, true);
    // HTML visuals: $...$, \(...\) and text added later render; "$5 and $10" doesn't.
    assert.deepEqual(r.html, { test: "math", katex: 3, money: "Costs $5 and $10", later: true, hasKatex: "object" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
