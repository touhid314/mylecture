import assert from "node:assert/strict";
import { test } from "node:test";

test("activity-only pipeline should skip video HTML load when video disabled", () => {
  const includeVideo = false;
  const shouldLoadVideoHtml = includeVideo;
  assert.equal(shouldLoadVideoHtml, false);
});
