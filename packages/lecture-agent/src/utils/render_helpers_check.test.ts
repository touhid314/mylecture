import assert from 'node:assert/strict';
import { findMissingRenderHelpers } from './render_helpers_check.ts';

const selfContained = `
<script>
function drawCapillary() {}
function renderCanvasSection() {
  drawCapillary();
}
</script>
`;

const missing = `
<script>
function renderCanvasSection() {
  drawCapillary();
}
</script>
`;

assert.deepEqual(findMissingRenderHelpers(selfContained), []);
assert.deepEqual(findMissingRenderHelpers(missing), ['drawCapillary']);

console.log('render_helpers_check.test.ts: ok');
