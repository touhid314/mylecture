import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeInteractionDom, type InteractionDomSnapshot } from './interaction-qa.ts';

function baseSnapshot(overrides: Partial<InteractionDomSnapshot> = {}): InteractionDomSnapshot {
  return {
    instructionText: 'How to play: Drag or tap each item onto its correct position, then press Check.',
    hasPracticeOrChallenge: true,
    dashedMarkersInStage: [],
    placedItemsInStage: [],
    ...overrides
  };
}

test('analyzeInteractionDom flags multiple visible dashed markers in practice before attempt', () => {
  const findings = analyzeInteractionDom(baseSnapshot({
    dashedMarkersInStage: [
      { width: 40, height: 40, centerX: 100, centerY: 50 },
      { width: 40, height: 40, centerX: 200, centerY: 50 },
      { width: 40, height: 40, centerX: 300, centerY: 50 }
    ]
  }));
  assert.ok(findings.some(f => f.includes('dashed placement markers')));
});

test('analyzeInteractionDom flags dashed markers when instructions use drag wording without place/slot', () => {
  const findings = analyzeInteractionDom(baseSnapshot({
    instructionText: 'How to play: Drag each chip onto the number line, then press Check.',
    dashedMarkersInStage: [
      { width: 40, height: 40, centerX: 100, centerY: 50 },
      { width: 40, height: 40, centerX: 200, centerY: 50 }
    ]
  }));
  assert.ok(findings.some(f => f.includes('dashed placement markers')));
});

test('analyzeInteractionDom ignores decorative dashed markers without placement-action instructions', () => {
  const findings = analyzeInteractionDom(baseSnapshot({
    instructionText: 'Answer each question, then check your work.',
    dashedMarkersInStage: [
      { width: 40, height: 40, centerX: 100, centerY: 50 },
      { width: 40, height: 40, centerX: 200, centerY: 50 }
    ]
  }));
  assert.ok(!findings.some(f => f.includes('dashed placement markers')));
});

test('analyzeInteractionDom flags dashed marker overlapping a placed item', () => {
  const rect = { width: 54, height: 54, centerX: 150, centerY: 60 };
  const findings = analyzeInteractionDom(baseSnapshot({
    dashedMarkersInStage: [rect],
    placedItemsInStage: [rect]
  }));
  assert.ok(findings.some(f => f.includes('overlaps a dashed placement marker')));
});

test('analyzeInteractionDom passes clean placement layout', () => {
  const findings = analyzeInteractionDom(baseSnapshot({
    instructionText: 'How to play: Click Check when finished.',
    hasPracticeOrChallenge: false,
    dashedMarkersInStage: [],
    placedItemsInStage: [{ width: 54, height: 54, centerX: 150, centerY: 60 }]
  }));
  assert.equal(findings.length, 0);
});
