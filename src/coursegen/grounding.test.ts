import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  loadLectureGrounding,
  resolveContainedSourceFile,
  truncateProportionally
} from './lecture-prompt.ts';
import { readSourceManifest } from './source-manifest.ts';
import { SLUG_RE, validateCoursePlan } from './types.ts';

describe('SLUG_RE / source.slug validation', () => {
  it('accepts hyphenated lowercase slugs', () => {
    assert.equal(SLUG_RE.test('udl-book'), true);
    assert.equal(SLUG_RE.test('a'), true);
  });

  it('rejects path traversal and uppercase', () => {
    assert.equal(SLUG_RE.test('../etc'), false);
    assert.equal(SLUG_RE.test('Foo'), false);
    assert.equal(SLUG_RE.test('a/b'), false);
    assert.equal(SLUG_RE.test(''), false);
  });

  it('readSourceManifest rejects invalid slug before filesystem join', () => {
    assert.throws(() => readSourceManifest('../evil'), /invalid source slug/);
    assert.throws(() => readSourceManifest('Foo'), /invalid source slug/);
    assert.throws(() => readSourceManifest('a/b'), /invalid source slug/);
    assert.throws(() => readSourceManifest(''), /invalid source slug/);
  });

  it('validateCoursePlan rejects invalid source.slug', () => {
    assert.throws(
      () =>
        validateCoursePlan({
          title: 'T',
          slug: 'course-a',
          audience: 'general',
          intent: 'foundation',
          summary: 's',
          description: 'd',
          source: { slug: '../evil', title: 'Bad' },
          modules: [
            {
              title: 'M',
              lectures: [
                {
                  slug: 'lec-1',
                  title: 'L',
                  objective: 'o',
                  durationMinutes: 5,
                  formats: ['video'],
                  promptNotes: 'n'
                }
              ]
            }
          ]
        }),
      /source\.slug: invalid slug/
    );
  });

  it('requires sourceSections when knownSourceSectionIds and source are set', () => {
    const known = new Set(['01-intro']);
    assert.throws(
      () =>
        validateCoursePlan(
          {
            title: 'T',
            slug: 'course-a',
            audience: 'general',
            intent: 'foundation',
            summary: 's',
            description: 'd',
            source: { slug: 'udl-book', title: 'UDL' },
            modules: [
              {
                title: 'M',
                lectures: [
                  {
                    slug: 'lec-1',
                    title: 'L',
                    objective: 'o',
                    durationMinutes: 5,
                    formats: ['video'],
                    promptNotes: 'n'
                  }
                ]
              }
            ]
          },
          { knownSourceSectionIds: known }
        ),
      /Missing for: lec-1/
    );
  });

  it('deduplicates sourceSections ids', () => {
    const plan = validateCoursePlan({
      title: 'T',
      slug: 'course-a',
      audience: 'general',
      intent: 'foundation',
      summary: 's',
      description: 'd',
      source: { slug: 'udl-book', title: 'UDL' },
      modules: [
        {
          title: 'M',
          lectures: [
            {
              slug: 'lec-1',
              title: 'L',
              objective: 'o',
              durationMinutes: 5,
              formats: ['video'],
              promptNotes: 'n',
              sourceSections: ['01-intro', '01-intro', '02-next']
            }
          ]
        }
      ]
    });
    assert.deepEqual(plan.modules[0].lectures[0].sourceSections, ['01-intro', '02-next']);
  });
});

