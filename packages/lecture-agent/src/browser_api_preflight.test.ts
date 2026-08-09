import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { checkBrowserApiUsage, extractClassicInlineScripts } = require('./browser_api_preflight.cjs') as {
    checkBrowserApiUsage: (html: string, inventory: { canvasContext2d: string[] }) => string[];
    extractClassicInlineScripts: (html: string) => string[];
};

const inventory = { canvasContext2d: ['arc', 'bezierCurveTo', 'fillRect', 'measureText'] };

describe('browser API preflight', () => {
    it('reports an invented Canvas method using the runtime inventory', () => {
        const findings = checkBrowserApiUsage(`<script>
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
ctx.cubicCurveTo(1, 2, 3, 4, 5, 6);
</script>`, inventory);
        assert.equal(findings.length, 1);
        assert.match(findings[0], /unknown CanvasRenderingContext2D method 'cubicCurveTo'/);
        assert.match(findings[0], /Nearest supported method: 'bezierCurveTo'/);
    });

    it('does not constrain valid Canvas methods or custom receiver helpers', () => {
        const findings = checkBrowserApiUsage(`<script>
const ctx = document.querySelector('canvas').getContext('2d');
ctx.sparkle = function () {};
ctx.bezierCurveTo(1, 2, 3, 4, 5, 6);
ctx.sparkle();
</script>`, inventory);
        assert.deepEqual(findings, []);
    });

    it('allows intentionally extended Canvas prototypes', () => {
        const findings = checkBrowserApiUsage(`<script>
CanvasRenderingContext2D.prototype.sparkle = function () {};
const ctx = document.querySelector('canvas').getContext('2d');
ctx.sparkle();
</script>`, inventory);
        assert.deepEqual(findings, []);
    });

    it('reports obvious Array and NodeList DOM receiver mistakes', () => {
        const findings = checkBrowserApiUsage(`<script>
const items = [];
const nodes = document.querySelectorAll('.item');
items.appendChild(document.createElement('div'));
nodes.insertBefore(document.createElement('div'), null);
</script>`, inventory);
        assert.equal(findings.length, 2);
        assert.match(findings[0], /Array 'items' cannot receive Node\.appendChild/);
        assert.match(findings[1], /NodeList 'nodes' cannot receive Node\.insertBefore/);
    });

    it('stops inferring a receiver after an ambiguous reassignment', () => {
        const findings = checkBrowserApiUsage(`<script>
let items = [];
items = getContainer();
items.appendChild(document.createElement('div'));
</script>`, inventory);
        assert.deepEqual(findings, []);
    });

    it('ignores external and module scripts', () => {
        const scripts = extractClassicInlineScripts(`
<script src="bundle.js"></script>
<script type="module">export default 1;</script>
<script>window.ok = true;</script>`);
        assert.deepEqual(scripts, ['window.ok = true;']);
    });
});
