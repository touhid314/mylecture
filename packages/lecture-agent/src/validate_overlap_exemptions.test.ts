import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALIDATOR = path.join(__dirname, 'validate_contract.cjs');
const PASS_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-pass', 'index.html');
const FAIL_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-fail', 'index.html');
const FAIL_OFFSET_STROKE_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-fail-offset-stroke', 'index.html');
const FAIL_THIN_OFFSET_STROKE_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-fail-thin-offset-stroke', 'index.html');
const FAIL_PARTIAL_DOM_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-fail-partial-dom', 'index.html');
const PASS_THICK_STROKE_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-pass-thick-stroke', 'index.html');
const PASS_MATCHING_FILLS_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-pass-matching-fills', 'index.html');
const PASS_CHIP_LABEL_FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'overlap-exemptions-pass-chip-label', 'index.html');

function runValidator(htmlPath: string) {
    return spawnSync(process.execPath, [VALIDATOR, htmlPath], {
        encoding: 'utf8',
        timeout: 30000,
    });
}

describe('validate_contract overlap exemptions', () => {
    it('passes fillRect+strokeRect bordered card and canvas panel under nested DOM text', () => {
        const result = runValidator(PASS_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
    });

    it('still fails when two canvas fillTexts overlap at the same position', () => {
        const result = runValidator(FAIL_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected validation failure');
        assert.match(output, /Temporal layout check failed:.*overlaps/i);
        assert.match(output, /fillText/i);
    });

    it('still fails when offset strokeRect overlaps fillRect (same size, not edge-aligned)', () => {
        const result = runValidator(FAIL_OFFSET_STROKE_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected validation failure');
        assert.match(output, /Temporal layout check failed:.*overlaps/i);
        assert.match(output, /strokeRect/i);
        assert.match(output, /fillRect/i);
    });

    it('fails thin-stroke offsets that the old 8px fudge would have allowed', () => {
        const result = runValidator(FAIL_THIN_OFFSET_STROKE_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected validation failure');
        assert.match(output, /Temporal layout check failed:.*overlaps/i);
        assert.match(output, /strokeRect/i);
        assert.match(output, /fillRect/i);
    });

    it('passes thick same-path strokeRect borders (lineWidth-based match)', () => {
        const result = runValidator(PASS_THICK_STROKE_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
    });

    it('passes same-path fillRect wash + solid double-draws', () => {
        const result = runValidator(PASS_MATCHING_FILLS_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.equal(result.status, 0, output);
        assert.match(output, /HTML contract validation passed/i);
    });

    it('does not flag overlap for canvas text inside a tight panel (padding still enforced)', () => {
        const result = runValidator(PASS_CHIP_LABEL_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected padding failure on under-padded chip');
        assert.doesNotMatch(output, /overlaps/i);
        assert.match(output, /panel padding/i);
    });

    it('still fails when DOM text is only partially inside a canvas panel (<85% containment)', () => {
        const result = runValidator(FAIL_PARTIAL_DOM_FIXTURE);
        const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
        assert.notEqual(result.status, 0, 'expected validation failure');
        assert.match(output, /Temporal layout check failed:.*overlaps/i);
        assert.match(output, /dom/i);
        assert.match(output, /fillRect/i);
    });
});
