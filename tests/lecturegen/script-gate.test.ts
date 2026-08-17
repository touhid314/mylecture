import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractNarrationScript, runScriptGate } from "../../src/lecturegen/script-gate.ts";

test("extractNarrationScript reads contract `text` fields", () => {
  const html = `<script>window.__VIDEO_PLAN__ = [
  { id: "a", kind: "narration+visual", audio: "audio/a.wav", text: "Hello there." },
  { id: "b", kind: "visual-only", duration: 2 }
];</script>`;
  assert.equal(extractNarrationScript(html), "Hello there.");
});

test("extractNarrationScript accepts legacy narration field", () => {
  const html = `<script>window.__VIDEO_PLAN__ = [
  { id: "a", kind: "narration+visual", audio: "audio/a.wav", narration: "Legacy line." }
];</script>`;
  assert.equal(extractNarrationScript(html), "Legacy line.");
});

test("extractNarrationScript reads LectureGen const VIDEO_PLAN assignment", () => {
  const html = `<script>
const VIDEO_PLAN = [
  { id: "scene_1", kind: "narration+visual", audio: "audio/scene_1.wav", text: "First block." },
  { id: "scene_2", kind: "visual-only", duration: 2 }
];
window.__VIDEO_PLAN__ = VIDEO_PLAN;
</script>`;
  assert.equal(extractNarrationScript(html), "First block.");
});

test("extractNarrationScript handles bracket characters inside narration text", () => {
  const html = `<script>
const VIDEO_PLAN = [
  { id: "scene_1", kind: "narration+visual", audio: "audio/scene_1.wav", text: "Note ]; not the end." }
];
window.__VIDEO_PLAN__ = VIDEO_PLAN;
</script>`;
  assert.equal(extractNarrationScript(html), "Note ]; not the end.");
});

test("extractNarrationScript does not execute surrounding page code", () => {
  const html = `<script>
throw new Error("browser-only setup failed");
const VIDEO_PLAN = [
  { id: "scene_1", kind: "narration+visual", text: "Still readable." }
];
window.__VIDEO_PLAN__ = VIDEO_PLAN;
</script>`;
  assert.equal(extractNarrationScript(html), "Still readable.");
});

test("script gate fails closed when plan has no text or narration", async () => {
  const prev = process.env.VIDEO_SCRIPT_REVIEW;
  process.env.VIDEO_SCRIPT_REVIEW = "1";
  const dir = mkdtempSync(path.join(os.tmpdir(), "script-gate-empty-"));
  const htmlPath = path.join(dir, "index.html");
  writeFileSync(
    htmlPath,
    `<!doctype html><html><body><script>
window.__VIDEO_PLAN__ = [
  { id: "a", kind: "visual-only", duration: 2 }
];
</script></body></html>`,
    "utf8",
  );

  try {
    const gate = await runScriptGate({
      htmlPath,
      userPrompt: "test",
      workspaceDir: dir,
      model: "gemini-3.5-flash",
    });
    assert.equal(gate.scriptReview.passed, false);
    assert.match(
      gate.scriptReview.findings.join(" "),
      /No narration segments found in index\.html/,
    );
  } finally {
    if (prev === undefined) delete process.env.VIDEO_SCRIPT_REVIEW;
    else process.env.VIDEO_SCRIPT_REVIEW = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("script gate checks all multipart scene files", async () => {
  const prev = process.env.VIDEO_SCRIPT_REVIEW;
  process.env.VIDEO_SCRIPT_REVIEW = "1";
  const dir = mkdtempSync(path.join(os.tmpdir(), "script-gate-multipart-empty-"));
  const htmlPaths = [path.join(dir, "index1.html"), path.join(dir, "index2.html")];
  for (const htmlPath of htmlPaths) {
    writeFileSync(
      htmlPath,
      `<!doctype html><script>window.__VIDEO_PLAN__ = [
  { id: "visual", kind: "visual-only", duration: 2 }
];</script>`,
      "utf8",
    );
  }

  try {
    const gate = await runScriptGate({
      htmlPath: htmlPaths[0],
      htmlPaths,
      userPrompt: "test",
      workspaceDir: dir,
      model: "gemini-3.5-flash",
    });
    assert.equal(gate.scriptReview.passed, false);
    assert.deepEqual(gate.scriptReview.findings, [
      "No narration segments found in 2 scene file(s)",
    ]);
  } finally {
    if (prev === undefined) delete process.env.VIDEO_SCRIPT_REVIEW;
    else process.env.VIDEO_SCRIPT_REVIEW = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
