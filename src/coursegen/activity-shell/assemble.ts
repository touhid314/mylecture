import { readFileSync } from 'node:fs';

import path from 'node:path';

import {
  challengeTimerSeconds,
  resolveChallengePacing,
  type ChallengePacing,
  type ChallengeTimerSeconds
} from '../challenge-pacing.ts';
import type { GameSpec, InteractiveSpec } from '../types.ts';



const SHELL_DIR = import.meta.dirname;



const SHELL_CSS = readFileSync(path.join(SHELL_DIR, 'shell.css'), 'utf8');

const SHELL_JS = readFileSync(path.join(SHELL_DIR, 'shell.js'), 'utf8');

const TEMPLATE_HTML = readFileSync(path.join(SHELL_DIR, 'template.html'), 'utf8');



export type ActivityShellMode = 'learn' | 'practice' | 'challenge';



export type ActivityShellActivityConfig = {

  id: string;

  title: string;

  mode: ActivityShellMode;

  instructions: string;

  successCriterion: string;

  successTarget: number;

  scoreScale?: number;

  /** Present on timed challenge activities when the plan requested pacing. */
  pacing?: ChallengePacing;

  /** Deterministic seconds mapped from pacing — stages must use these, not invent timers. */
  timer?: ChallengeTimerSeconds;

};



export type ActivityShellConfig = {

  kind: 'interactive' | 'game';

  title: string;

  objective: string;

  activities: ActivityShellActivityConfig[];

};



export type RuntimeActivityShellConfig = {

  title: string;

  activities: ActivityShellActivityConfig[];

};



const TARGET_PATTERNS = [
  /(\d+)\s+of\s+\d+/i,
  /score\s+(?:at\s+least\s+)?(\d+)/i,
  /reach\s+(\d+)/i,
  /(\d+)\s*(?:correct|questions?|items?|points?)/i,
  /(?:get|answer)\s+(\d+)/i
];



export function parseNumericTarget(successCriterion: string, defaultTarget: number, max: number): number {

  for (const pattern of TARGET_PATTERNS) {

    const match = successCriterion.match(pattern);

    if (match) {

      const value = Number.parseInt(match[1], 10);

      if (Number.isFinite(value)) {

        return Math.max(1, Math.min(max, value));

      }

    }

  }

  const fallback = successCriterion.match(/\d+/);

  if (!fallback) return defaultTarget;

  const value = Number.parseInt(fallback[0], 10);

  if (!Number.isFinite(value)) return defaultTarget;

  return Math.max(1, Math.min(max, value));

}



export function parseSuccessTarget(successCriterion: string, defaultTarget: number): number {

  return parseNumericTarget(successCriterion, defaultTarget, 10);

}



export function parseChallengeScoreTarget(successCriterion: string, defaultTarget: number): number {

  return parseNumericTarget(successCriterion, defaultTarget, 100);

}



const SCORE_SCALE_PATTERN = /(\d+)\s+(?:out of|of)\s+(\d+)/i;



export function parseChallengeScoreScale(successCriterion: string): number | undefined {

  const match = successCriterion.match(SCORE_SCALE_PATTERN);

  if (!match) return undefined;

  const scale = Number.parseInt(match[2], 10);

  if (!Number.isFinite(scale) || scale < 1) return undefined;

  return scale;

}



export function parseChallengeScoreConfig(successCriterion: string, defaultTarget: number): {

  successTarget: number;

  scoreScale?: number;

} {

  const successTarget = parseChallengeScoreTarget(successCriterion, defaultTarget);

  const scoreScale = parseChallengeScoreScale(successCriterion);

  return scoreScale !== undefined ? { successTarget, scoreScale } : { successTarget };

}



// Instructions live in shell chrome above the stage; keep them to a couple of
// lines on phone so the stage keeps its vertical room.
const COMPACT_INSTRUCTIONS_MAX = 220;



function compactInstructions(learnerAction: string): string {

  const combined = learnerAction.trim().replace(/\s+/g, ' ');

  if (combined.length <= COMPACT_INSTRUCTIONS_MAX) return combined;

  const slice = combined.slice(0, COMPACT_INSTRUCTIONS_MAX);

  const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));

  if (lastSentenceEnd > COMPACT_INSTRUCTIONS_MAX * 0.5) {
    return slice.slice(0, lastSentenceEnd + 1).trim() + '…';
  }
  const lastSpace = slice.lastIndexOf(' ');
  return ((lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()) + '…';

}



