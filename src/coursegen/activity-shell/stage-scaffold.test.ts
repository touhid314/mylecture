import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityShellConfig, validateStageJs } from './assemble.ts';
import { buildStageJsScaffold, shouldWriteStageScaffold } from './stage-scaffold.ts';
import type { GameSpec, InteractiveSpec } from '../types.ts';

const sampleInteractive: InteractiveSpec = {
  activities: [
    {
      id: 'explore',
      title: 'Explore',
      mode: 'learn',
      visibleSetup: 'Look.',
      learnerAction: 'Explore.',
      controls: ['drag'],
      feedback: 'Explore.',
      successCriterion: 'Done exploring.'
    },
    {
      id: 'practice-main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: 'Answer.',
      learnerAction: 'Pick the answer.',
      controls: ['choices'],
      feedback: 'Shows correctness.',
      successCriterion: 'Get 3 correct.'
    }
  ]
};

const sampleGame: GameSpec = {
  mission: 'Challenge.',
  visibleSetup: 'See mission.',
  learnerAction: 'Answer challenges.',
  controls: ['check'],
  feedback: 'Score updates.',
  successCriterion: 'Reach 70 out of 100.'
};

test('buildStageJsScaffold includes registerStage and every activity id', () => {
  const config = buildActivityShellConfig('interactive', sampleInteractive, {
    title: 'Integers',
    objective: 'Place integers.'
  });
  const scaffold = buildStageJsScaffold('interactive', config);

  assert.match(scaffold, /registerStage\s*\(/);
  assert.match(scaffold, /"explore"/);
  assert.match(scaffold, /"practice-main"/);
  assert.match(scaffold, /createItems/);
  assert.match(scaffold, /renderItem/);
  assert.ok(!scaffold.includes('</script>'), 'scaffold must not contain raw </script>');
  assert.equal(validateStageJs(scaffold).length, 0);
});

test('buildStageJsScaffold maps game to single activity stub', () => {
  const config = buildActivityShellConfig('game', sampleGame, {
    title: 'Challenge',
    objective: 'Practice.'
  });
  const scaffold = buildStageJsScaffold('game', config);

  assert.match(scaffold, /"game"/);
  assert.match(scaffold, /checkAnswer/);
  assert.equal(validateStageJs(scaffold).length, 0);
});

test('buildStageJsScaffold forbids HUD chrome in comments', () => {
  const config = buildActivityShellConfig('interactive', sampleInteractive, {
    title: 'T',
    objective: 'O'
  });
  const scaffold = buildStageJsScaffold('interactive', config);
  assert.match(scaffold, /Do NOT add \.game-hud/);
  assert.match(scaffold, /Object\.prototype/);
});

test('buildStageJsScaffold escapes activity titles via jsString literals', () => {
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Say "hello" & learner\'s choice',
      mode: 'practice',
      visibleSetup: 'Answer.',
      learnerAction: 'Pick.',
      controls: ['choices'],
      feedback: 'Feedback.',
      successCriterion: 'Get 3 correct.'
    }]
  }, { title: 'T', objective: 'O' });
  const scaffold = buildStageJsScaffold('interactive', config);
  assert.match(scaffold, /Say \\"hello\\"/);
  assert.match(scaffold, /learner's choice/);
  assert.equal(validateStageJs(scaffold).length, 0);
});

test('shouldWriteStageScaffold skips existing file unless force overwrite', () => {
  assert.equal(shouldWriteStageScaffold(true, false), false);
  assert.equal(shouldWriteStageScaffold(true, true), true);
  assert.equal(shouldWriteStageScaffold(false, false), true);
});
