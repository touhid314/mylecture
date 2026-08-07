import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkSceneLayoutKeys } = require('./scene_layout_keys.cjs') as {
  checkSceneLayoutKeys: (html: string) => string[];
};

describe('checkSceneLayoutKeys', () => {
  it('allows .length on SCENE_LAYOUT array leaves', () => {
    const html = `
<script>
const SCENE_LAYOUT = {
  pillars: [
    { title: "A", body: "x" },
    { title: "B", body: "y" },
  ],
  documents: [{ name: "doc" }],
};
for (let i = 0; i < SCENE_LAYOUT.pillars.length; i++) {}
const n = SCENE_LAYOUT.documents.length;
</script>`;
    const errors = checkSceneLayoutKeys(html);
    assert.deepEqual(errors, [], `unexpected errors: ${errors.join('; ')}`);
  });

  it('still flags genuinely missing keys', () => {
    const html = `
<script>
const SCENE_LAYOUT = { pillars: [{ title: "A" }] };
const x = SCENE_LAYOUT.missingKey;
const y = SCENE_LAYOUT.pillars.bogusProp;
</script>`;
    const errors = checkSceneLayoutKeys(html);
    assert.ok(errors.length >= 2, `expected >=2 errors, got: ${errors.join('; ')}`);
    assert.ok(errors.some((m) => m.includes('missingKey')));
    assert.ok(errors.some((m) => m.includes('pillars.bogusProp')));
  });
});
