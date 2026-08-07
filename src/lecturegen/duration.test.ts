import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGenerationLengthFromSeconds } from "./duration.ts";

test("formatGenerationLengthFromSeconds formats sub-minute targets", () => {
  assert.equal(formatGenerationLengthFromSeconds(45), "45s");
});

test("formatGenerationLengthFromSeconds formats minute targets", () => {
  assert.equal(formatGenerationLengthFromSeconds(90), "1:30");
  assert.equal(formatGenerationLengthFromSeconds(120), "2:00");
});

test("formatGenerationLengthFromSeconds rejects invalid input", () => {
  assert.equal(formatGenerationLengthFromSeconds(undefined), undefined);
  assert.equal(formatGenerationLengthFromSeconds(0), undefined);
});
