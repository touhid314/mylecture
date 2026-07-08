import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpawnAgentCliArgs } from './spawn.ts';

test('buildSpawnAgentCliArgs appends --skill for each provided skill', () => {
  const originalModel = process.env.AGENT_MODEL;
  process.env.AGENT_MODEL = 'test-model';

  try {
    const args = buildSpawnAgentCliArgs({
      maxTurns: 12,
      skills: ['adaptive-micro-lesson', 'other-skill']
    });
    const skillIndex = args.indexOf('--skill');
    assert.ok(skillIndex >= 0);
    assert.equal(args[skillIndex + 1], 'adaptive-micro-lesson');
    assert.equal(args[skillIndex + 3], 'other-skill');
  } finally {
    if (originalModel === undefined) {
      delete process.env.AGENT_MODEL;
    } else {
      process.env.AGENT_MODEL = originalModel;
    }
  }
});

test('buildSpawnAgentCliArgs omits --skill when skills not provided', () => {
  const originalModel = process.env.AGENT_MODEL;
  process.env.AGENT_MODEL = 'test-model';

  try {
    const args = buildSpawnAgentCliArgs({ maxTurns: 12 });
    assert.ok(!args.includes('--skill'));
  } finally {
    if (originalModel === undefined) {
      delete process.env.AGENT_MODEL;
    } else {
      process.env.AGENT_MODEL = originalModel;
    }
  }
});
