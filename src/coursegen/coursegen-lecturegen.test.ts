/**
 * Unit tests: coursegen → LectureGen structured settings + practice routing (no LLM).
 * Run via npm run test:test-prep (included) or:
 *   node --import tsx --test src/coursegen/coursegen-lecturegen.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  buildLectureGenCliFlags,
  type LectureGenSpawnSettings
} from './spawn.ts';
import {
  buildVideoGenerationSettings,
  buildVideoTaskMessage,
  formatGenerationLength,
  GAME_PRACTICE_REL,
  INTERACTIVE_PRACTICE_REL,
  splitCourseProfile
} from './lecture-prompt.ts';
import type { CoursePlan, PlannedLecture } from './types.ts';
import {
  parseLectureGenRequest
} from '../../packages/lecture-agent/src/lecturegen.ts';
import {
  buildLectureGenSettingsText,
  mergeLectureGenSettings,
  SETTINGS_MARKER
} from './lecturegen-settings.ts';
import {
  defaultPracticeRelPath,
  DEFAULT_GAME_REL,
  DEFAULT_INTERACTIVE_REL
} from '../../packages/lecture-agent/src/practicegen.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function minimalPlan(lecture: Partial<PlannedLecture> = {}): { plan: CoursePlan; lecture: PlannedLecture } {
  const planned: PlannedLecture = {
    slug: 'binary-search',
    title: 'Binary Search',
    objective: 'Find a value in a sorted array with log-time search.',
    durationMinutes: 5,
    formats: ['video'],
    promptNotes: '',
    ...lecture
  };
  const plan: CoursePlan = {
    slug: 'algo-basics',
    title: 'Algorithm Basics',
    summary: 'Core algorithms',
    description: 'A short course',
    audience: 'general',
    intent: 'foundation',
    modules: [{ title: 'Searching', lectures: [planned] }]
  };
  return { plan, lecture: planned };
}

describe('coursegen LectureGen structured settings', () => {
  it('uses lecture generation marker and planned non-1:00 duration', () => {
    const { plan, lecture } = minimalPlan({ durationMinutes: 5 });
    const message = buildVideoTaskMessage(plan, lecture, 'Searching');
    assert.match(message, new RegExp(SETTINGS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(message, /if the user query is for video generation/);
    assert.match(message, /generation length:\s*5:00/);
    assert.match(message, /^theme:/m);
    assert.match(message, /^teaching style:/m);
    assert.doesNotMatch(message, /^profile:/m);

    const settings = buildVideoGenerationSettings(plan, lecture);
    assert.equal(settings.generationLength, '5:00');
    assert.equal(settings.aspectRatio, '16:9');
    assert.ok(settings.theme.length > 20);
    assert.ok(settings.teachingStyle.length > 20);
  });

  it('CLI flags carry non-default length, aspect, and profile paths', () => {
    const settings: LectureGenSpawnSettings = {
      generationLength: '5:00',
      aspectRatio: '16:9',
      theme: 'C:\\tmp\\theme.md',
      teachingStyle: 'C:\\tmp\\style.md'
    };
    const flags = buildLectureGenCliFlags(settings);
    assert.deepEqual(flags, [
      '--length', '5:00',
      '--aspect-ratio', '16:9',
      '--theme', 'C:\\tmp\\theme.md',
      '--teaching-style', 'C:\\tmp\\style.md'
    ]);
  });

  it('mergeLectureGenSettings precedence: explicit > marker > defaults', () => {
    const parsed = parseLectureGenRequest(
      [
        'Explain hashing',
        '',
        SETTINGS_MARKER,
        'aspect ratio: 9:16',
        'generation length: 3:00',
        'theme: from-marker',
        'teaching style: marker-style'
      ].join('\n'),
      ROOT
    );
    assert.equal(parsed.hasSettingsMarker, true);
    assert.equal(parsed.generationLength, '3:00');

    const merged = mergeLectureGenSettings(
      { generationLength: '5:00', aspectRatio: '16:9' },
      parsed
    );
    assert.equal(merged.generationLength, '5:00');
    assert.equal(merged.aspectRatio, '16:9');
    assert.equal(merged.theme, 'from-marker');
    assert.equal(merged.teachingStyle, 'marker-style');

    const defaultsParsed = parseLectureGenRequest('Just a prompt with no settings', ROOT);
    assert.equal(defaultsParsed.hasSettingsMarker, false);
    const defaultsOnly = mergeLectureGenSettings({}, defaultsParsed);
    assert.equal(defaultsOnly.generationLength, '1:00');
    assert.equal(defaultsOnly.aspectRatio, '16:9');
  });

  it('round-trips request body before settings marker (structure, craft, grounding once)', () => {
    const { plan, lecture } = minimalPlan({ durationMinutes: 5 });
    const grounding = [
      '--- source grounding (authority) ---',
      'Source: Algorithms Text',
      'Use only grounded claims from the excerpts below.',
      '### excerpt-1: Binary search',
      'Binary search finds a key in a sorted array in logarithmic time.'
    ].join('\n');
    const message = buildVideoTaskMessage(plan, lecture, 'Searching', grounding);
    const markerIndex = message.indexOf(SETTINGS_MARKER);
    assert.ok(markerIndex > 0, 'settings marker must be present after request body');
    const requestBody = message.slice(0, markerIndex);
    const settingsTail = message.slice(markerIndex);

    assert.match(requestBody, /Course lesson structure:/);
    assert.match(requestBody, /script craft|script\.md|Before writing HTML/i);
    assert.match(requestBody, /source grounding \(authority\)/);
    assert.match(requestBody, /Binary search finds a key/);
    assert.match(requestBody, /render frame:/);
    assert.doesNotMatch(requestBody, new RegExp(SETTINGS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    assert.doesNotMatch(settingsTail, /Course lesson structure:/);
    assert.doesNotMatch(settingsTail, /source grounding \(authority\)/);
    assert.doesNotMatch(settingsTail, /Binary search finds a key/);
    assert.match(settingsTail, /^aspect ratio:/m);
    assert.match(settingsTail, /^generation length:\s*5:00$/m);
    assert.match(settingsTail, /^embed subtitle in video:\s*no$/m);
    assert.doesNotMatch(settingsTail, /^render frame:/m);

    const parsed = parseLectureGenRequest(message, ROOT);
    assert.equal(parsed.hasSettingsMarker, true);
    assert.match(parsed.request, /Course lesson structure:/);
    assert.match(parsed.request, /source grounding \(authority\)/);
    assert.equal(parsed.generationLength, '5:00');
    assert.equal(parsed.embedSubtitle, false);
    assert.ok(parsed.theme.length > 20);
    assert.ok(parsed.teachingStyle.length > 20);

    const merged = mergeLectureGenSettings(
      {
        generationLength: '7:00',
        aspectRatio: '16:9',
        theme: 'explicit-theme',
        teachingStyle: 'explicit-style',
        embedSubtitle: true
      },
      parsed
    );
    assert.equal(merged.generationLength, '7:00');
    assert.equal(merged.theme, 'explicit-theme');
    assert.equal(merged.teachingStyle, 'explicit-style');
    assert.equal(merged.embedSubtitle, true);

    const rebuilt = [
      parsed.request,
      buildLectureGenSettingsText({
        aspectRatio: merged.aspectRatio,
        generationLength: merged.generationLength,
        embedSubtitle: merged.embedSubtitle,
        enableGetimg: merged.enableGetimg,
        includeVideo: merged.includeVideo,
        includeInteractive: merged.includeInteractive,
        includeGame: merged.includeGame,
        theme: merged.theme,
        teachingStyle: merged.teachingStyle,
        profile: merged.profile
      })
    ].join('\n\n');

    const count = (haystack: string, needle: string) =>
      haystack.split(needle).length - 1;
    assert.equal(count(rebuilt, 'Course lesson structure:'), 1);
    assert.equal(count(rebuilt, 'source grounding (authority)'), 1);
    assert.equal(count(rebuilt, 'Binary search finds a key'), 1);
    assert.equal(count(rebuilt, 'Shared Script Craft Guide'), 1);
    assert.equal(count(rebuilt, SETTINGS_MARKER), 1);
    assert.equal(count(rebuilt, 'explicit-theme'), 1);
    assert.match(rebuilt, /^embed subtitle in video:\s*yes$/m);
    assert.doesNotMatch(
      rebuilt.slice(rebuilt.indexOf(SETTINGS_MARKER)),
      /Course lesson structure:|source grounding|Shared Script Craft Guide/
    );
  });

  it('formatGenerationLength clamps to 2–10 minutes', () => {
    assert.equal(formatGenerationLength(1), '2:00');
    assert.equal(formatGenerationLength(5), '5:00');
    assert.equal(formatGenerationLength(12), '10:00');
  });

  it('splitCourseProfile separates teaching style from theme body', () => {
    const { theme, teachingStyle } = splitCourseProfile(
      'visual system:\n- dark\n\nteaching style:\n- open with a question\n'
    );
    assert.match(theme, /visual system/);
    assert.match(teachingStyle, /open with a question/);
    assert.doesNotMatch(teachingStyle, /visual system/);
  });
});

describe('coursegen practice routing', () => {
  it('defaults practice paths under activities/', () => {
    assert.equal(defaultPracticeRelPath('interactive'), DEFAULT_INTERACTIVE_REL);
    assert.equal(defaultPracticeRelPath('game'), DEFAULT_GAME_REL);
    assert.equal(INTERACTIVE_PRACTICE_REL, 'activities/interactive/index.html');
    assert.equal(GAME_PRACTICE_REL, 'activities/game/index.html');
  });

  it('run-course routes practice create/repair through PracticeGen, not EditorAgent', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    assert.match(src, /spawnPracticeGen/);
    assert.match(src, /runPracticeGenTask/);
    assert.doesNotMatch(
      src,
      /mode:\s*'edit'[\s\S]{0,80}INTERACTIVE_PRACTICE_REL|INTERACTIVE_PRACTICE_REL[\s\S]{0,200}mode:\s*'edit'/
    );
    // Script repair may still use EditorAgent (index-root edits).
    assert.match(src, /mode:\s*'edit'/);
  });

  it('practicegen / iagen / gamegen modules import without LLM calls', () => {
    const script = `
      import { generatePracticePage, defaultPracticeRelPath } from ${JSON.stringify(
        pathToFileURL(path.join(ROOT, 'packages/lecture-agent/src/practicegen.ts')).href
      )};
      import { runIAGen } from ${JSON.stringify(
        pathToFileURL(path.join(ROOT, 'packages/lecture-agent/src/iagen.ts')).href
      )};
      import { runGameGen } from ${JSON.stringify(
        pathToFileURL(path.join(ROOT, 'packages/lecture-agent/src/gamegen.ts')).href
      )};
      if (typeof generatePracticePage !== 'function') throw new Error('generatePracticePage missing');
      if (typeof runIAGen !== 'function') throw new Error('runIAGen missing');
      if (typeof runGameGen !== 'function') throw new Error('runGameGen missing');
      if (defaultPracticeRelPath('interactive') !== 'activities/interactive/index.html') {
        throw new Error('interactive path mismatch');
      }
      console.log('practice-import-ok');
    `;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000
    });
    assert.equal(result.status, 0, `import failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /practice-import-ok/);
  });

  it('practicegen CLI --help resolves', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'packages/lecture-agent/src/practicegen.ts', '--help'],
      { cwd: ROOT, encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(result.status, 0, `practicegen --help failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /--kind/);
    assert.match(result.stdout, /activities/);
  });

  it('package.json exposes practicegen npm script', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(typeof pkg.scripts?.practicegen, 'string');
    assert.match(pkg.scripts.practicegen, /practicegen\.ts/);
  });

  it('EditorAgent mutation boundary stays index-only (no second write registry)', () => {
    const registry = readFileSync(
      path.join(ROOT, 'packages/lecture-agent/src/editor-agent/tools/tool_registry.ts'),
      'utf8'
    );
    assert.match(registry, /isIndexHtmlPath/);
    assert.match(registry, /Lecture editor may only edit workspace-root index/);
    assert.ok(!existsSync(path.join(ROOT, 'packages/lecture-agent/src/tools/tool_registry.ts')));
  });
});
