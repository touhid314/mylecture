import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePracticeHtmlStructure } from './review-practice.ts';

test('validatePracticeHtmlStructure flags missing style close before head close', () => {
  const findings = validatePracticeHtmlStructure([
    '<!doctype html>',
    '<html>',
    '<head>',
    '<style>',
    'body { color: white; }',
    '</head>',
    '<body>Practice</body>',
    '</html>'
  ].join('\n'));

  assert.ok(findings.some(finding => finding.includes('missing closing </style>')));
});

test('validatePracticeHtmlStructure passes balanced style and body tags', () => {
  const findings = validatePracticeHtmlStructure([
    '<!doctype html>',
    '<html>',
    '<head>',
    '<style>',
    'body { color: white; }',
    '</style>',
    '</head>',
    '<body>Practice</body>',
    '</html>'
  ].join('\n'));

  assert.deepEqual(findings, []);
});
