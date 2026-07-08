import assert from 'node:assert/strict';
import test from 'node:test';
import {
  challengeTimerSeconds,
  DEFAULT_CHALLENGE_PACING,
  isChallengePacing,
  resolveChallengePacing
} from './challenge-pacing.ts';

test('resolveChallengePacing defaults unknown values to steady', () => {
  assert.equal(resolveChallengePacing(undefined), DEFAULT_CHALLENGE_PACING);
  assert.equal(resolveChallengePacing('turbo'), 'steady');
  assert.equal(resolveChallengePacing('relaxed'), 'relaxed');
});

test('isChallengePacing accepts only known bands', () => {
  assert.equal(isChallengePacing('brisk'), true);
  assert.equal(isChallengePacing('fast'), false);
});

test('challengeTimerSeconds maps bands to generous multi-step-friendly windows', () => {
  const relaxed = challengeTimerSeconds('relaxed');
  const steady = challengeTimerSeconds('steady');
  const brisk = challengeTimerSeconds('brisk');
  assert.equal(relaxed.start, 22);
  assert.equal(relaxed.min, 14);
  assert.ok(relaxed.start > steady.start);
  assert.ok(steady.start > brisk.start);
  assert.ok(brisk.min >= 8);
  assert.ok(relaxed.shrink >= 1 && relaxed.shrink <= 2);
});
