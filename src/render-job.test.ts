import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeCallbackError } from "./render-job.ts";

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
