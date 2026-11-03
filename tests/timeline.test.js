import test from "node:test";
import assert from "node:assert/strict";
import "../app/shared/timeline.js";

const TL = globalThis.MLTimeline;

test("MLTimeline builds correct total and locates beats", () => {
  const scenes = [
    {
      title: "Scene 1",
      beats: [
        { text: "Hello world", dur: 2.0 },
        { text: "Second beat", dur: 3.0 },
      ],
    },
    {
      title: "Scene 2",
      beats: [
        { text: "Third beat", dur: 4.0 },
      ],
    },
  ];

  const tl = TL.build(scenes);
  assert.equal(tl.scenes.length, 2);
  assert.ok(tl.total > 9.0); // includes beat gaps and scene pads

  const loc0 = TL.locate(tl, 0.5);
  assert.equal(loc0.scene, 0);
  assert.equal(loc0.beat, 0);

  const locEnd = TL.locate(tl, tl.total - 0.1);
  assert.equal(locEnd.scene, 1);
  assert.equal(locEnd.beat, 0);
});
