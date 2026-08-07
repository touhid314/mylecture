import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { countTemporalLayoutErrors, findInlineScriptSyntaxError, hasRewriteableLayoutValidation, isTemporalLayoutValidation, nextSyntaxCleanAnchor, revertToLastViable, shouldRequestLayoutRewrite } from './animator.js';

const VALID_HTML = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
<script>
window.__VIDEO_START__ = 0;
function draw() { return 1; }
</script>
<script src="external.js"></script>
</body>
</html>`;

describe('findInlineScriptSyntaxError', () => {
    it('returns null for valid inline script HTML', () => {
        assert.equal(findInlineScriptSyntaxError(VALID_HTML), null);
    });

    it('detects top-level return (Illegal return statement)', () => {
        const html = `<!DOCTYPE html><html><body><script>
return 42;
</script></body></html>`;
        const error = findInlineScriptSyntaxError(html);
        assert.ok(error);
        assert.match(error!, /inline script 1:/);
        assert.match(error!, /Illegal return statement|SyntaxError/i);
    });

    it('detects duplicate let/const identifier', () => {
        const html = `<!DOCTYPE html><html><body><script>
let shift = 1;
const shift = 2;
</script></body></html>`;
        const error = findInlineScriptSyntaxError(html);
        assert.ok(error);
        assert.match(error!, /inline script 1:/);
        assert.match(error!, /shift|already been declared|SyntaxError/i);
    });

    it('ignores external script tags with src attribute', () => {
        const html = `<!DOCTYPE html><html><body>
<script src="broken.js"></script>
<script>
window.__VIDEO_START__ = 0;
</script>
</body></html>`;
        assert.equal(findInlineScriptSyntaxError(html), null);
    });

    it('reports the first failing inline script when multiple exist', () => {
        const html = `<!DOCTYPE html><html><body>
<script>let a = 1;</script>
<script>return 0;</script>
<script>let b = 2;</script>
</body></html>`;
        const error = findInlineScriptSyntaxError(html);
        assert.ok(error);
        assert.match(error!, /inline script 2:/);
    });

    it('ignores inline module scripts', () => {
        const html = `<!DOCTYPE html><html><body>
