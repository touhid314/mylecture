import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLectureGenProgressCallbackPayload } from "../../src/lecturegen/callback.ts";

test("progress callback idempotency is scoped by source version and sequence", () => {
  const payload = buildLectureGenProgressCallbackPayload({
    websiteJobId: "website-1",
    generationId: "generation-1",
    progress: {
      sourceVersion: 3,
      sequence: 8,
      stage: "scene-validation",
      message: "Scene 2 of 4 is ready",
      currentScene: 2,
      totalScenes: 4,
      startedAt: 100,
      updatedAt: 123,
    },
  });
  assert.equal(payload.status, "progress");
  assert.equal(payload.idempotencyKey, "generation-1:v3:progress:8");
  assert.equal(payload.progress?.sequence, 8);
});
