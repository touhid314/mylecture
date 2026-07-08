import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compressLineHits,
  countPracticeFileLines,
  formatPracticeRepairContext,
  scanPracticeRepairHints
} from './practice-repair-context.ts';

test('scanPracticeRepairHints finds handler and layout regions', () => {
  const content = [
    '<style>',
    '.target-slot { border: 2px dashed #888; }',
    '@media (max-width: 600px) { .row-connector-label { font-size: 12px; } }',
    '</style>',
    '<script>',
    'function handleSlotClick(rowId, event) { event.stopPropagation(); }',
    'document.getElementById("chips-pool").onclick = selectChip;',
    '</script>'
  ].join('\n');

  const { lineCount, hints } = scanPracticeRepairHints(content);
  assert.equal(lineCount, 8);
  assert.ok(hints.some(h => h.category.includes('handlers')));
  assert.ok(hints.some(h => h.category.includes('slot markers')));
  assert.ok(hints.some(h => h.category.includes('mobile')));
});

test('formatPracticeRepairContext forbids full-file reads on large files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'practice-repair-'));
  const file = path.join(dir, 'index.html');
  try {
    const large = `${'<div>\n'.repeat(500)}<script>handleSlotClick();</script>\n`;
    writeFileSync(file, large, 'utf8');
    const context = formatPracticeRepairContext(file, 12);
    assert.match(context, /Do NOT read the entire file/);
    assert.match(context, /Turn budget: 12/);
    assert.match(context, /First edits must happen by turn 3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compressLineHits keeps a small representative sample', () => {
  const hits = Array.from({ length: 30 }, (_, i) => (i + 1) * 10);
  const compressed = compressLineHits(hits, 6);
  assert.equal(compressed.length, 6);
  assert.deepEqual(compressed, [10, 60, 110, 160, 210, 260]);
});

test('countPracticeFileLines handles empty content', () => {
  assert.equal(countPracticeFileLines(''), 0);
  assert.equal(countPracticeFileLines('a\nb'), 2);
});
