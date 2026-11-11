import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareHtml, withTutorApi } from "../electron/tutor/html.js";
import { TUTOR_SYSTEM } from "../electron/tutor/prompt.js";
import { TutorService } from "../electron/tutor/service.js";

test("HTML revisions are immutable, retain relative assets and reject files outside the lesson", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ml-html-"));
  try {
    fs.mkdirSync(path.join(workspace, "scenes"));
    const file = path.join(workspace, "scenes", "demo.html");
    fs.writeFileSync(file, "<body><img src='picture.png'>First<script>document.body.dataset.ran='yes'</script></body>");
    const first = prepareHtml({ file: "scenes/demo.html" }, { workspace, sessionId: "lesson" });
    fs.writeFileSync(file, "<body>Second</body>");
    const second = prepareHtml({ file: "scenes/demo.html" }, { workspace, sessionId: "lesson" });
    assert.notEqual(first.src, second.src);
    assert.match(first.src, /lesson\/scenes\/\.visual-/);
    const saved = fs.readFileSync(path.join(workspace, "scenes", first.src.split("/").pop()), "utf8");
    assert.match(saved, /First/);
    assert.match(saved, /picture.png/);
    assert.match(saved, /tutor:point/);
    assert.match(saved, /dataset.ran/);
    assert.throws(() => prepareHtml({ file: "../outside.html" }, { workspace, sessionId: "lesson" }), /inside/);
    assert.throws(() => prepareHtml({ html: "" }, { workspace, sessionId: "lesson" }), /Provide/);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

test("connected tutor engines get native agent workspaces and can publish HTML files", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ml-tutor-agent-"));
  try {
    const events = [];
    let request;
    const service = new TutorService({
      engines: new Map([["claude-code", { generate: async (opts) => {
        request = opts;
        fs.writeFileSync(path.join(opts.workspace, "visual.html"), "<body><canvas></canvas><script>window.animation=true</script></body>");
        opts.onDelta('say: Watch this picture.\nhtml#demo: {"file":"visual.html","height":300}\nend: wait');
        return {};
      } }]]),
      getSettings: () => ({ engine: "claude-code", connected: { "claude-code": true } }),
      sessions: { dir: () => workspace },
      send: (_, event) => events.push(event),
    });
    assert.deepEqual(await service.turn({ turnId: "html", sessionId: "lesson", task: { kind: "start" }, topic: "Demo" }), { ok: true });
    assert.equal(request.workspace, workspace);
    const action = events.find((e) => e.action?.type === "html").action;
    assert.match(action.data.src, /^mylecture:\/\/app\/tutor-file\/lesson\/\.visual-/);
    assert.doesNotThrow(() => structuredClone(action));
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

test("the step API loads before the visual's own scripts, without breaking its doctype", () => {
  const api = (out) => out.indexOf("window.tutor=");
  const doc = withTutorApi("<!DOCTYPE html><html lang='en'><header>Top</header><script>tutor.on('s1',()=>1)</script></html>");
  assert.match(doc, /^<!DOCTYPE html><html lang='en'><meta charset="utf-8"><style>/);
  // The charset comes early enough for the browser to honour it (first 1024 bytes).
  assert.ok(withTutorApi("<html><head><meta charset='utf-8'><title>t</title></head><body>↑ low</body></html>").indexOf('charset="utf-8"') < 1024);
  assert.ok(api(doc) < doc.indexOf("<header>") && api(doc) < doc.indexOf("tutor.on("));
  const withHead = withTutorApi("<html><head><title>x</title></head><body><script>tutor.on('a',f)</script></body></html>");
  assert.ok(withHead.indexOf("<head>") < api(withHead) && api(withHead) < withHead.indexOf("<title>"));
  const bare = withTutorApi("<div id='a'></div><script>tutor.on('a',f)</script>");
  assert.ok(api(bare) < bare.indexOf("<div"));
});

test("the prompt asks for processes to animate on cues, with a working stepped example", () => {
  assert.match(TUTOR_SYSTEM, /# Animate what changes, in step with your voice/);
  assert.match(TUTOR_SYSTEM, /style guide, not a restriction/);
  const line = TUTOR_SYSTEM.split("\n").find((l) => l.startsWith("html#bs: "));
  const data = JSON.parse(line.slice("html#bs: ".length));
  assert.match(data.html, /tutor\.on\('s1'/);
  assert.match(TUTOR_SYSTEM, /html#bs: .*\nsay: .*\{show:bs\.c1\}.*\{show:bs\.s1\}/);
});

test("a stepped HTML visual animates each step on its cue, in order", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-steps-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-html-steps.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 45000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Steps test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.errors, []);
    // A cue sent before the frame loaded still ran, once it had loaded.
    assert.deepEqual(r.start, { api: "function", bars: ["5", "2", "8", "1"], msg: "Compare 5 and 2" });
    // The swap slides, and the compare cued right after it waits its turn.
    assert.ok(r.slide.x > 5 && r.slide.x < 85, `the 5 was at ${r.slide.x}px`);
    assert.deepEqual(r.cues.map(c=>c.id), ["s1", "c2", "s2"]);
    assert.equal(r.cues[0].msg, "Bigger one moves right: swap");
    assert.ok(r.cues[1].at-r.cues[0].at>=750, "compare must wait for the 800 ms swap");
    assert.deepEqual(r.end, { api: "function", bars: ["2", "5", "8", "1"], msg: "5 < 8: leave them" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