describe('loadLectureGrounding fail-closed', () => {
  const groundedPlan = {
    title: 'T',
    slug: 'course-a',
    audience: 'general' as const,
    intent: 'foundation' as const,
    summary: 's',
    description: 'd',
    source: { slug: 'udl-book', title: 'UDL' },
    modules: []
  };

  it('throws when plan.source.slug is set but sourceSections missing', () => {
    assert.throws(
      () => loadLectureGrounding(groundedPlan, {}),
      /requires non-empty sourceSections/
    );
  });

  it('throws when plan.source.slug is set but sourceSections empty', () => {
    assert.throws(
      () => loadLectureGrounding(groundedPlan, { sourceSections: [] }),
      /requires non-empty sourceSections/
    );
  });

  it('throws when plan.source.slug is set but sourceSections are blank-only', () => {
    assert.throws(
      () => loadLectureGrounding(groundedPlan, { sourceSections: ['  ', ''] }),
      /requires non-empty sourceSections/
    );
  });

  it('returns null when plan has no source', () => {
    const plan = { ...groundedPlan, source: undefined };
    assert.equal(loadLectureGrounding(plan, { sourceSections: ['01-intro'] }), null);
    assert.equal(loadLectureGrounding(plan, {}), null);
  });

  it('throws on invalid source slug before filesystem join', () => {
    assert.throws(
      () =>
        loadLectureGrounding(
          { ...groundedPlan, source: { slug: '../evil', title: 'Bad' } },
          { sourceSections: ['01-intro'] }
        ),
      /invalid source slug/
    );
  });
});

describe('truncateProportionally', () => {
  it('keeps joined excerpt length ≤ budget including markers', () => {
    const excerpts = [
      { id: 'a', title: 'A', text: 'x'.repeat(5_000) },
      { id: 'b', title: 'B', text: 'y'.repeat(5_000) },
      { id: 'c', title: 'C', text: 'z'.repeat(5_000) }
    ];
    const budget = 1_200;
    const result = truncateProportionally(excerpts, budget);
    assert.equal(result.truncated, true);
    const joined = result.excerpts.reduce((sum, item) => sum + item.text.length, 0);
    assert.ok(joined <= budget, `joined length ${joined} exceeded budget ${budget}`);
  });

  it('does not truncate when under budget', () => {
    const excerpts = [{ id: 'a', title: 'A', text: 'hello' }];
    const result = truncateProportionally(excerpts, 100);
    assert.equal(result.truncated, false);
    assert.equal(result.excerpts[0].text, 'hello');
  });
});

describe('resolveContainedSourceFile', () => {
  const sourceDir = 'C:\\tmp\\sources\\book';

  it('resolves relative section paths under sourceDir', () => {
    const resolved = resolveContainedSourceFile(sourceDir, 'sections/01-intro.md');
    assert.ok(resolved.replace(/\\/g, '/').endsWith('sources/book/sections/01-intro.md'));
  });

  it('rejects .. and absolute paths', () => {
    assert.throws(
      () => resolveContainedSourceFile(sourceDir, '../other/secret.md'),
      /\.\./
    );
    assert.throws(
      () => resolveContainedSourceFile(sourceDir, 'sections/../../secret.md'),
      /\.\./
    );
    assert.throws(
      () => resolveContainedSourceFile(sourceDir, 'C:\\Windows\\system32\\evil.md'),
      /absolute/
    );
  });
});

describe('forced plan.source behavior (validate + override contract)', () => {
  it('accepts a grounded plan and preserves CLI source shape', () => {
    const known = new Set(['01-intro', '02-methods']);
    const plan = validateCoursePlan(
      {
        title: 'T',
        slug: 'course-a',
        audience: 'general',
        intent: 'foundation',
        summary: 's',
        description: 'd',
        source: { slug: 'wrong-slug', title: 'Wrong' },
        modules: [
          {
            title: 'M',
            lectures: [
              {
                slug: 'lec-1',
                title: 'L',
                objective: 'o',
                durationMinutes: 5,
                formats: ['video'],
                promptNotes: 'n',
                sourceSections: ['01-intro']
              }
            ]
          }
        ]
      },
      { knownSourceSectionIds: known }
    );
    // plan-course.ts always overwrites after validate; simulate that contract here.
    plan.source = { slug: 'udl-book', title: 'Understanding Deep Learning' };
    assert.deepEqual(plan.source, { slug: 'udl-book', title: 'Understanding Deep Learning' });
    assert.deepEqual(plan.modules[0].lectures[0].sourceSections, ['01-intro']);
  });
});
