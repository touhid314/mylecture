import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  lectureUsagePath,
  parseCostUsdFromOutput,
  readLectureUsageCostUsd,
  resolveLectureCostUsd,
  summarizeSpawnFailure
} from './spawn.ts';

describe('parseCostUsdFromOutput', () => {
  it('returns 0 when no cost line is present', () => {
    assert.equal(parseCostUsdFromOutput('HTML contract validation passed'), 0);
  });

  it('reads the last cost=$ line', () => {
    const output = [
      'tokens input=10 output=4',
      'cost=$0.0123',
      'Generation folder: C:\\tmp\\lecture',
      'cost=$1.2500'
    ].join('\n');
    assert.equal(parseCostUsdFromOutput(output), 1.25);
  });
});

describe('readLectureUsageCostUsd', () => {
  it('returns 0 when the usage file is missing', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-cost-'));
    assert.equal(readLectureUsageCostUsd(dir), 0);
  });

  it('sums costUsd across valid JSONL lines and ignores junk', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-cost-'));
    const usagePath = lectureUsagePath(dir);
    writeFileSync(
      usagePath,
      [
        JSON.stringify({
          sessionId: '01-lecture',
          model: 'gemini-3-flash',
          purpose: 'test',
          inputTokens: 100,
          outputTokens: 50,
          cachedInputTokens: 0,
          costUsd: 0.0125,
          at: '2026-08-14T00:00:00.000Z'
        }),
        'not json',
        JSON.stringify({
          sessionId: '01-lecture',
          model: 'gemini-3-flash',
          purpose: 'test-2',
          inputTokens: 200,
          outputTokens: 80,
          cachedInputTokens: 10,
          costUsd: 0.0375,
          at: '2026-08-14T00:01:00.000Z'
        }),
        ''
      ].join('\n'),
      'utf8'
    );
    assert.equal(readLectureUsageCostUsd(dir), 0.05);
  });

  it('ignores lines with costUsd null', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-cost-'));
    writeFileSync(
      lectureUsagePath(dir),
      [
        JSON.stringify({ sessionId: 'x', model: 'm', purpose: 'p', costUsd: null, at: '2026-08-14T00:00:00.000Z' }),
        JSON.stringify({ sessionId: 'x', model: 'm', purpose: 'p2', costUsd: 0.01, at: '2026-08-14T00:01:00.000Z' })
      ].join('\n'),
      'utf8'
    );
    assert.equal(readLectureUsageCostUsd(dir), 0.01);
  });

  it('estimates costUsd null lines when the model is in the price table', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-cost-'));
    writeFileSync(
      lectureUsagePath(dir),
      JSON.stringify({
        sessionId: 'x',
        model: 'gemini-3.7-flash',
        purpose: 'lecturegen_animator_block_1',
        inputTokens: 100_000,
        outputTokens: 5_000,
        cachedInputTokens: 0,
        costUsd: null,
        at: '2026-08-15T00:00:00.000Z'
      }),
      'utf8'
    );
    assert.ok(readLectureUsageCostUsd(dir) > 0.1);
  });

  it('returns 0 for an existing file with no billable lines', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-cost-'));
    writeFileSync(
      lectureUsagePath(dir),
      JSON.stringify({ sessionId: 'x', model: 'm', purpose: 'p', costUsd: null, at: '2026-08-14T00:00:00.000Z' }),
      'utf8'
    );
    assert.equal(readLectureUsageCostUsd(dir), 0);
  });
});

describe('resolveLectureCostUsd', () => {
  it('uses jsonl sum when the usage file exists, even if zero', () => {
    assert.equal(
      resolveLectureCostUsd({ jsonlExists: true, jsonlCost: 0, stdoutCost: 1.5, previousCost: 0.75 }),
      0
    );
  });

  it('uses jsonl sum when the usage file exists with positive cost', () => {
    assert.equal(
      resolveLectureCostUsd({ jsonlExists: true, jsonlCost: 0.1234, stdoutCost: 0, previousCost: 0 }),
      0.1234
    );
  });

  it('falls back to max(previous, stdout) when jsonl is missing and stdout has cost', () => {
    assert.equal(
      resolveLectureCostUsd({ jsonlExists: false, jsonlCost: 0, stdoutCost: 0.5, previousCost: 0.75 }),
      0.75
    );
    assert.equal(
      resolveLectureCostUsd({ jsonlExists: false, jsonlCost: 0, stdoutCost: 1.25, previousCost: 0.75 }),
      1.25
    );
  });

  it('preserves previous cost when jsonl is missing and stdout is empty', () => {
    assert.equal(
      resolveLectureCostUsd({ jsonlExists: false, jsonlCost: 0, stdoutCost: 0, previousCost: 0.42 }),
      0.42
    );
  });
});

describe('summarizeSpawnFailure', () => {
  it('prefers Cannot find module over run_main line', () => {
    const stderr = [
      'node:internal/modules/run_main:105',
      'triggerUncaughtException(',
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\\\missing\\\\build-plan.ts'"
    ].join('\n');
    assert.match(
      summarizeSpawnFailure('', stderr, 'node', 1),
      /Cannot find module/
    );
  });
});
