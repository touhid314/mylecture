import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMechanicalHtml } from './mechanical_html_normalization.js';

describe('mechanical HTML normalization', () => {
    it('corrects only a six-argument Canvas typo on a known 2D context', () => {
        const input = `<script>
const ctx = document.querySelector('canvas').getContext('2d');
ctx.cubicCurveTo(1, 2, 3, 4, 5, 6);
ctx.cubicCurveTo(1, 2, 3);
</script>`;
        const result = normalizeMechanicalHtml(input);
        assert.match(result.html, /ctx\.bezierCurveTo\(1, 2, 3, 4, 5, 6\)/);
        assert.match(result.html, /ctx\.cubicCurveTo\(1, 2, 3\)/);
        assert.deepEqual(result.changes, ['corrected 1 unambiguous cubicCurveTo call(s) to bezierCurveTo']);
    });

    it('does not rewrite examples in strings or comments', () => {
        const input = `<script>
const ctx = canvas.getContext('2d');
const example = "ctx.cubicCurveTo(1, 2, 3, 4, 5, 6)";
// ctx.cubicCurveTo(1, 2, 3, 4, 5, 6)
</script>`;
        const result = normalizeMechanicalHtml(input);
        assert.equal(result.html, input);
        assert.deepEqual(result.changes, []);
    });

    it('removes numeric duration only from narration+visual plan objects', () => {
        const input = `<script>
window.__VIDEO_PLAN__ = [
  { id: 'n1', kind: 'narration+visual', text: 'Hello', audio: 'n1.wav', duration: 3 },
  { id: 'v1', kind: 'visual-only', duration: 3 }
];
</script>`;
        const result = normalizeMechanicalHtml(input);
        assert.doesNotMatch(result.html, /audio: 'n1\.wav', duration/);
        assert.match(result.html, /kind: 'visual-only', duration: 3/);
        assert.deepEqual(result.changes, ['removed duration from 1 narration+visual segment(s)']);
    });

    it('leaves ambiguous computed durations unchanged', () => {
        const input = `<script>
window.__VIDEO_PLAN__ = [{ id: 'n1', kind: 'narration+visual', duration: estimateDuration() }];
</script>`;
        const result = normalizeMechanicalHtml(input);
        assert.equal(result.html, input);
        assert.deepEqual(result.changes, []);
    });
});
