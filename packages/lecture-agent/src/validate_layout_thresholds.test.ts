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

describe('validate_contract layout severity floors', () => {
    it('passes when panel pad shortfall is below the 12px floor (~9px)', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-thresholds-pass-small-pad', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
        assert.doesNotMatch(output, /panel padding/i);
    });

    it('still fails when panel pad shortfall exceeds the 12px floor (~20px)', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-thresholds-fail-large-pad', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected padding failure');
        assert.match(output, /panel padding/i);
    });

    it('passes when text is on-screen but closer than theme 5% guidance (30px inset on 1080p)', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-thresholds-pass-safe-zone', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
        assert.doesNotMatch(output, /safe-zone/i);
    });

    it('passes when DOM text is flush to the viewport edge (4px inset)', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-thresholds-pass-safe-zone-near', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
        assert.doesNotMatch(output, /safe-zone/i);
    });

    it('fails when text is clipped outside the viewport', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-thresholds-fail-safe-zone-clip', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected safe-zone failure');
        assert.match(output, /safe-zone/i);
    });

    it('passes when shape-only overlap area is just under 4500px²', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-thresholds-pass-shape-overlap', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
        assert.doesNotMatch(output, /overlaps/i);
    });

    it('fails when shape-only overlap area exceeds 4500px²', () => {
        const result = runValidator(path.join(FIXTURES, 'layout-thresholds-fail-shape-overlap', 'index.html'));
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected overlap failure');
        assert.match(output, /overlaps/i);
    });
});
