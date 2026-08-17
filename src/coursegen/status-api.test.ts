import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moduleCourseSlug } from './class-types.ts';
import { getClassSummary, listClasses } from './status-api.ts';

describe('class status API', () => {
  it('lists classes as an array', () => {
    const items = listClasses();
    assert.ok(Array.isArray(items));
    for (const item of items) {
      assert.ok(item.slug);
      assert.ok(item.title);
      assert.equal(typeof item.moduleCount, 'number');
      assert.equal(typeof item.plannedCount, 'number');
      assert.equal(typeof item.assessmentCount, 'number');
    }
  });

  it('rejects a missing class plan', () => {
    assert.throws(() => getClassSummary('does-not-exist-class-ui'), /ENOENT|class plan|not found/i);
  });

  it('builds module course slugs as class--module', () => {
    assert.equal(moduleCourseSlug('arithmetic-from-scratch', 'whole-numbers'), 'arithmetic-from-scratch--whole-numbers');
  });
});
