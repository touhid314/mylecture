import assert from 'node:assert/strict';
import test from 'node:test';
import { filterRepairableFindings, isLegacyShellChromeFinding, isQaInfrastructureFinding, isShellChromeFinding, joinReviewNotes, singleLineNote, splitStoredReviewNotes } from './review-notes.ts';

test('review notes round-trip preserves findings containing semicolons', () => {
  const findings = [
    'Interaction check: clicking a chip does not update selection; wire click handlers. Fix by wiring click/tap handlers.',
    'Responsive readability check: text below 14px minimum. Fix by reducing content.'
  ];
  assert.deepEqual(splitStoredReviewNotes(joinReviewNotes(findings)), findings);
});

test('legacy semicolon-joined notes without newlines restore as one finding', () => {
  const legacy = 'first finding; second finding; third finding';
  assert.deepEqual(splitStoredReviewNotes(legacy), [legacy]);
});

test('empty and whitespace-only notes return empty list', () => {
  assert.deepEqual(splitStoredReviewNotes(''), []);
  assert.deepEqual(splitStoredReviewNotes('   \n  \n '), []);
});

test('singleLineNote collapses embedded newlines into one line', () => {
  const collapsed = singleLineNote('agent exited with code 1\n  stderr: boom\n\ntimeout reached');
  assert.ok(!collapsed.includes('\n'));
  assert.equal(collapsed, 'agent exited with code 1; stderr: boom; timeout reached');
  assert.deepEqual(splitStoredReviewNotes(collapsed), [collapsed]);
});

test('singleLineNote leaves single-line messages unchanged', () => {
  assert.equal(singleLineNote('plain message'), 'plain message');
});

test('isQaInfrastructureFinding detects tooling failures', () => {
  assert.equal(isQaInfrastructureFinding('QA infrastructure error: __name is not defined'), true);
  assert.equal(isQaInfrastructureFinding('Interaction check: click handler missing'), false);
});

test('filterRepairableFindings drops infrastructure notes only', () => {
  const mixed = [
    'QA infrastructure error: timeout',
    'Interaction check: click-to-place not wired'
  ];
  assert.deepEqual(filterRepairableFindings(mixed), ['Interaction check: click-to-place not wired']);
  assert.deepEqual(filterRepairableFindings(['QA infrastructure error: boom']), []);
});

test('isShellChromeFinding detects tagged shell chrome readability notes', () => {
  const tagged = 'Responsive readability check: [phone main screen] [shell-chrome] body/prompt text below 16px target: "Goal: Reach a streak" renders at 14.0px.';
  assert.equal(isShellChromeFinding(tagged), true);
  assert.equal(isShellChromeFinding('Interaction check: click handler missing'), false);
  assert.equal(
    isShellChromeFinding('Responsive readability check: [phone main screen] body/prompt text below 16px: "see [shell-chrome] in quotes" renders at 14.0px.'),
    false
  );
});

test('isLegacyShellChromeFinding detects pre-tag shell chrome notes', () => {
  const legacy = 'Responsive readability check: [phone main screen] body/prompt text below 16px target: "Goal: Reach a streak" renders at 14.0px. Fix stage content — do not change shell chrome (#shell-*, tabs, counter).';
  assert.equal(isLegacyShellChromeFinding(legacy), true);
  assert.equal(isLegacyShellChromeFinding('Interaction check: click handler missing'), false);
});

test('filterRepairableFindings drops shell-chrome and legacy shell chrome notes', () => {
  const mixed = [
    'QA infrastructure error: timeout',
    'Responsive readability check: [phone main screen] [shell-chrome] body/prompt text below 16px target: "Goal: foo" renders at 14.0px. Shell chrome QA failure.',
    'Responsive readability check: [phone main screen] body/prompt text below 16px target: "Goal: bar" renders at 14.0px. Fix stage content — do not change shell chrome (#shell-*, tabs, counter).',
    'Interaction check: click-to-place not wired'
  ];
  assert.deepEqual(filterRepairableFindings(mixed), ['Interaction check: click-to-place not wired']);
});
