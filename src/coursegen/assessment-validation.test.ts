import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreAssessmentPhase, validateCourseAssessments } from './assessment-validation.ts';

const validAssessments = {
  objectives: [
    { id: 'obj-01', statement: 'Add single-digit numbers', lectureSlug: 'adding-ones' },
    { id: 'obj-02', statement: 'Subtract within ten', lectureSlug: 'subtracting' }
  ],
  pre: {
    title: 'Before you start',
    items: [
      {
        id: 'pre-01',
        prompt: 'What is 2 + 3?',
        choices: [{ id: 'a', text: '5' }, { id: 'b', text: '6' }],
        correctChoiceId: 'a',
        objectiveId: 'obj-01'
      },
      {
        id: 'pre-02',
        prompt: 'What is 7 - 2?',
        choices: [{ id: 'a', text: '4' }, { id: 'b', text: '5' }],
        correctChoiceId: 'b',
        objectiveId: 'obj-02'
      }
    ]
  },
  post: {
    title: 'After the course',
    items: [
      {
        id: 'post-01',
        prompt: 'Solve 4 + 5.',
        choices: [{ id: 'a', text: '8' }, { id: 'b', text: '9' }],
        correctChoiceId: 'b',
        objectiveId: 'obj-01'
      },
      {
        id: 'post-02',
        prompt: 'Solve 9 - 3.',
        choices: [{ id: 'a', text: '5' }, { id: 'b', text: '6' }],
        correctChoiceId: 'b',
        objectiveId: 'obj-02'
      }
    ]
  }
};

describe('validateCourseAssessments', () => {
  it('accepts a balanced pre/post assessment document', () => {
    const result = validateCourseAssessments(validAssessments);
    assert.equal(result.objectives.length, 2);
    assert.equal(result.pre.items.length, 2);
    assert.equal(result.post.items.length, 2);
  });

  it('rejects missing pre item for an objective', () => {
    const broken = structuredClone(validAssessments);
    broken.pre.items = broken.pre.items.filter(item => item.objectiveId !== 'obj-02');
    assert.throws(
      () => validateCourseAssessments(broken),
      /obj-02 must have exactly one pre item/
    );
  });

  it('rejects invalid correctChoiceId', () => {
    const broken = structuredClone(validAssessments);
    broken.post.items[0].correctChoiceId = 'z';
    assert.throws(
      () => validateCourseAssessments(broken),
      /correctChoiceId must match a choice id/
    );
  });

  it('rejects too few choices', () => {
    const broken = structuredClone(validAssessments);
    broken.pre.items[0].choices = [{ id: 'a', text: 'only one' }];
    assert.throws(
      () => validateCourseAssessments(broken),
      /choices must have 2-6 entries/
    );
  });

  it('rejects unknown objectiveId on an item', () => {
    const broken = structuredClone(validAssessments);
    broken.pre.items[1].objectiveId = 'obj-99';
    assert.throws(
      () => validateCourseAssessments(broken),
      /unknown objectiveId/
    );
  });
});

describe('scoreAssessmentPhase', () => {
  it('scores selected answers against the key', () => {
    const assessments = validateCourseAssessments(validAssessments);
    const score = scoreAssessmentPhase(assessments.pre, {
      'pre-01': 'a',
      'pre-02': 'a'
    });
    assert.equal(score.total, 2);
    assert.equal(score.correct, 1);
    assert.equal(score.results[0].correct, true);
    assert.equal(score.results[1].correct, false);
  });

  it('treats blank answers as incorrect', () => {
    const assessments = validateCourseAssessments(validAssessments);
    const score = scoreAssessmentPhase(assessments.post, {});
    assert.equal(score.correct, 0);
    assert.equal(score.total, 2);
  });
});
