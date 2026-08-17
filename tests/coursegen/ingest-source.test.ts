import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computePageRanges,
  extractChapterNumberFromText,
  filterSectionsByChapter,
  parseChapterFilter,
  resolveSectionOrder,
  selectTopLevelOutlineSections,
  slugifyTitle
} from '../../src/coursegen/ingest-source.ts';

describe('slugifyTitle', () => {
  it('slugifies titles deterministically', () => {
    assert.equal(slugifyTitle('Supervised Learning'), 'supervised-learning');
    assert.equal(slugifyTitle('  Gradients & Initialization  '), 'gradients-initialization');
    assert.equal(slugifyTitle('!!!'), 'section');
  });
});

describe('parseChapterFilter', () => {
  it('parses ranges and lists', () => {
    assert.deepEqual([...parseChapterFilter('1-9')!].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual([...parseChapterFilter('1,2,5')!].sort((a, b) => a - b), [1, 2, 5]);
    assert.deepEqual([...parseChapterFilter('1-3,8')!].sort((a, b) => a - b), [1, 2, 3, 8]);
  });

  it('returns null when unset', () => {
    assert.equal(parseChapterFilter(undefined), null);
    assert.equal(parseChapterFilter(''), null);
    assert.equal(parseChapterFilter('  '), null);
  });

  it('rejects invalid segments', () => {
    assert.throws(() => parseChapterFilter('0-2'), /Invalid chapter filter/);
    assert.throws(() => parseChapterFilter('3-1'), /Invalid chapter filter/);
    assert.throws(() => parseChapterFilter('abc'), /Invalid chapter filter/);
  });
});

describe('selectTopLevelOutlineSections', () => {
  it('keeps only Chapter N titles when present', () => {
    const selected = selectTopLevelOutlineSections([
      { title: 'Preface', dest: 'a' },
      { title: 'Chapter 1 Introduction', dest: 'b' },
      { title: 'Chapter 2 Methods', dest: 'c', items: [{ title: '2.1', dest: 'd' }] },
      { title: 'Appendix', dest: 'e' }
    ]);
    assert.deepEqual(
      selected.map(s => ({ title: s.title, chapterNumFromTitle: s.chapterNumFromTitle })),
      [
        { title: 'Chapter 1 Introduction', chapterNumFromTitle: 1 },
        { title: 'Chapter 2 Methods', chapterNumFromTitle: 2 }
      ]
    );
  });

  it('uses all top-level entries when no Chapter N pattern', () => {
    const selected = selectTopLevelOutlineSections([
      { title: 'Preface', dest: 'a' },
      { title: 'Introduction', dest: 'b' },
      { title: 'Supervised learning', dest: 'c' }
    ]);
    assert.equal(selected.length, 3);
    assert.equal(selected[1].title, 'Introduction');
    assert.equal(selected[1].chapterNumFromTitle, null);
  });
});

describe('computePageRanges', () => {
  it('maps outline pages to inclusive ranges ending at nextStart-1', () => {
    const ranges = computePageRanges(
      [
        { title: 'A', pageStart: 10 },
        { title: 'B', pageStart: 20 },
        { title: 'C', pageStart: 35 }
      ],
      50
    );
    assert.deepEqual(ranges, [
      { title: 'A', pageStart: 10, pageEnd: 19, chapterNum: null },
      { title: 'B', pageStart: 20, pageEnd: 34, chapterNum: null },
      { title: 'C', pageStart: 35, pageEnd: 50, chapterNum: null }
    ]);
  });

  it('sorts by pageStart and keeps last section through doc end', () => {
    const ranges = computePageRanges(
      [
        { title: 'Later', pageStart: 40, chapterNum: 2 },
        { title: 'Earlier', pageStart: 12, chapterNum: 1 }
      ],
      44
    );
    assert.deepEqual(ranges, [
      { title: 'Earlier', pageStart: 12, pageEnd: 39, chapterNum: 1 },
      { title: 'Later', pageStart: 40, pageEnd: 44, chapterNum: 2 }
    ]);
  });
});

describe('filterSectionsByChapter', () => {
  it('filters by chapterNum and falls back to 1-based index', () => {
    const sections = [
      { title: 'Preface', pageStart: 1, pageEnd: 4, chapterNum: null },
      { title: 'Intro', pageStart: 5, pageEnd: 10, chapterNum: 1 },
      { title: 'Next', pageStart: 11, pageEnd: 20, chapterNum: 2 }
    ];
    const filtered = filterSectionsByChapter(sections, new Set([1, 2]));
    assert.deepEqual(
      filtered.map(s => s.title),
      ['Intro', 'Next']
    );

    const byIndex = filterSectionsByChapter(
      [
        { title: 'A', pageStart: 1, pageEnd: 2, chapterNum: null },
        { title: 'B', pageStart: 3, pageEnd: 4, chapterNum: null }
      ],
      new Set([2])
    );
    assert.deepEqual(
      byIndex.map(s => s.title),
      ['B']
    );
  });
});

describe('extractChapterNumberFromText', () => {
  it('matches Chapter N case-insensitively', () => {
    assert.equal(extractChapterNumberFromText('CHAPTER 3\nTitle here'), 3);
    assert.equal(extractChapterNumberFromText('chapter 9 Methods'), 9);
    assert.equal(extractChapterNumberFromText('Chapter 1 Introduction'), 1);
    assert.equal(extractChapterNumberFromText('Preface only'), null);
  });
});

describe('resolveSectionOrder', () => {
  it('prefers chapter number for stable ids (1-9 stay 01-09)', () => {
    const filtered = [
      { title: 'Chapter 1 Intro', chapterNum: 1 },
      { title: 'Chapter 9 Deep', chapterNum: 9 }
    ];
    assert.deepEqual(resolveSectionOrder(filtered[0], 0), { order: 1, usedFilterOrder: false });
    assert.deepEqual(resolveSectionOrder(filtered[1], 1), { order: 9, usedFilterOrder: false });
  });

  it('falls back to filter order when chapterNum missing', () => {
    assert.deepEqual(
      resolveSectionOrder({ title: 'Preface', chapterNum: null }, 2),
      { order: 3, usedFilterOrder: true }
    );
  });
});
