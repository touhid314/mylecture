/**
 * Unit tests: coursegen → LectureGen structured settings + practice routing (no LLM).
 * Run via npm run test:coursegen or:
 *   node --import tsx --test src/coursegen/coursegen-lecturegen.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { getAgentRoot, resolveAgentSrc } from './agent-paths.ts';
import {
  buildLectureGenCliFlags,
  type LectureGenSpawnSettings
} from './spawn.ts';
import {
  buildHtmlEditTaskMessage,
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
} from '../../../mylecture-agent/src/lecturegen.ts';
import {
  buildLectureGenSettingsText,
  mergeLectureGenSettings,
  SETTINGS_MARKER
} from './lecturegen-settings.ts';
import { lecturesReadyToGoLive } from './publish-course.ts';
import { hasResolvedHtml, hasEditOptions, lectureHasPractice, shouldRunLecture, videoResumeKind } from './run-course.ts';
import type { LectureState } from './types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENT_ROOT = getAgentRoot();

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
  it('buildVideoTaskMessage omits settings marker; CLI flags carry settings', () => {
    const { plan, lecture } = minimalPlan({ durationMinutes: 5 });
    const message = buildVideoTaskMessage(plan, lecture, 'Searching');
    assert.doesNotMatch(message, new RegExp(SETTINGS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(message, /if the user query is for video generation/);
    assert.match(message, /Create a 5-minute video lesson/);
    assert.match(message, /Course lesson structure:/);
    assert.match(message, /Do NOT create any interactive practice or game files/);
    assert.doesNotMatch(message, /^theme:/m);
    assert.doesNotMatch(message, /^teaching style:/m);
    assert.doesNotMatch(message, /^profile:/m);

    const settings = buildVideoGenerationSettings(plan, lecture);
    assert.equal(settings.generationLength, '5:00');
    assert.equal(settings.aspectRatio, '16:9');
    assert.ok(settings.theme.length > 20);
    assert.ok(settings.teachingStyle.length > 20);

    const flags = buildLectureGenCliFlags({
      ...settings,
      skipResolve: true
    });
    assert.deepEqual(flags, [
      '--length', '5:00',
      '--aspect-ratio', '16:9',
      '--theme', settings.theme,
      '--teaching-style', settings.teachingStyle,
      '--no-resolve'
    ]);
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

  it('buildLectureGenCliFlags adds --no-resolve when skipResolve is set', () => {
    const flags = buildLectureGenCliFlags({ skipResolve: true });
    assert.deepEqual(flags, ['--no-resolve']);
  });

  it('buildLectureGenCliFlags emits no-video interactive practice flags', () => {
    const flags = buildLectureGenCliFlags({
      skipVideo: true,
      includeInteractive: true,
      skipResolve: true
    });
    assert.deepEqual(flags, ['--no-resolve', '--no-video', '--interactive']);
  });

  it('buildLectureGenCliFlags emits no-video game practice flags', () => {
    const flags = buildLectureGenCliFlags({
      skipVideo: true,
      includeGame: true,
      skipResolve: true
    });
    assert.deepEqual(flags, ['--no-resolve', '--no-video', '--game']);
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
    const requestBody = buildVideoTaskMessage(plan, lecture, 'Searching', grounding);
    assert.doesNotMatch(requestBody, new RegExp(SETTINGS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    assert.match(requestBody, /Course lesson structure:/);
    assert.match(requestBody, /script craft|script\.md|Before writing HTML/i);
    assert.match(requestBody, /source grounding \(authority\)/);
    assert.match(requestBody, /Binary search finds a key/);
    assert.match(requestBody, /render frame:/);
    assert.match(requestBody, /Do NOT create any interactive practice or game files/);

    const settings = buildVideoGenerationSettings(plan, lecture);
    const message = [
      requestBody,
      buildLectureGenSettingsText({
        aspectRatio: settings.aspectRatio,
        generationLength: settings.generationLength,
        embedSubtitle: false,
        enableGetimg: true,
        includeVideo: true,
        includeInteractive: false,
        includeGame: false,
        theme: settings.theme,
        teachingStyle: settings.teachingStyle
      })
    ].join('\n\n');

    const markerIndex = message.indexOf(SETTINGS_MARKER);
    assert.ok(markerIndex > 0, 'settings marker must be present after request body');
    const settingsTail = message.slice(markerIndex);

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

describe('hasResolvedHtml', () => {
  it('returns false when no index files exist', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-resolved-'));
    try {
      assert.equal(hasResolvedHtml(dir), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false when only some indexes have resolved siblings', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-resolved-'));
    try {
      writeFileSync(path.join(dir, 'index1.html'), '<html></html>');
      writeFileSync(path.join(dir, 'resolved1.html'), '<html></html>');
      writeFileSync(path.join(dir, 'index2.html'), '<html></html>');
      assert.equal(hasResolvedHtml(dir), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns true when every index has a resolved sibling', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coursegen-resolved-'));
    try {
      writeFileSync(path.join(dir, 'index1.html'), '<html></html>');
      writeFileSync(path.join(dir, 'resolved1.html'), '<html></html>');
      writeFileSync(path.join(dir, 'index2.html'), '<html></html>');
      writeFileSync(path.join(dir, 'resolved2.html'), '<html></html>');
      assert.equal(hasResolvedHtml(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('videoResumeKind', () => {
  it('generate when no index or force lecture', () => {
    assert.equal(
      videoResumeKind({ existingIndex: false, forceLecture: false, resolvedReady: false }),
      'generate'
    );
    assert.equal(
      videoResumeKind({ existingIndex: false, forceLecture: false, resolvedReady: true }),
      'generate'
    );
    assert.equal(
      videoResumeKind({ existingIndex: true, forceLecture: true, resolvedReady: false }),
      'generate'
    );
    assert.equal(
      videoResumeKind({ existingIndex: true, forceLecture: true, resolvedReady: true }),
      'generate'
    );
  });

  it('resolve-only when index exists without all resolved siblings', () => {
    assert.equal(
      videoResumeKind({ existingIndex: true, forceLecture: false, resolvedReady: false }),
      'resolve-only'
    );
  });

  it('skip-to-render when index and resolved ready without force', () => {
    assert.equal(
      videoResumeKind({ existingIndex: true, forceLecture: false, resolvedReady: true }),
      'skip-to-render'
    );
  });
});

describe('practice-only retry selection', () => {
  const plan = minimalPlan().plan;
  const baseLecture = (): LectureState => ({
    slug: 'place-value-and-number-names',
    title: 'Place Value',
    module: 'Whole Numbers',
    order: 1,
    folderName: '01-place-value-and-number-names',
    objective: 'Identify place value',
    durationMinutes: 4,
    formats: ['video', 'interactive'],
    status: 'needs-review',
    attempts: 1,
    costUsd: 0,
    error: '',
    mp4Path: '',
    interactiveReview: 'needs-review',
    interactiveReviewNotes: 'leak',
    gameReview: 'not-required',
    gameReviewNotes: ''
  });

  it('lectureHasPractice is true for interactive or game', () => {
    assert.equal(lectureHasPractice({ formats: ['video', 'interactive'] }), true);
    assert.equal(lectureHasPractice({ formats: ['video', 'game'] }), true);
    assert.equal(lectureHasPractice({ formats: ['video'] }), false);
  });

  it('practiceOnly + forceLecture selects only that lecture', () => {
    const lecture = baseLecture();
    assert.equal(
      shouldRunLecture(lecture, plan, {
        courseSlug: 'demo',
        practiceOnly: true,
        forceLecture: lecture.slug
      }),
      true
    );
    assert.equal(
      shouldRunLecture(lecture, plan, {
        courseSlug: 'demo',
        practiceOnly: true,
        forceLecture: 'other-slug'
      }),
      false
    );
  });

  it('practiceOnly without forceLecture only retries needs-review/failed when retryFailed', () => {
    const lecture = baseLecture();
    assert.equal(shouldRunLecture(lecture, plan, { courseSlug: 'demo', practiceOnly: true }), false);
    assert.equal(
      shouldRunLecture(lecture, plan, { courseSlug: 'demo', practiceOnly: true, retryFailed: true }),
      true
    );
    lecture.status = 'done';
    assert.equal(
      shouldRunLecture(lecture, plan, { courseSlug: 'demo', practiceOnly: true, retryFailed: true }),
      false
    );
  });

  it('practiceRepair uses the same lecture targeting as practiceOnly', () => {
    const lecture = baseLecture();
    assert.equal(
      shouldRunLecture(lecture, plan, {
        courseSlug: 'demo',
        practiceRepair: true,
        forceLecture: lecture.slug
      }),
      true
    );
    assert.equal(
      shouldRunLecture(lecture, plan, { courseSlug: 'demo', practiceRepair: true, retryFailed: true }),
      true
    );
  });

  it('practiceOnly skips video-only lectures', () => {
    const lecture = baseLecture();
    lecture.formats = ['video'];
    assert.equal(
      shouldRunLecture(lecture, plan, {
        courseSlug: 'demo',
        practiceOnly: true,
        forceLecture: lecture.slug
      }),
      false
    );
  });

  it('editTarget + forceLecture selects only that lecture', () => {
    const lecture = baseLecture();
    lecture.formats = ['video'];
    assert.equal(
      shouldRunLecture(lecture, plan, {
        courseSlug: 'demo',
        forceLecture: lecture.slug,
        editTarget: 'video',
        editPrompt: 'Make the title larger'
      }),
      true
    );
    assert.equal(
      shouldRunLecture(lecture, plan, {
        courseSlug: 'demo',
        forceLecture: 'other-slug',
        editTarget: 'video',
        editPrompt: 'Make the title larger'
      }),
      false
    );
  });

  it('editTarget does not require practice formats for video edits', () => {
    const lecture = baseLecture();
    lecture.formats = ['video'];
    assert.equal(
      shouldRunLecture(lecture, plan, {
        courseSlug: 'demo',
        forceLecture: lecture.slug,
        editTarget: 'video',
        editPrompt: 'Change the hook'
      }),
      true
    );
    assert.equal(hasEditOptions({
      courseSlug: 'demo',
      editTarget: 'video',
      editPrompt: 'x'
    }), true);
    assert.equal(hasEditOptions({
      courseSlug: 'demo',
      editTarget: 'video'
    }), false);
  });
});

describe('coursegen resolve/render spawn paths', () => {
  it('spawn.ts uses mylecture-agent resolve-render scripts, not mylecture/src/build-plan.ts', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/spawn.ts'), 'utf8');
    assert.match(src, /src\/resolve-render\/build-plan\.ts/);
    assert.match(src, /src\/resolve-render\/render-video\.ts/);
    assert.match(src, /getAgentRoot\(\)/);
    assert.match(src, /requireAgentFile\('resolve-render', 'build-plan\.ts'\)/);
    assert.doesNotMatch(src, /['"]src\/build-plan\.ts['"]/);
    assert.doesNotMatch(src, /['"]src\/render-video\.ts['"]/);
  });

  it('go-live publishes only done lectures', () => {
    const ready = lecturesReadyToGoLive([
      { slug: 'one', status: 'done' },
      { slug: 'two', status: 'pending' },
      { slug: 'three', status: 'needs-review' },
      { slug: 'four', status: 'failed' }
    ]);
    assert.deepEqual(ready.map(lecture => lecture.slug), ['one']);
    const src = readFileSync(path.join(ROOT, 'src/coursegen/publish-course.ts'), 'utf8');
    assert.doesNotMatch(src, /Cannot go live: \$\{notDone\.length\}/);
    assert.doesNotMatch(src, /Cannot go live: \$\{needsReview\.length\}/);
    assert.match(src, /Go-live will publish finished lectures only/);
    assert.match(src, /ensureLectureThumbnail/);
  });

  it('runCapture does not re-merge process.env over a stripped child env', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/spawn.ts'), 'utf8');
    assert.match(src, /env: options\.env \?\? process\.env/);
    assert.doesNotMatch(src, /options\.env \? \{ \.\.\.process\.env, \.\.\.options\.env \}/);
  });

  it('resolve/render scripts exist under mylecture-agent', () => {
    const buildPlan = resolveAgentSrc('resolve-render', 'build-plan.ts');
    const renderVideo = resolveAgentSrc('resolve-render', 'render-video.ts');
    assert.equal(path.dirname(buildPlan), path.join(AGENT_ROOT, 'src', 'resolve-render'));
    assert.equal(path.dirname(renderVideo), path.join(AGENT_ROOT, 'src', 'resolve-render'));
    assert.ok(existsSync(buildPlan));
    assert.ok(existsSync(renderVideo));
  });
});

describe('coursegen practice routing', () => {
  it('defaults practice paths under activities/', () => {
    assert.equal(INTERACTIVE_PRACTICE_REL, 'activities/interactive/index.html');
    assert.equal(GAME_PRACTICE_REL, 'activities/game/index.html');
  });

  it('IAGen and GameGen load native system prompts without PracticeGen overrides', () => {
    const iagen = readFileSync(path.join(AGENT_ROOT, 'src/iagen.ts'), 'utf8');
    const gamegen = readFileSync(path.join(AGENT_ROOT, 'src/gamegen.ts'), 'utf8');
    const lecturegen = readFileSync(path.join(AGENT_ROOT, 'src/lecturegen.ts'), 'utf8');
    const iagenPrompt = readFileSync(path.join(AGENT_ROOT, 'src/prompts/iagen_system.md'), 'utf8');
    const gamegenPrompt = readFileSync(path.join(AGENT_ROOT, 'src/prompts/gamegen_system.md'), 'utf8');
    const lecturePrompt = readFileSync(path.join(ROOT, 'src/coursegen/lecture-prompt.ts'), 'utf8');

    assert.match(iagen, /iagen_system\.md/);
    assert.doesNotMatch(iagen, /systemPrompt\?/);
    assert.doesNotMatch(iagen, /practicegen_system/);
    assert.match(gamegen, /gamegen_system\.md/);
    assert.doesNotMatch(gamegen, /systemPrompt\?/);
    assert.doesNotMatch(gamegen, /practicegen_system/);
    assert.doesNotMatch(lecturegen, /practicegen_system\.md/);
    assert.match(iagenPrompt, /not to quiz/);
    assert.ok(gamegenPrompt.length > 100);
    assert.doesNotMatch(lecturePrompt, /PracticeGen/);
    assert.ok(!existsSync(path.join(AGENT_ROOT, 'src/practicegen.ts')));
    assert.ok(!existsSync(path.join(AGENT_ROOT, 'src/prompts/practicegen_system.md')));
    assert.ok(!existsSync(path.join(ROOT, 'src/coursegen/prompts/interactive-practice.md')));
  });

  it('readability QA does not treat stage titles as 16px body text', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/review-practice.ts'), 'utf8');
    assert.match(src, /headingSelector/);
    assert.match(src, /Do not include #activity-stage/);
    assert.doesNotMatch(
      src,
      /bodySelector = 'p, li, #activity-instructions, #activity-stage/
    );
  });

  it('review-practice does not inject PracticeGen chrome styles', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/review-practice.ts'), 'utf8');
    assert.doesNotMatch(src, /ensurePracticeChromeStyles/);
    assert.match(src, /collectInlineCssParseFindings/);
  });

  it('readability QA allowlists IAGen left/info panels and horizontal teaching overflow', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/review-practice.ts'), 'utf8');
    assert.match(src, /#left-panel/);
    assert.match(src, /#info-panel/);
    assert.match(src, /horizontalOverflow > 4[\s\S]*overflowX === 'auto'/);
  });

  it('skipPracticeReview copies sidecars before early return', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    const phaseStart = src.indexOf('async function runPracticePhase');
    assert.ok(phaseStart >= 0);
    const phaseBody = src.slice(phaseStart);
    const skipIdx = phaseBody.indexOf('if (options.skipPracticeReview)');
    const copyIdx = phaseBody.indexOf('copyPracticeRootToSidecar(folderPath');
    assert.ok(skipIdx > 0 && copyIdx > 0);
    assert.ok(copyIdx < skipIdx, 'sidecar copy must run before skipPracticeReview return');
  });

  it('practice creation reference prefers script.md and omits index.html', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    const fnMatch = src.match(/function practiceReferencePath[\s\S]*?^}/m);
    assert.ok(fnMatch);
    assert.match(fnMatch[0], /script\.md/);
    assert.doesNotMatch(fnMatch[0], /indexPath/);
    assert.doesNotMatch(fnMatch[0], /index\.html/);
  });

  it('runPracticeLectureGenTask requires root HTML copy after LectureGen', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    assert.match(src, /copyPracticeRootToSidecar\([^)]*required:\s*true/);
    assert.match(src, /missing after task succeeded/);
  });

  it('LectureGen no-video does not write metadata.json', () => {
    const src = readFileSync(path.join(AGENT_ROOT, 'src/lecturegen.ts'), 'utf8');
    assert.match(src, /if \(input\.includeVideo\)[\s\S]*metadata\.json/);
  });

  it('exposes retry-practice in CLI, server, and UI', () => {
    const cli = readFileSync(path.join(ROOT, 'src/coursegen/cli.ts'), 'utf8');
    const server = readFileSync(path.join(ROOT, 'src/coursegen/server.ts'), 'utf8');
    const ui = readFileSync(path.join(ROOT, 'src/coursegen/ui.html'), 'utf8');
    const run = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    assert.match(cli, /retry-practice/);
    assert.match(cli, /repair-practice/);
    assert.match(cli, /--edit-target/);
    assert.match(cli, /--edit-prompt/);
    assert.match(server, /practiceOnly/);
    assert.match(server, /practiceRepair/);
    assert.match(server, /edit-target/);
    assert.match(server, /edit-prompt/);
    assert.match(ui, /retry-practice/);
    assert.match(ui, /repair-practice/);
    assert.match(ui, /data-lecture-action="edit"/);
    assert.match(ui, /editTarget/);
    assert.match(ui, /editPrompt/);
    assert.match(run, /practiceOnly/);
    assert.match(run, /practiceRepair/);
    assert.match(run, /deletePracticeOutputs/);
    assert.match(run, /practiceRepair/);
    assert.match(run, /runEditPhase/);
    assert.match(run, /hasEditOptions/);
  });

  it('edit path uses mode edit and skips deletePracticeOutputs', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    const editBranch = src.match(
      /if \(hasEditOptions\(options\)\) \{\s*\r?\n\s*await runEditPhase[\s\S]*?return;/m
    );
    assert.ok(editBranch);
    assert.match(editBranch[0], /runEditPhase/);
    assert.doesNotMatch(editBranch[0], /finalizeLectureStatus/);
    assert.doesNotMatch(editBranch[0], /deletePracticeOutputs/);
    assert.doesNotMatch(editBranch[0], /cleanupVideoArtifactsForRerun/);
    const editPhase = src.match(/async function runEditPhase[\s\S]*?^}/m);
    assert.ok(editPhase);
    assert.match(editPhase[0], /mode:\s*'edit'/);
    assert.match(editPhase[0], /maxTurns: options\.maxTurns \?\? 60/);
    assert.match(editPhase[0], /setPracticeReview\(lectureState, kind, 'passed', ''\)/);
    assert.match(editPhase[0], /finalizeLectureStatus\(lectureState\)/);
    assert.doesNotMatch(editPhase[0], /status !== 'rendering'/);
  });

  it('submitEditOverlay rejects disallowed edit targets', () => {
    const ui = readFileSync(path.join(ROOT, 'src/coursegen/ui.html'), 'utf8');
    const fnMatch = ui.match(/async function submitEditOverlay\(\)[\s\S]*?^    \}/m);
    assert.ok(fnMatch);
    const fnBody = fnMatch[0];
    assert.match(fnBody, /canEditVideo/);
    assert.match(fnBody, /canEditInteractive/);
    assert.match(fnBody, /canEditGame/);
    assert.match(fnBody, /target === 'video' && !canVideo/);
    assert.match(fnBody, /target === 'interactive' && !canInteractive/);
    assert.match(fnBody, /target === 'game' && !canGame/);
  });

  it('buildHtmlEditTaskMessage mentions target file and user prompt', () => {
    const video = buildHtmlEditTaskMessage({
      target: 'video',
      prompt: 'Increase font size on the title slide',
      objective: 'Learn sorting',
      title: 'Intro to Sorting'
    });
    assert.match(video, /index\.html or indexN\.html/);
    assert.match(video, /Increase font size on the title slide/);
    assert.match(video, /Intro to Sorting/);
    assert.match(video, /Do not regenerate the lesson from scratch/i);
    assert.match(video, /Do NOT create or modify interactive\.html/);

    const interactive = buildHtmlEditTaskMessage({
      target: 'interactive',
      prompt: 'Add a hint button',
      objective: 'Practice fractions',
      title: 'Fractions'
    });
    assert.match(interactive, /interactive\.html only/);
    assert.match(interactive, /Add a hint button/);

    const game = buildHtmlEditTaskMessage({
      target: 'game',
      prompt: 'Raise the score target',
      objective: 'Practice multiplication',
      title: 'Times Tables'
    });
    assert.match(game, /game\.html only/);
    assert.match(game, /Raise the score target/);
  });

  it('run-course routes practice create/repair through LectureGen spawnAgent, not EditorAgent', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    assert.match(src, /runPracticeLectureGenTask/);
    assert.match(src, /spawnAgent/);
    assert.doesNotMatch(src, /spawnPracticeGen/);
    assert.doesNotMatch(src, /runPracticeGenTask/);
    assert.doesNotMatch(
      src,
      /mode:\s*'edit'[\s\S]{0,80}INTERACTIVE_PRACTICE_REL|INTERACTIVE_PRACTICE_REL[\s\S]{0,200}mode:\s*'edit'/
    );
    // Script repair may still use EditorAgent (index-root edits).
    assert.match(src, /mode:\s*'edit'/);
  });

  it('iagen and gamegen modules import without LLM calls', () => {
    const script = `
      import { runIAGen } from ${JSON.stringify(
        pathToFileURL(path.join(AGENT_ROOT, 'src/iagen.ts')).href
      )};
      import { runGameGen } from ${JSON.stringify(
        pathToFileURL(path.join(AGENT_ROOT, 'src/gamegen.ts')).href
      )};
      if (typeof runIAGen !== 'function') throw new Error('runIAGen missing');
      if (typeof runGameGen !== 'function') throw new Error('runGameGen missing');
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

  it('package.json does not expose practicegen npm script', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts?.practicegen, undefined);
  });

  it('copyPracticeRootToSidecar required throws when root missing even if sidecar exists', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    const fnMatch = src.match(/function copyPracticeRootToSidecar[\s\S]*?^}/m);
    assert.ok(fnMatch);
    const fnBody = fnMatch[0];
    const requiredIdx = fnBody.indexOf('options?.required');
    const sidecarReturnIdx = fnBody.indexOf('if (existsSync(sidecarPath)) return true');
    assert.ok(requiredIdx >= 0);
    assert.ok(sidecarReturnIdx >= 0);
    assert.ok(requiredIdx < sidecarReturnIdx, 'required must throw before stale sidecar short-circuit');
    assert.match(fnBody, /if \(options\?\.required\)[\s\S]*throw new Error/);
  });

  it('skipPracticeReview does not assign passed over needs-review', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    const phaseStart = src.indexOf('async function runPracticePhase');
    assert.ok(phaseStart >= 0);
    const skipBlock = src.slice(phaseStart).match(/if \(options\.skipPracticeReview\)[\s\S]*?return;/);
    assert.ok(skipBlock);
    assert.match(skipBlock[0], /interactiveReview !== 'needs-review'/);
    assert.match(skipBlock[0], /gameReview !== 'needs-review'/);
    assert.match(skipBlock[0], /practiceOutputExists\(folderPath, 'interactive'\)/);
    assert.match(skipBlock[0], /practiceOutputExists\(folderPath, 'game'\)/);
    assert.doesNotMatch(skipBlock[0], /if \(needsInteractive\) lectureState\.interactiveReview = 'passed'/);
    assert.doesNotMatch(skipBlock[0], /if \(needsGame\) lectureState\.gameReview = 'passed'/);
  });

  it('review skipped when notes start with generation failed', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    const phaseStart = src.indexOf('async function runPracticePhase');
    assert.ok(phaseStart >= 0);
    const phaseBody = src.slice(phaseStart);
    assert.match(phaseBody, /interactiveGenerationFailed/);
    assert.match(phaseBody, /gameGenerationFailed/);
    assert.match(phaseBody, /startsWith\('generation failed'\)/);
    assert.match(phaseBody, /!interactiveGenerationFailed/);
    assert.match(phaseBody, /!gameGenerationFailed/);
  });

  it('forceLecture deletes practice outputs before regen', () => {
    const src = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    const forceBlock = src.match(
      /if \(options\.forceLecture\) \{\s*\r?\n\s*cleanupVideoArtifactsForRerun\(folderPath\);[\s\S]*?lectureState\.mp4Path = '';/m
    );
    assert.ok(forceBlock);
    assert.match(forceBlock[0], /deletePracticeOutputs\(folderPath\)/);
    const deleteIdx = forceBlock[0].indexOf('deletePracticeOutputs');
    const mp4Idx = forceBlock[0].indexOf("lectureState.mp4Path = ''");
    assert.ok(deleteIdx >= 0 && mp4Idx >= 0);
    assert.ok(deleteIdx < mp4Idx, 'deletePracticeOutputs must run during forceLecture cleanup');
  });

  it('EditorAgent mutation boundary stays index-only (no second write registry)', () => {
    const registry = readFileSync(
      path.join(AGENT_ROOT, 'src/editor-agent/tools/tool_registry.ts'),
      'utf8'
    );
    assert.match(registry, /isAllowedHtmlPath/);
    assert.match(registry, /Lecture editor may only edit workspace-root HTML files/);
    assert.ok(!existsSync(path.join(AGENT_ROOT, 'src/tools/tool_registry.ts')));
  });
});
