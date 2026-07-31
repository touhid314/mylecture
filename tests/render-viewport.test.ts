import assert from "node:assert/strict";
import {
  buildVideoScaleFilter,
  ensureEvenDimension,
  resolveCaptureAndOutputDimensions,
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

const resolvedLandscape = resolveCaptureAndOutputDimensions(1920, 1080, 480);
assert.equal(resolvedLandscape.capture.width, 1920);
assert.equal(resolvedLandscape.capture.height, 1080);
assert.equal(resolvedLandscape.output.width, 854);
assert.equal(resolvedLandscape.output.height, 480);

const resolvedNoCap = resolveCaptureAndOutputDimensions(1920, 1080, null);
assert.deepEqual(resolvedNoCap.capture, resolvedNoCap.output);

assert.equal(
  buildVideoScaleFilter({
    width: 1920,
    height: 1080,
    outputWidth: 854,
    outputHeight: 480,
    colorRange: "tv",
  }),
  "scale=854:480:flags=lanczos,scale=in_range=pc:out_range=tv",
);

assert.equal(
  buildVideoScaleFilter({
    width: 1920,
    height: 1080,
    outputWidth: 1920,
    outputHeight: 1080,
    colorRange: "tv",
  }),
  "scale=in_range=pc:out_range=tv",
);

console.log("render-viewport.test passed");
