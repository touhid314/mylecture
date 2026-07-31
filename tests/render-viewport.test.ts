import assert from "node:assert/strict";
import {
  ensureEvenDimension,
  scaleViewportToMaxShortEdge,
} from "../src/render-video.ts";

assert.equal(ensureEvenDimension(481), 482);
assert.equal(ensureEvenDimension(480), 480);

const portrait = scaleViewportToMaxShortEdge(1080, 1920, 480);
assert.equal(portrait.width, 480);
assert.equal(portrait.height, 854);

const landscape = scaleViewportToMaxShortEdge(1920, 1080, 480);
assert.equal(landscape.width, 854);
assert.equal(landscape.height, 480);

const unchanged = scaleViewportToMaxShortEdge(320, 240, 480);
assert.equal(unchanged.width, 320);
assert.equal(unchanged.height, 240);

console.log("render-viewport.test passed");
