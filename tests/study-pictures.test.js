import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("picture overlays resize, point, save through Electron IPC and restore", { timeout: 40000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-picture-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-pictures.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 30000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Picture test did not report");
    const result = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(result.error, undefined, result.error);
    assert.deepEqual(result.teaching, { focus: true, oldDimmed: true, drawsOn: true, focusNotDimmed: true, oneSpotlight: true, pointedBack: true, unfocused: true });
    assert.equal(result.imageWidth, 600);
    for (const position of [result.before, result.after]) {
      assert.ok(Math.abs(position.x - 0.5) < 0.01, JSON.stringify(position));
      assert.ok(Math.abs(position.y - 0.4) < 0.01, JSON.stringify(position));
    }
    for (const key of ["pointed", "restored", "cleared", "rect"]) assert.equal(result[key], true, key);
    assert.equal(result.labels, 1);
    assert.equal(result.saves, 1);
    assert.equal(result.htmlState.count, "1", "HTML event handlers execute in the visual");
    assert.equal(result.htmlState.ipc, "undefined");
    assert.equal(result.htmlState.blocked, true);
    assert.equal(result.htmlPointed, true);
    assert.equal(result.htmlAnimated, true);
    assert.equal(result.frames, 1, "HTML updates replace the existing visual");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("downloaded pictures on the board are attached to the next tutor call", async () => {
  const { TutorService } = await import("../electron/tutor/service.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-board-pics-"));
  try {
    fs.writeFileSync(path.join(dir, "aaaa.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const finder = { dir, find: async (q) => (q === "mitochondrion TEM micrograph" ? { url: "mylecture://app/tutor-img/aaaa.png", credit: "Commons" } : null) };
    let request;
    const actions = [];
    const service = new TutorService({
      engines: new Map([["claude-code", { generate: async (opts) => {
        request = opts;
        opts.onDelta('annotate#a1: {"target":"mito","marks":[{"id":"outer","type":"circle","x":50,"y":50,"w":80,"h":60}]}\nsay: First, {show:a1} the outer membrane.\nimage#mito: {"query":"mitochondrion TEM micrograph"}\nend: continue');
        return {};
      } }]]),
      getSettings: () => ({ engine: "claude-code", connected: { "claude-code": true } }),
      sessions: { dir: () => dir },
      imageFinder: finder,
      send: (_, e) => { if (e.type === "action") actions.push(e.action); },
    });
    await service.turn({ turnId: "t", sessionId: "s", topic: "Mitochondria", task: { kind: "continue" }, history: [
      { role: "tutor", text: 'image#mito: {"query":"mitochondrion TEM micrograph","caption":"A real one"}' },
      { role: "tutor", text: 'image#gone: {"query":"nothing found"}' },
      { role: "tutor", text: "say: This is a real mitochondrion." },
    ] });
    assert.deepEqual(request.images.map((i) => path.basename(i.path)), ["aaaa.png"]);
    assert.match(request.user, /PICTURES ON THE BOARD .*image id "mito"/);
    // Re-showing it uses the same local file the student already sees.
    assert.equal(actions.find((a) => a.type === "image").data.source.url, "mylecture://app/tutor-img/aaaa.png");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the visual being discussed stays in view while notes push the board down", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-dock-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-dock.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 45000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Dock test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    delete r.dims;
    assert.deepEqual(r, { offBefore: true, annotateVisible: true, stillVisibleAfterNotes: true, latestVisible: true, pointVisibleAfterSnap: true, releasedByNewVisual: true, copyOnLivePage: true, copyVisible: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
