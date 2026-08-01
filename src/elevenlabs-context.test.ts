import assert from 'node:assert/strict';
import {
  elevenLabsContextForSection,
  narrationSpokenTextsInOrder,
  truncateElevenLabsNextText,
  truncateElevenLabsPreviousText,
} from './elevenlabs-context.ts';

assert.equal(truncateElevenLabsPreviousText('short'), 'short');
assert.equal(truncateElevenLabsPreviousText('x'.repeat(600))?.length, 500);
assert.equal(truncateElevenLabsPreviousText('x'.repeat(600)), 'x'.repeat(500));

assert.equal(truncateElevenLabsNextText('hello world'), 'hello world');
assert.equal(truncateElevenLabsNextText('y'.repeat(600))?.length, 500);
assert.equal(truncateElevenLabsNextText('y'.repeat(600)), 'y'.repeat(500));

const plan = [
  { id: 'a', kind: 'visual-only', duration: 2 },
  { id: 'b', kind: 'narration+visual', text: 'First line.' },
  { id: 'c', kind: 'narration+visual', text: 'Second line.' },
  { id: 'd', kind: 'narration+visual', text: 'Third line.' },
];

const normalizeKind = (kind: string | undefined) =>
  kind === 'narration+visual' ? 'narration+visual' : 'visual-only';
const normalizeText = (text: string) => text;

const items = narrationSpokenTextsInOrder(plan, normalizeKind, normalizeText);
assert.deepEqual(items.map((i) => i.id), ['b', 'c', 'd']);

assert.deepEqual(elevenLabsContextForSection(items, 'b'), {
  previousText: null,
  nextText: 'Second line. Third line.',
});
assert.deepEqual(elevenLabsContextForSection(items, 'c'), {
  previousText: 'First line.',
  nextText: 'Third line.',
});
assert.deepEqual(elevenLabsContextForSection(items, 'd'), {
  previousText: 'First line. Second line.',
  nextText: null,
});

const crossItems = [
  { id: 'x1', text: 'Prior scene line one.' },
  { id: 'x2', text: 'Prior scene line two.' },
];
const crossFollowing = 'Next scene opens here. Then continues.';
assert.deepEqual(
  elevenLabsContextForSection(items, 'b', {
    priorSceneText: crossItems.map((i) => i.text).join(' '),
  }),
  {
    previousText: 'Prior scene line one. Prior scene line two.',
    nextText: 'Second line. Third line.',
  }
);
assert.deepEqual(
  elevenLabsContextForSection(items, 'd', {
    followingSceneText: crossFollowing,
  }),
  {
    previousText: 'First line. Second line.',
    nextText: crossFollowing,
  }
);

console.log('elevenlabs-context.test.ts: ok');
