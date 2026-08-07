import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractNarrationScript, runScriptGate } from "./script-gate.ts";

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
