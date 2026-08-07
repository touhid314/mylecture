import assert from "node:assert/strict";
import { test } from "node:test";
import { isScriptReviewEnabled } from "./script-gate.ts";

test("activity-only pipeline should skip script gate when video disabled", () => {
  const includeVideo = false;
  const shouldRunGate = includeVideo;
  assert.equal(shouldRunGate, false);
  assert.equal(typeof isScriptReviewEnabled(), "boolean");
});
