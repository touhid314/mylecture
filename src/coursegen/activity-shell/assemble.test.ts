import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleActivityHtml,
  buildActivityShellConfig,
  parseChallengeScoreConfig,
  parseChallengeScoreScale,
  parseChallengeScoreTarget,
  parseNumericTarget,
  parseSuccessTarget,
  toRuntimeActivityShellConfig,
  validateStageJs
} from './assemble.ts';
import type { GameSpec, InteractiveSpec } from '../types.ts';

const sampleInteractive: InteractiveSpec = {
  activities: [
    {
      id: 'explore',
      title: 'Explore integers',
      mode: 'learn',
      visibleSetup: 'Look at the number line.',
      learnerAction: 'Drag chips to explore positions.',
      controls: ['drag'],
      feedback: 'Explore freely.',
      successCriterion: 'Mark as done when finished exploring.'
    },
    {
      id: 'practice-main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: 'Answer each question.',
      learnerAction: 'Pick the correct value.',
      controls: ['choices', 'check'],
      feedback: 'Shows correctness.',
      successCriterion: 'Get 4 correct answers.'
    }
  ]
};

const sampleGame: GameSpec = {
  mission: 'Score points on integer challenges.',
  visibleSetup: 'See the mission and score.',
  learnerAction: 'Answer challenges quickly.',
  controls: ['check', 'next'],
  feedback: 'Score updates after each challenge.',
  successCriterion: 'Reach 80 out of 100.'
};

test('buildActivityShellConfig maps interactive activities with modes and targets', () => {
  const config = buildActivityShellConfig('interactive', sampleInteractive, {
    title: 'Integers',
    objective: 'Place integers on a number line.'
  });
  assert.equal(config.kind, 'interactive');
  assert.equal(config.activities.length, 2);
  assert.equal(config.activities[0].mode, 'learn');
  assert.equal(config.activities[1].mode, 'practice');
  assert.equal(config.activities[1].successTarget, 4);
  assert.ok(config.activities[1].instructions.includes('Pick the correct value'));
});

test('buildActivityShellConfig keeps instructions short: learnerAction only, capped length', () => {
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: 'A long narration of what is already visible on screen that should not appear in chrome.',
      learnerAction: 'Pick the correct value. '.repeat(20),
      controls: ['choices'],
      feedback: '',
      successCriterion: 'Get 3 correct.'
    }]
  }, { title: 'T', objective: 'O' });
  const instructions = config.activities[0].instructions;
  assert.ok(!instructions.includes('already visible on screen'), 'visibleSetup must not be appended to instructions');
  assert.ok(instructions.length <= 230, `instructions should be capped, got ${instructions.length} chars`);
});

test('buildActivityShellConfig maps game to single challenge activity', () => {
  const config = buildActivityShellConfig('game', sampleGame, {
    title: 'Integer challenge',
    objective: 'Practice integers.'
  });
  assert.equal(config.activities.length, 1);
  assert.equal(config.activities[0].id, 'game');
  assert.equal(config.activities[0].mode, 'challenge');
  assert.equal(config.activities[0].successTarget, 80);
  assert.equal(config.activities[0].pacing, 'steady');
  assert.deepEqual(config.activities[0].timer, { start: 16, min: 10, shrink: 1 });
});

test('buildActivityShellConfig maps gameSpec.pacing to timer seconds', () => {
  const config = buildActivityShellConfig('game', { ...sampleGame, pacing: 'relaxed' }, {
    title: 'Integer challenge',
    objective: 'Practice integers.'
  });
  assert.equal(config.activities[0].pacing, 'relaxed');
  assert.deepEqual(config.activities[0].timer, { start: 22, min: 14, shrink: 1 });
});

test('parseSuccessTarget defaults when no integer present', () => {
  assert.equal(parseSuccessTarget('Complete all items', 3), 3);
  assert.equal(parseSuccessTarget('Reach mastery', 70), 70);
});

test('parseSuccessTarget clamps parsed integer to 1..10', () => {
  assert.equal(parseSuccessTarget('Get 15 correct', 3), 10);
  assert.equal(parseSuccessTarget('Get 0 correct', 3), 1);
});

test('assembleActivityHtml includes shell version, config, and stage code', () => {
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: '',
      learnerAction: 'Answer questions.',
      controls: [],
      feedback: '',
      successCriterion: 'Get 3 correct.'
    }]
  }, { title: 'Test', objective: 'Test objective.' });
  const stageJs = 'window.registerStage({ activities: { main: {} } });';
  const html = assembleActivityHtml({ config, stageJs });
  assert.ok(html.includes('data-shell-version="1"'));
  assert.ok(html.includes('"activityIds"') || html.includes('"main"'));
  assert.ok(html.includes('registerStage'));
  assert.ok(html.includes('#activity-stage'));
});

