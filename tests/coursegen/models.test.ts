import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resolveAgentModel, tryResolveAgentModel } from '../../src/coursegen/models.ts';

const ORIGINAL_AGENT = process.env.AGENT_MODEL;

afterEach(() => {
  if (ORIGINAL_AGENT === undefined) delete process.env.AGENT_MODEL;
  else process.env.AGENT_MODEL = ORIGINAL_AGENT;
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

