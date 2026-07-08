import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boxArea,
  findOverlappingPairs,
  overlapRatio,
  type LayoutBox
} from './layout-overlap.ts';

function box(
  left: number,
  top: number,
  right: number,
  bottom: number,
  extra: Partial<LayoutBox> = {}
): LayoutBox {
  return { left, top, right, bottom, ...extra };
}

test('boxArea and overlapRatio for partial overlap', () => {
  const a = box(0, 0, 100, 100);
  const b = box(50, 50, 150, 150);
  assert.equal(boxArea(a), 10000);
  assert.ok(Math.abs(overlapRatio(a, b) - 0.25) < 1e-9);
});

test('overlapRatio is 0 for separated boxes', () => {
  assert.equal(overlapRatio(box(0, 0, 10, 10), box(20, 20, 30, 30)), 0);
});

test('findOverlappingPairs reports collisions above threshold', () => {
  const findings = findOverlappingPairs([
    box(0, 0, 100, 100, { text: 'Panel A', index: 0 }),
    box(40, 40, 140, 140, { text: 'Panel B', index: 1 })
  ], { minRatio: 0.3 });
  assert.equal(findings.length, 1);
  assert.ok(findings[0].includes('overlapping content'));
  assert.ok(findings[0].includes('Panel A'));
});

test('findOverlappingPairs skips parent/child pairs', () => {
  const findings = findOverlappingPairs([
    box(0, 0, 200, 200, { text: 'Parent', index: 0, parentIndex: null }),
    box(10, 10, 50, 50, { text: 'Child', index: 1, parentIndex: 0 })
  ], { minRatio: 0.3 });
  assert.equal(findings.length, 0);
});

test('findOverlappingPairs can ignore identical text', () => {
  const findings = findOverlappingPairs([
    box(0, 0, 100, 100, { text: 'Same', index: 0 }),
    box(20, 20, 120, 120, { text: 'Same', index: 1 })
  ], { minRatio: 0.3, ignoreSameText: true });
  assert.equal(findings.length, 0);
});