test('assembleActivityHtml escapes </script> in stage code', () => {
  const config = buildActivityShellConfig('interactive', sampleInteractive, {
    title: 'T',
    objective: 'O'
  });
  const stageJs = 'var x = "</script><script>alert(1)</script>"; registerStage({ activities: {} });';
  const html = assembleActivityHtml({ config, stageJs });
  assert.ok(!html.includes('</script><script>alert'));
  assert.ok(html.includes('<\\/script'));
});

test('parseSuccessTarget prefers counts adjacent to correct/questions', () => {
  assert.equal(parseSuccessTarget('Activity 2: get 3 correct', 3), 3);
  assert.equal(parseSuccessTarget('Get 4 correct answers.', 3), 4);
  assert.equal(parseSuccessTarget('Get 4 of 5 correct', 3), 4);
});

test('parseChallengeScoreTarget prefers reach/score phrasing over activity numbers', () => {
  assert.equal(parseChallengeScoreTarget('Activity 2: reach 80 out of 100', 70), 80);
  assert.equal(parseChallengeScoreTarget('Reach 80 out of 100.', 70), 80);
  assert.equal(parseChallengeScoreTarget('Score at least 70 out of 100', 70), 70);
});

test('parseChallengeScoreScale extracts denominator from out-of phrasing', () => {
  assert.equal(parseChallengeScoreScale('Score at least 70 out of 100'), 100);
  assert.equal(parseChallengeScoreScale('Reach 80 of 100'), 100);
  assert.equal(parseChallengeScoreScale('Score at least 70'), undefined);
});

test('parseChallengeScoreConfig returns target and scale together', () => {
  const config = parseChallengeScoreConfig('Score at least 70 out of 100', 70);
  assert.equal(config.successTarget, 70);
  assert.equal(config.scoreScale, 100);
});

test('buildActivityShellConfig stores scoreScale for challenge games', () => {
  const config = buildActivityShellConfig('game', sampleGame, {
    title: 'Integer challenge',
    objective: 'Practice integers.'
  });
  assert.equal(config.activities[0].successTarget, 80);
  assert.equal(config.activities[0].scoreScale, 100);
});

test('parseNumericTarget falls back to first integer', () => {
  assert.equal(parseNumericTarget('Complete all items', 3, 10), 3);
});

test('toRuntimeActivityShellConfig omits kind and objective', () => {
  const config = buildActivityShellConfig('interactive', sampleInteractive, {
    title: 'Integers',
    objective: 'Place integers on a number line.'
  });
  const runtime = toRuntimeActivityShellConfig(config);
  assert.equal(runtime.title, 'Integers');
  assert.ok(!('kind' in runtime));
  assert.ok(!('objective' in runtime));
});

test('assembleActivityHtml escapes </style> in stage css', () => {
  const config = buildActivityShellConfig('interactive', sampleInteractive, {
    title: 'T',
    objective: 'O'
  });
  const stageCss = '.x::before { content: "</style><script>alert(1)</script>"; }';
  const html = assembleActivityHtml({ config, stageJs: 'registerStage({ activities: {} });', stageCss });
  assert.ok(!html.includes('</style><script>alert'));
  assert.ok(html.includes('<\\/style'));
});

test('assembleActivityHtml accepts CRLF stage.js', () => {
  const config = buildActivityShellConfig('interactive', sampleInteractive, {
    title: 'T',
    objective: 'O'
  });
  const stageJs = 'window.registerStage({ activities: { main: {} } });\r\n';
  const html = assembleActivityHtml({ config, stageJs });
  assert.ok(html.includes('registerStage'));
  assert.equal(validateStageJs(stageJs).length, 0);
});

test('validateStageJs catches syntax errors and missing registerStage', () => {
  assert.ok(validateStageJs('').some(f => f.includes('empty')));
  assert.ok(validateStageJs('var x = {').some(f => f.includes('syntax')));
  assert.ok(validateStageJs('var x = 1;').some(f => f.includes('registerStage')));
  assert.equal(validateStageJs('registerStage({ activities: {} });').length, 0);
});

test('validateStageJs flags Object.prototype mutation and stage HUD chrome', () => {
  assert.ok(
    validateStageJs('Object.defineProperty(Object.prototype, "x", { value: 1 }); registerStage({});')
      .some(f => f.includes('Object.prototype'))
  );
  assert.ok(
    validateStageJs('const c = "game-hud"; registerStage({});')
      .some(f => f.includes('HUD'))
  );
  assert.equal(validateStageJs('registerStage({ activities: { main: {} } });').length, 0);
});
