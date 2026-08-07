import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listSourceScenePaths,
  sanitizeCallbackError,
} from "./render-job.ts";

test("listSourceScenePaths discovers multipart scenes in numeric order", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "render-scenes-"));
  try {
    await Promise.all([
      writeFile(path.join(workDir, "index10.html"), ""),
      writeFile(path.join(workDir, "index2.html"), ""),
      writeFile(path.join(workDir, "interactive.html"), ""),
    ]);
    assert.deepEqual(
      (await listSourceScenePaths(workDir)).map((filePath) => path.basename(filePath)),
      ["index2.html", "index10.html"],
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("sanitizeCallbackError preserves string queue failures", () => {
  assert.equal(
    sanitizeCallbackError(
      'LectureGen transfer failed (400): {"error":"multipart workspace rejected"}',
      "Render job failed",
    ),
    'LectureGen transfer failed (400): {"error":"multipart workspace rejected"}',
  );
});

test("sanitizeCallbackError still uses the fallback for unknown values", () => {
  assert.equal(sanitizeCallbackError(null, "Render job failed"), "Render job failed");
});
