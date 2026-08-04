import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALIDATOR = path.join(__dirname, 'validate_contract.cjs');
const FIXTURES = path.join(__dirname, '..', 'tests', 'fixtures');

function runValidator(htmlPath: string) {
    return spawnSync(process.execPath, [VALIDATOR, htmlPath], {
        encoding: 'utf8',
        timeout: 30000,
    });
}

function overlapFindings(output: string): string[] {
    return output.split('\n').filter((line) => /overlaps/i.test(line));
}

describe('validate_contract layout sampling and dedupe', () => {
    it('fails when opaque DOM panel competes with canvas fill in the same region', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-dom-panel-canvas-overlap', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected overlap failure');
        assert.match(output, /overlaps/i);
    });

    it('passes when DOM text is nested inside its opaque parent panel', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-dom-text-in-panel-pass', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
        assert.doesNotMatch(output, /overlaps/i);
    });

    it('dedupes identical overlap findings across segments', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-dedupe-overlap', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected overlap failure');
        const overlaps = overlapFindings(output);
        assert.equal(overlaps.length, 1, `expected one overlap finding, got ${overlaps.length}: ${output}`);
    });

    it('reports separate overlap findings for distinct collision geometry', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-dedupe-distinct-overlap', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected overlap failure');
        const overlaps = overlapFindings(output);
        assert.equal(overlaps.length, 2, `expected two overlap findings, got ${overlaps.length}: ${output}`);
    });

    it('passes transient mid-only overlap under settle-only sampling', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-sampling-transient-pass', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
        assert.doesNotMatch(output, /overlaps/i);
    });

    it('passes mid overlap when non-text ink uses partial alpha (overlap skipped only)', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-sampling-partial-alpha-pass', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
        assert.doesNotMatch(output, /overlaps/i);
    });

    it('fails opaque mid overlap when layoutMidProbe samples the morph window', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-sampling-mid-overlap-fail', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected overlap failure when mid probe hits full-alpha overlap');
        assert.match(output, /overlaps/i);
    });
});
