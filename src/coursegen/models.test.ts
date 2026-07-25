import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resolveAgentModel, tryResolveAgentModel, tryResolveReviewModel } from './models.ts';

const ORIGINAL_AGENT = process.env.AGENT_MODEL;
const ORIGINAL_REVIEW = process.env.COURSEGEN_REVIEW_MODEL;

afterEach(() => {
  if (ORIGINAL_AGENT === undefined) delete process.env.AGENT_MODEL;
  else process.env.AGENT_MODEL = ORIGINAL_AGENT;
  if (ORIGINAL_REVIEW === undefined) delete process.env.COURSEGEN_REVIEW_MODEL;
  else process.env.COURSEGEN_REVIEW_MODEL = ORIGINAL_REVIEW;
});

describe('resolveAgentModel', () => {
  it('prefers trimmed override over env', () => {
    process.env.AGENT_MODEL = 'env-model';
    assert.equal(resolveAgentModel('  override-model  '), 'override-model');
  });

  it('falls back to AGENT_MODEL', () => {
    process.env.AGENT_MODEL = 'agent-from-env';
    assert.equal(resolveAgentModel(), 'agent-from-env');
    assert.equal(resolveAgentModel(''), 'agent-from-env');
    assert.equal(resolveAgentModel('   '), 'agent-from-env');
  });

  it('throws when override and AGENT_MODEL are empty', () => {
    delete process.env.AGENT_MODEL;
    assert.throws(() => resolveAgentModel(), /AGENT_MODEL/);
    assert.throws(() => resolveAgentModel('  '), /AGENT_MODEL/);
  });
});

describe('tryResolveAgentModel', () => {
  it('returns empty string instead of throwing', () => {
    delete process.env.AGENT_MODEL;
    assert.equal(tryResolveAgentModel(), '');
  });
});

describe('tryResolveReviewModel', () => {
  it('prefers trimmed override', () => {
    process.env.COURSEGEN_REVIEW_MODEL = 'review-env';
    process.env.AGENT_MODEL = 'agent-env';
    assert.equal(tryResolveReviewModel('  review-override  '), 'review-override');
  });

  it('uses COURSEGEN_REVIEW_MODEL before AGENT_MODEL', () => {
    process.env.COURSEGEN_REVIEW_MODEL = 'review-env';
    process.env.AGENT_MODEL = 'agent-env';
    assert.equal(tryResolveReviewModel(), 'review-env');
  });

  it('falls back to AGENT_MODEL when review env unset', () => {
    delete process.env.COURSEGEN_REVIEW_MODEL;
    process.env.AGENT_MODEL = 'agent-env';
    assert.equal(tryResolveReviewModel(), 'agent-env');
  });

  it('returns empty when nothing is set', () => {
    delete process.env.COURSEGEN_REVIEW_MODEL;
    delete process.env.AGENT_MODEL;
    assert.equal(tryResolveReviewModel(), '');
    assert.equal(tryResolveReviewModel('   '), '');
  });
});
