import assert from 'node:assert/strict';
import {
  assertVisualEditPreservesNarration,
  matchVideoPlanBlock,
  matchVideoPlanConstBlock,
  matchVideoPlanWindowAssignment,
  protectedVisualEditContent,
  restoreProtectedVisualBlocks,
} from './visual-edit-protect.ts';

const SAMPLE_BODY = `<main id="stage"><canvas id="canvas"></canvas></main>`;

const SAMPLE_METADATA = `window.__VIDEO_METADATA__ = {
      contractVersion: "0.2",
      title: "Test Scene",
      aspectRatio: "16:9"
    };`;

const SAMPLE_PLAN = `window.__VIDEO_PLAN__ = [
      { id: "scene_1", kind: "narration+visual", audio: "audio/scene_1.wav", text: "Hello" },
      { id: "scene_2", kind: "visual-only", duration: 2 }
    ];`;

const SAMPLE_RENDER = `window.__RENDER_SECTION__ = function renderSection(segment, localTime) {
      return;
    };`;

function buildSceneHtml(body = SAMPLE_BODY): string {
  return `<!DOCTYPE html><html><body>${body}
  <script>
    ${SAMPLE_METADATA}
    ${SAMPLE_PLAN}
    ${SAMPLE_RENDER}
  </script>
</body></html>`;
}

// matchVideoPlanBlock handles nested brackets in strings (non-greedy regex would truncate).
const planWithBracketInString = `window.__VIDEO_PLAN__ = [
  { id: "x", text: "note ]; not end" }
];`;

assert.equal(
  matchVideoPlanBlock(`<script>${planWithBracketInString}</script>`),
  planWithBracketInString
);

// Model deleted plan/metadata → restored, assert passes.
const original = buildSceneHtml();
const stripped = `<!DOCTYPE html><html><body>${SAMPLE_BODY}
  <script>
    ${SAMPLE_RENDER}
  </script>
</body></html>`;
const restoredFromStrip = restoreProtectedVisualBlocks(original, stripped);
assertVisualEditPreservesNarration(original, restoredFromStrip);
assert.ok(restoredFromStrip.includes('window.__VIDEO_METADATA__'));
assert.ok(restoredFromStrip.includes('window.__VIDEO_PLAN__'));
assert.ok(restoredFromStrip.includes(protectedVisualEditContent(original).metadata));
assert.ok(restoredFromStrip.includes(protectedVisualEditContent(original).plan));

// Model reformatted whitespace in plan → restored to original bytes.
const reformattedPlan = `window.__VIDEO_PLAN__=[{id:"scene_1",kind:"narration+visual",audio:"audio/scene_1.wav",text:"Hello"},{id:"scene_2",kind:"visual-only",duration:2}];`;
const reformatted = buildSceneHtml().replace(
  protectedVisualEditContent(original).plan,
  reformattedPlan
);
const restoredFromReformat = restoreProtectedVisualBlocks(original, reformatted);
assertVisualEditPreservesNarration(original, restoredFromReformat);
assert.ok(restoredFromReformat.includes(protectedVisualEditContent(original).plan));

// Visual body changed, protected blocks intact → unchanged protectors, body kept.
const newBody = `<main id="stage" class="wide"><canvas id="canvas" width="1920"></canvas></main>`;
const visualOnlyEdit = buildSceneHtml(newBody);
assertVisualEditPreservesNarration(original, visualOnlyEdit);
assert.ok(visualOnlyEdit.includes('class="wide"'));
assert.equal(
  protectedVisualEditContent(visualOnlyEdit).metadata,
  protectedVisualEditContent(original).metadata
);
assert.equal(
  protectedVisualEditContent(visualOnlyEdit).plan,
  protectedVisualEditContent(original).plan
);

// Source missing protectors → clear failure before applying model output.
assert.throws(
  () => restoreProtectedVisualBlocks('<html><body></body></html>', '<html><body></body></html>'),
  /missing required video metadata or narration plan/
);

// Corrupt truncated HTML with no script/body anchor still restores at end (insertion fallback).
const truncatedModified = '<html><head></head>';
const restoredTruncated = restoreProtectedVisualBlocks(original, truncatedModified);
assertVisualEditPreservesNarration(original, restoredTruncated);

// assert rejects when protectors differ (no restore applied).
const modifiedMetadata = buildSceneHtml().replace('title: "Test Scene"', 'title: "Other Scene"');
assert.throws(
  () => assertVisualEditPreservesNarration(original, modifiedMetadata),
  /attempted to change narration/
);

// LectureGen-style plan: const VIDEO_PLAN + window.__VIDEO_PLAN__ = VIDEO_PLAN
const SAMPLE_PLAN_CONST = `const VIDEO_PLAN = [
      { id: "scene_1", kind: "narration+visual", audio: "audio/scene_1.wav", text: "Hello" },
      { id: "scene_2", kind: "visual-only", duration: 2 }
    ];`;
const SAMPLE_PLAN_REF = 'window.__VIDEO_PLAN__ = VIDEO_PLAN;';

function buildLecturegenSceneHtml(body = SAMPLE_BODY): string {
  return `<!DOCTYPE html><html><body>${body}
  <script>
    ${SAMPLE_METADATA}
    ${SAMPLE_PLAN_CONST}
    ${SAMPLE_PLAN_REF}
    ${SAMPLE_RENDER}
  </script>
</body></html>`;
}

const lecturegenOriginal = buildLecturegenSceneHtml();
assert.ok(matchVideoPlanConstBlock(lecturegenOriginal));
assert.equal(matchVideoPlanWindowAssignment(lecturegenOriginal), SAMPLE_PLAN_REF);

const lecturegenStripped = `<!DOCTYPE html><html><body>${SAMPLE_BODY}
  <script>
    ${SAMPLE_RENDER}
  </script>
</body></html>`;
const lecturegenRestored = restoreProtectedVisualBlocks(lecturegenOriginal, lecturegenStripped);
assertVisualEditPreservesNarration(lecturegenOriginal, lecturegenRestored);
assert.ok(lecturegenRestored.includes(SAMPLE_PLAN_CONST));
assert.ok(lecturegenRestored.includes(SAMPLE_PLAN_REF));

console.log('visual-edit-protect.test.ts: ok');
