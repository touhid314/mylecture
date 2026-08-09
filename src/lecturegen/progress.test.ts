import assert from "node:assert/strict";
import { test } from "node:test";
import { createProgressInterpreter } from "./progress.ts";

test("progress interpreter emits public scene boundaries without validator details", () => {
  const interpret = createProgressInterpreter();
  assert.equal(interpret("[lecturegen] Writing the audiovisual script with model...")?.stage, "script");
  assert.deepEqual(
    interpret("[lecturegen] Split the script into 3 narration-based animation block(s)"),
    {
      stage: "scene-generation",
      message: "Preparing 3 scenes",
      completedScenes: 0,
      totalScenes: 3,
    },
  );
  assert.equal(
    interpret("[lecturegen] Animating index2.html from script block 2/3 (80 narration words)...")?.message,
    "Creating scene 2 of 3",
  );
  const repair = interpret("index2.html HTML contract validation failed: secret detail");
  assert.equal(repair?.stage, "scene-repair");
  assert.equal(repair?.message, "Refining scene 2 of 3");
  assert.equal(JSON.stringify(repair).includes("secret detail"), false);
  const passed = interpret("index2.html HTML contract validation passed");
  assert.equal(passed?.completedScenes, 2);
});