<script type="module">
export default 1;
import x from 'y';
</script>
<script>
window.__VIDEO_START__ = 0;
</script>
</body></html>`;
        assert.equal(findInlineScriptSyntaxError(html), null);
    });
});

describe('nextSyntaxCleanAnchor', () => {
    const syntaxBrokenHtml = '<html><script>return 1;</script></html>';
    const syntaxCleanHtml = '<html><script>window.__VIDEO_START__ = 0;</script></html>';
    const syntaxCleanHtml2 = '<html><script>window.__VIDEO_START__ = 1;</script></html>';

    it('advances anchor when html is syntax-clean even if contract validation would be scriptBroken', () => {
        const result = nextSyntaxCleanAnchor(syntaxCleanHtml, syntaxBrokenHtml);
        assert.equal(result.anchor, syntaxCleanHtml);
        assert.equal(result.isSyntaxClean, true);
    });

    it('keeps prior syntax-clean anchor when html regains a syntax error', () => {
        const first = nextSyntaxCleanAnchor(syntaxCleanHtml, syntaxBrokenHtml);
        const second = nextSyntaxCleanAnchor(syntaxBrokenHtml, first.anchor);
        assert.equal(second.anchor, syntaxCleanHtml);
        assert.equal(second.isSyntaxClean, true);
    });

    it('does not advance anchor when html and current anchor are both syntax-broken', () => {
        const result = nextSyntaxCleanAnchor(syntaxBrokenHtml, syntaxBrokenHtml);
        assert.equal(result.anchor, syntaxBrokenHtml);
        assert.equal(result.isSyntaxClean, false);
    });

    it('updates anchor to newer syntax-clean html on subsequent repairs', () => {
        const first = nextSyntaxCleanAnchor(syntaxCleanHtml, syntaxBrokenHtml);
        const second = nextSyntaxCleanAnchor(syntaxCleanHtml2, first.anchor);
        assert.equal(second.anchor, syntaxCleanHtml2);
        assert.equal(second.isSyntaxClean, true);
    });

    it('models repair A then repair B revert target (stage-5 blocker scenario)', () => {
        let anchor = syntaxBrokenHtml;
        let isClean = false;

        ({ anchor, isSyntaxClean: isClean } = nextSyntaxCleanAnchor(syntaxBrokenHtml, anchor));
        assert.equal(isClean, false);

        const afterRepairA = syntaxCleanHtml;
        ({ anchor, isSyntaxClean: isClean } = nextSyntaxCleanAnchor(afterRepairA, anchor));
        assert.equal(anchor, afterRepairA);
        assert.equal(isClean, true);

        const afterRepairB = '<html><script>return 2;</script></html>';
        ({ anchor, isSyntaxClean: isClean } = nextSyntaxCleanAnchor(afterRepairB, anchor));
        assert.equal(anchor, afterRepairA);
        assert.equal(isClean, true);
        assert.notEqual(anchor, syntaxBrokenHtml);
    });
});

describe('revertToLastViable', () => {
    it('writes last viable html to disk and returns it', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animator-revert-'));
        const target = path.join(dir, 'index1.html');
        const broken = '<html><script>return 1;</script></html>';
        const viable = '<html><script>window.__VIDEO_START__ = 0;</script></html>';
        fs.writeFileSync(target, broken, 'utf8');

        const result = revertToLastViable(target, viable);

        assert.equal(result, viable);
        assert.equal(fs.readFileSync(target, 'utf8'), viable);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('isTemporalLayoutValidation', () => {
    const layoutOnly = `HTML contract validation failed for index1.html (exit 1):