export function buildActivityShellConfig(

  kind: 'interactive' | 'game',

  spec: InteractiveSpec | GameSpec,

  lecture: { title: string; objective: string }

): ActivityShellConfig {

  if (kind === 'game') {

    const game = spec as GameSpec;

    const scoreConfig = parseChallengeScoreConfig(game.successCriterion, 70);
    const pacing = resolveChallengePacing(game.pacing);
    const timer = challengeTimerSeconds(pacing);

    return {

      kind: 'game',

      title: lecture.title,

      objective: lecture.objective,

      activities: [{

        id: 'game',

        title: 'Challenge',

        mode: 'challenge',

        // visibleSetup narrates what is already on screen; keep chrome short.
        instructions: compactInstructions(game.learnerAction || game.mission),

        successCriterion: game.successCriterion,

        successTarget: scoreConfig.successTarget,

        pacing,

        timer,

        ...(scoreConfig.scoreScale !== undefined ? { scoreScale: scoreConfig.scoreScale } : {})

      }]

    };

  }



  const interactive = spec as InteractiveSpec;

  return {

    kind: 'interactive',

    title: lecture.title,

    objective: lecture.objective,

    activities: interactive.activities.map(activity => ({

      id: activity.id,

      title: activity.title,

      mode: activity.mode,

      instructions: compactInstructions(activity.learnerAction),

      successCriterion: activity.successCriterion,

      successTarget: parseSuccessTarget(activity.successCriterion, 3)

    }))

  };

}



export function toRuntimeActivityShellConfig(config: ActivityShellConfig): RuntimeActivityShellConfig {

  return {

    title: config.title,

    activities: config.activities

  };

}



function escapeConfigJson(config: ActivityShellConfig): string {

  return JSON.stringify(toRuntimeActivityShellConfig(config)).replace(/</g, '\\u003c');

}



function escapeScriptJs(js: string): string {

  return js.replace(/<\/script/gi, '<\\/script');

}



function escapeStyleCss(css: string): string {

  return css.replace(/<\/style/gi, '<\\/style');

}



export function assembleActivityHtml(options: {

  config: ActivityShellConfig;

  stageJs: string;

  stageCss?: string;

}): string {

  return TEMPLATE_HTML

    .replace('{{SHELL_CSS}}', escapeStyleCss(SHELL_CSS))

    .replace('{{STAGE_CSS}}', escapeStyleCss(options.stageCss?.trim() || ''))

    .replace('{{CONFIG_JSON}}', escapeConfigJson(options.config))

    .replace('{{SHELL_JS}}', escapeScriptJs(SHELL_JS))

    .replace('{{STAGE_JS}}', escapeScriptJs(options.stageJs));

}



export function validateStageJs(stageJs: string): string[] {

  const findings: string[] = [];

  const trimmed = stageJs.trim();

  if (!trimmed) {

    findings.push('stage.js is empty');

    return findings;

  }

  if (!/registerStage\s*\(/.test(trimmed)) {

    findings.push('stage.js must call registerStage()');

  }

  const codeWithoutComments = trimmed
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  if (/Object\.defineProperty\s*\(\s*Object\.prototype/.test(codeWithoutComments) || /Object\.prototype\s*\.\s*\w+\s*=/.test(codeWithoutComments)) {

    findings.push('stage.js must not mutate Object.prototype (shell ownership / security)');

  }

  if (/\.game-hud\b|['"`]game-hud['"`]|['"`]custom-streak['"`]|['"`]stage-hud['"`]|\.stage-hud\b/.test(codeWithoutComments)) {

    findings.push('stage.js must not build stage-owned HUD chrome (game-hud / streak HUD); the shell owns score/progress/timers');

  }

  try {

    // eslint-disable-next-line no-new-func

    new Function(trimmed);

  } catch (error) {

    const message = error instanceof Error ? error.message : String(error);

    findings.push(`stage.js syntax error: ${message}`);

  }

  return findings;

}



export const INTERACTIVE_STAGE_REL = 'activities/interactive/stage.js' as const;

export const INTERACTIVE_STAGE_CSS_REL = 'activities/interactive/stage.css' as const;

export const GAME_STAGE_REL = 'activities/game/stage.js' as const;

export const GAME_STAGE_CSS_REL = 'activities/game/stage.css' as const;



export function stageRelForKind(kind: 'interactive' | 'game'): string {

  return kind === 'interactive' ? INTERACTIVE_STAGE_REL : GAME_STAGE_REL;

}



export function stageCssRelForKind(kind: 'interactive' | 'game'): string {

  return kind === 'interactive' ? INTERACTIVE_STAGE_CSS_REL : GAME_STAGE_CSS_REL;

}


