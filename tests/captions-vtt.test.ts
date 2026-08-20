import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeLectureCaptionsVtt } from "../src/captions-vtt.ts";

test("writeLectureCaptionsVtt overwrites stale combined captions", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "mylecture-captions-vtt-"));
  const resolvedHtml = `<!DOCTYPE html>
<html>
<body>
<script>
window.__RESOLVED_TIMELINE__ = {
  "duration": 3,
  "subtitleTimeline": [
    { "start": 0.5, "end": 2.5, "text": "Fresh aligned caption" }
  ]
}
</script>
</body>
</html>`;
  writeFileSync(path.join(folder, "resolved.html"), resolvedHtml, "utf8");
  writeFileSync(
    path.join(folder, "captions.vtt"),
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nStale combined caption\n",
    "utf8",
  );

  const outputPath = writeLectureCaptionsVtt(folder);
  assert.ok(outputPath);
  assert.equal(outputPath, path.join(folder, "captions.vtt"));

  const vtt = readFileSync(outputPath!, "utf8");
  assert.match(vtt, /Fresh aligned caption/);
  assert.doesNotMatch(vtt, /Stale combined caption/);
  assert.match(vtt, /00:00:00\.500 --> 00:00:02\.500/);
});

test("writeLectureCaptionsVtt trims authored ellipses", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "mylecture-captions-ellipsis-"));
  const resolvedHtml = `<!DOCTYPE html>
<html>
<body>
<script>
window.__RESOLVED_TIMELINE__ = {
  "duration": 3,
  "subtitleTimeline": [
    { "start": 0.5, "end": 2.5, "text": "...for the world's first therapy." }
  ]
}
</script>
</body>
</html>`;
  writeFileSync(path.join(folder, "resolved.html"), resolvedHtml, "utf8");

  const outputPath = writeLectureCaptionsVtt(folder);
  const vtt = readFileSync(outputPath!, "utf8");
  assert.match(vtt, /for the world's first therapy\./);
  assert.doesNotMatch(vtt, /\.\.\./);
});