HTML contract validation failed (mode: playwright):
 - Temporal layout check failed: canvas fillText ("Vulnerable Free Space") overlaps canvas fillText ("Vulnerable Free Space")
 - Temporal layout check failed: panel padding shortfall for "Empty Gaps"`;

    it('returns true for temporal layout-only failures', () => {
        assert.equal(isTemporalLayoutValidation(layoutOnly), true);
    });

    it('returns false when validation passed', () => {
        assert.equal(
            isTemporalLayoutValidation('HTML contract validation passed for index1.html: OK'),
            false
        );
    });

    it('returns false for script-before-globals failures', () => {
        const validation = `HTML contract validation failed (mode: playwright):
 - Browser script error before contract globals: SyntaxError: Unexpected token '}'`;
        assert.equal(isTemporalLayoutValidation(validation), false);
    });

    it('returns false when temporal layout and script-before-globals are mixed', () => {
        const validation = `${layoutOnly}
 - Browser script error before contract globals: SyntaxError: Unexpected token '}'`;
        assert.equal(isTemporalLayoutValidation(validation), false);
    });

    it('returns false when temporal layout is mixed with other contract errors', () => {
        const validation = `HTML contract validation failed (mode: playwright):
 - Temporal layout check failed: panel padding shortfall for "Empty Gaps"
 - Missing window.__VIDEO_PLAN__`;
        assert.equal(isTemporalLayoutValidation(validation), false);
    });

    it('returns false when marker appears without bullet error lines (truncated text)', () => {
        const validation = 'HTML contract validation failed (mode: playwright):\nTemporal layout check failed:';
        assert.equal(isTemporalLayoutValidation(validation), false);
    });
});

describe('shouldRequestLayoutRewrite', () => {
    const layoutOnly = `HTML contract validation failed (mode: playwright):
 - Temporal layout check failed: canvas fillText ("label") overlaps canvas fillText ("label")`;

    function layoutValidation(errorCount: number): string {
        const bullets = Array.from({ length: errorCount }, (_, index) =>
            ` - Temporal layout check failed: canvas fillText ("label${index}") overlaps canvas fillText ("other${index}")`
        );
        return `HTML contract validation failed (mode: playwright):\n${bullets.join('\n')}`;
    }

    it('requests rewrite on the last repair attempt for layout-only failures', () => {
        assert.equal(shouldRequestLayoutRewrite(4, 5, layoutOnly), true);
    });

    it('does not request rewrite on the first attempt for a single layout error', () => {
        assert.equal(shouldRequestLayoutRewrite(0, 5, layoutOnly), false);
    });

    it('requests rewrite immediately when many layout errors are reported', () => {
        assert.equal(shouldRequestLayoutRewrite(0, 5, layoutValidation(8)), true);
    });

    it('escalates mixed SCENE_LAYOUT and temporal failures to a rewrite', () => {
        const mixedValidation = `HTML contract validation failed (mode: playwright):
 - SCENE_LAYOUT key check failed: SCENE_LAYOUT.words.forEach is referenced but not defined
 - Temporal layout check failed: canvas fill overlaps dom #word-testament by 256x77px
 - Temporal layout check failed: canvas fill overlaps dom #word-tapestry by 253x84px
 - Temporal layout check failed: canvas fill overlaps dom #word-moreover by 248x76px`;

        assert.equal(isTemporalLayoutValidation(mixedValidation), false);
        assert.equal(hasRewriteableLayoutValidation(mixedValidation), true);
        assert.equal(shouldRequestLayoutRewrite(1, 5, mixedValidation), true);
    });

    it('requests rewrite on attempt 1 when many layout errors remain', () => {
        assert.equal(shouldRequestLayoutRewrite(1, 5, layoutValidation(9)), true);
    });

    it('requests rewrite on attempt 1 when several layout errors remain', () => {
        assert.equal(shouldRequestLayoutRewrite(1, 5, layoutValidation(3)), true);
    });

    it('requests rewrite on attempt 1 after two failed JSON repairs', () => {
        assert.equal(shouldRequestLayoutRewrite({
            attempt: 1,
            maximumRepairs: 5,
            validation: layoutOnly,
            consecutiveFailedRepairs: 2,
        }), true);
    });

    it('requests rewrite on attempt 1 after two unimproved JSON repairs', () => {
        assert.equal(shouldRequestLayoutRewrite({
            attempt: 1,
            maximumRepairs: 5,
            validation: layoutValidation(2),
            consecutiveUnimprovedRepairs: 2,
        }), true);
    });

    it('requests rewrite after a prior layout rewrite instead of more JSON edits', () => {
        assert.equal(shouldRequestLayoutRewrite({
            attempt: 1,
            maximumRepairs: 5,
            validation: layoutOnly,
            priorLayoutRewrite: true,
        }), true);
    });

    it('does not request rewrite for non-layout failures even on last attempt', () => {
        const scriptBroken = `HTML contract validation failed (mode: playwright):
 - Browser script error before contract globals: SyntaxError: Unexpected token '}'`;
        assert.equal(shouldRequestLayoutRewrite(4, 5, scriptBroken), false);
    });

    it('does not rewrite mixed layout output when a browser syntax error is present', () => {
        const syntaxAndLayout = `${layoutOnly}
 - Browser script error before contract globals: SyntaxError: Unexpected token '}'`;
        assert.equal(hasRewriteableLayoutValidation(syntaxAndLayout), false);
        assert.equal(shouldRequestLayoutRewrite(4, 5, syntaxAndLayout), false);
    });

    it('respects maximumRepairs when choosing the last attempt', () => {
        assert.equal(shouldRequestLayoutRewrite(2, 3, layoutOnly), true);
        assert.equal(shouldRequestLayoutRewrite(1, 3, layoutOnly), false);
    });

    it('counts temporal layout bullet errors', () => {
        assert.equal(countTemporalLayoutErrors(layoutValidation(6)), 6);
    });
});
