import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { CoursePlan, CourseState, LectureState, PracticeReviewStatus } from './types.ts';
import {
  getCourseDir,
  isIndexHtmlName,
  isResolvedHtmlName,
  lectureFolderName,
  lectureFolderPath,
  resolvedSiblingPathForIndex
} from './paths.ts';
import {
  buildGameTaskMessage,
  buildInteractiveTaskMessage,
  buildPracticeRepairMessage,
  buildVideoTaskMessage,
  estimateCourseCostUsd,
  formatLectureSequenceContext,
  formatGameSpec,
  formatInteractiveSpec,
  GAME_PRACTICE_REL,
  INTERACTIVE_PRACTICE_REL,
  printPlanSummary,
  type PracticeHtmlRelPath
} from './lecture-prompt.ts';
import { readCoursePlan, readCourseState, writeCourseState } from './state.ts';
import { DEFAULT_LEARNING_INTENT, flattenPlanLectures, initialCourseState, resolveGameSpec, resolveInteractiveSpec } from './types.ts';
import { parseCostUsdFromOutput, spawnAgent, spawnRenderLecture, spawnResolve } from './spawn.ts';
import { confirm } from './confirm.ts';
import { cleanupScreenshotDir, reviewPracticeWithRubric, type RubricResult } from './review-practice.ts';
import { buildScriptRepairMessage, reviewScriptWithRubric, type ScriptReviewResult } from './review-script.ts';

export type RunCourseOptions = {
  courseSlug: string;
  yes?: boolean;
  budgetUsd?: number;
  maxTurns?: number;
  maxPracticeTurns?: number;
  lectureTimeoutMinutes?: number;
  retryFailed?: boolean;
  forceLecture?: string;
  skipPracticeReview?: boolean;
  skipScriptReview?: boolean;
  ttsVoice?: string;
  ttsSpeed?: string;
  model?: string;
  dryRun?: boolean;
  /** When true, mux resolved HTML to MP4 after resolve. Default: false (resolve-only). */
  render?: boolean;
  /** When true, only mux existing resolved HTML to MP4 — no agent, resolve, or practice. */
  renderOnly?: boolean;
};

type PracticeKind = 'interactive' | 'game';

const LEGACY_TOP_LEVEL_PRACTICE_FILES = ['interactive.html', 'game.html'] as const;

function setPracticeReview(
  lectureState: LectureState,
  kind: PracticeKind,
  status: PracticeReviewStatus,
  notes: string
) {
  if (kind === 'interactive') {
    lectureState.interactiveReview = status;
    lectureState.interactiveReviewNotes = notes;
  } else {
    lectureState.gameReview = status;
    lectureState.gameReviewNotes = notes;
  }
}

function makeCostRecorder(lectureState: LectureState, state: CourseState) {
  return (costUsd: number) => {
    lectureState.costUsd = Number((lectureState.costUsd + costUsd).toFixed(4));
    state.spentUsd = Number((state.spentUsd + costUsd).toFixed(4));
  };
}

function defaultReviewFields(lecture: Partial<LectureState>) {
  return {
    interactiveReview: lecture.interactiveReview ?? 'not-required',
    interactiveReviewNotes: lecture.interactiveReviewNotes ?? '',
    gameReview: lecture.gameReview ?? 'not-required',
    gameReviewNotes: lecture.gameReviewNotes ?? ''
  } as const;
}

export function syncStateFromPlan(state: CourseState, plan: CoursePlan) {
  const rows = flattenPlanLectures(plan);
  const bySlug = new Map(state.lectures.map(lecture => [lecture.slug, lecture]));
  state.lectures = rows.map(row => {
    const existing = bySlug.get(row.slug);
    if (existing) {
      const synced = {
        ...defaultReviewFields(existing),
        ...existing,
        title: row.title,
        module: row.module,
        order: row.order,
        objective: row.objective,
        durationMinutes: row.durationMinutes,
        formats: row.formats
      };
      if (!row.formats.includes('interactive')) {
        synced.interactiveReview = 'not-required';
        synced.interactiveReviewNotes = '';
      }
      if (!row.formats.includes('game')) {
        synced.gameReview = 'not-required';
        synced.gameReviewNotes = '';
      }
      return synced;
    }
    return {
      slug: row.slug,
      title: row.title,
      module: row.module,
      order: row.order,
      folderName: '',
      objective: row.objective,
      durationMinutes: row.durationMinutes,
      formats: row.formats,
      status: 'pending',
      attempts: 0,
      costUsd: 0,
      error: '',
      mp4Path: '',
      ...defaultReviewFields({})
    };
  });
  return state;
}

function findPlannedLecture(plan: CoursePlan, slug: string) {
  for (const module of plan.modules) {
    for (const lecture of module.lectures) {
      if (lecture.slug === slug) {
        return { lecture, moduleTitle: module.title };
      }
    }
  }
  return null;
}

function practiceReviewPending(lecture: LectureState) {
  const interactivePending =
    lecture.formats.includes('interactive') &&
    lecture.interactiveReview !== 'passed' &&
    lecture.interactiveReview !== 'needs-review';
  const gamePending =
    lecture.formats.includes('game') &&
    lecture.gameReview !== 'passed' &&
    lecture.gameReview !== 'needs-review';
  return interactivePending || gamePending;
}

function wantsRender(options: RunCourseOptions) {
  return options.render === true;
}

function findLatestIndexFile(folderPath: string) {
  if (!existsSync(folderPath)) return null;
  const indexFiles = readdirSync(folderPath)
    .filter(name => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const latest = indexFiles[indexFiles.length - 1];
  return latest ? path.join(folderPath, latest) : null;
}

export function hasResolvedHtml(folderPath: string) {
  if (!existsSync(folderPath)) return false;
  return readdirSync(folderPath)
    .filter(name => isIndexHtmlName(name))
    .some(name => existsSync(resolvedSiblingPathForIndex(path.join(folderPath, name))));
}

export function lectureRenderReady(plan: CoursePlan, lecture: LectureState) {
  if (!lecture.formats.includes('video')) return false;
  const folderName = lecture.folderName || lectureFolderName(lecture.order, lecture.slug);
  const folderPath = lectureFolderPath(plan.slug, folderName);
  if (!hasResolvedHtml(folderPath)) return false;
  return !(lecture.mp4Path && existsSync(lecture.mp4Path));
}

function shouldRunLecture(lecture: LectureState, plan: CoursePlan, options: RunCourseOptions) {
  if (options.renderOnly) {
    if (options.forceLecture) {
      return options.forceLecture === lecture.slug && lectureRenderReady(plan, lecture);
    }
    return lectureRenderReady(plan, lecture);
  }
  if (options.forceLecture) {
    return lecture.slug === options.forceLecture;
  }
  if (lecture.status === 'failed') return Boolean(options.retryFailed);
  if (
    lecture.status === 'generating' ||
    lecture.status === 'resolving' ||
    lecture.status === 'rendering' ||
    lecture.status === 'generating-practice' ||
    lecture.status === 'reviewing'
  ) {
    return true;
  }
  if (lecture.status === 'needs-review') return Boolean(options.retryFailed);
  if (lecture.status === 'done' && wantsRender(options) && lecture.formats.includes('video')) {
    if (!lecture.mp4Path || !existsSync(lecture.mp4Path)) return true;
  }
  if (lecture.status === 'done' && practiceReviewPending(lecture)) return true;
  return lecture.status === 'pending';
}

function findIndexFile(folderPath: string) {
  return findLatestIndexFile(folderPath);
}

function cleanupLegacyTopLevelPracticeFiles(folderPath: string) {
  for (const fileName of LEGACY_TOP_LEVEL_PRACTICE_FILES) {
    const filePath = path.join(folderPath, fileName);
    if (!existsSync(filePath)) continue;
    rmSync(filePath, { force: true });
    console.log(`  Removed legacy top-level practice file: ${fileName}`);
  }
}

function cleanupCourseLegacyPracticeFiles(plan: CoursePlan, state: CourseState) {
  for (const lecture of state.lectures) {
    const folderName = lecture.folderName || lectureFolderName(lecture.order, lecture.slug);
    cleanupLegacyTopLevelPracticeFiles(lectureFolderPath(plan.slug, folderName));
  }
}

function cleanupVideoArtifactsForRerun(folderPath: string) {
  if (!existsSync(folderPath)) return;
  for (const entry of readdirSync(folderPath, { withFileTypes: true })) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'audio') {
        rmSync(entryPath, { recursive: true, force: true });
      }
      continue;
    }
    if (
      isIndexHtmlName(entry.name) ||
      isResolvedHtmlName(entry.name) ||
      entry.name.toLowerCase().endsWith('.mp4')
    ) {
      rmSync(entryPath, { force: true });
    }
  }
}

async function runAgentTask(options: {
  workspaceDir: string;
  taskMessage: string;
  maxTurns: number;
  model?: string;
  timeoutMinutes: number;
  onCost: (costUsd: number) => void;
}) {
  const timeoutMs = options.timeoutMinutes * 60 * 1000;
  let killAgent: (() => void) | null = null;
  const timeout = setTimeout(() => {
    killAgent?.();
  }, timeoutMs);

  let agentOutput = '';
  try {
    const { promise, kill } = spawnAgent({
      workspaceDir: options.workspaceDir,
      taskMessage: options.taskMessage,
      maxTurns: options.maxTurns,
      model: options.model,
      onStdout: chunk => { agentOutput += chunk; },
      onStderr: chunk => { agentOutput += chunk; }
    });
    killAgent = kill;
    await promise;
  } finally {
    clearTimeout(timeout);
    killAgent = null;
  }

  const costUsd = parseCostUsdFromOutput(agentOutput);
  options.onCost(costUsd);
  return agentOutput;
}

async function reviewOnePracticeFile(options: {
  lectureState: LectureState;
  state: CourseState;
  folderPath: string;
  fileName: PracticeHtmlRelPath;
  kind: PracticeKind;
  specText: string;
  spec: NonNullable<ReturnType<typeof resolveInteractiveSpec>> | NonNullable<ReturnType<typeof resolveGameSpec>>;
  runOptions: RunCourseOptions;
  allowRepair: boolean;
}): Promise<'passed' | 'needs-review'> {
  const htmlPath = path.join(options.folderPath, options.fileName);
  const screenshotDir = path.join(options.folderPath, '.practice-review', options.kind);

  if (!existsSync(htmlPath)) {
    setPracticeReview(options.lectureState, options.kind, 'needs-review', `${options.fileName} not found after generation`);
    writeCourseState(options.state);
    return 'needs-review';
  }

  try {
    let result: RubricResult;
    try {
      result = await reviewPracticeWithRubric({
        objective: options.lectureState.objective,
        htmlPath,
        kind: options.kind,
        spec: options.spec,
        screenshotDir,
        model: options.runOptions.model
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(options.lectureState, options.kind, 'needs-review', `QA infrastructure error: ${message}`);
      writeCourseState(options.state);
      return 'needs-review';
    }

    if (!result.passed && options.allowRepair) {
      console.log(`  Practice QA failed for ${options.fileName}; running one repair pass...`);
      result.findings.forEach(finding => console.log(`    - ${finding}`));
      const repairMessage = buildPracticeRepairMessage({
        fileName: options.fileName,
        objective: options.lectureState.objective,
        findings: result.findings,
        specText: options.specText
      });
      try {
        await runAgentTask({
          workspaceDir: options.folderPath,
          taskMessage: repairMessage,
          maxTurns: options.runOptions.maxPracticeTurns ?? 40,
          model: options.runOptions.model,
          timeoutMinutes: options.runOptions.lectureTimeoutMinutes ?? 20,
          onCost: makeCostRecorder(options.lectureState, options.state)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPracticeReview(options.lectureState, options.kind, 'needs-review', `QA infrastructure error: ${message}`);
        writeCourseState(options.state);
        return 'needs-review';
      }

      cleanupScreenshotDir(screenshotDir);
      try {
        result = await reviewPracticeWithRubric({
          objective: options.lectureState.objective,
          htmlPath,
          kind: options.kind,
          spec: options.spec,
          screenshotDir,
          model: options.runOptions.model
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPracticeReview(options.lectureState, options.kind, 'needs-review', `QA infrastructure error: ${message}`);
        writeCourseState(options.state);
        return 'needs-review';
      }
    }

    if (result.passed) {
      setPracticeReview(options.lectureState, options.kind, 'passed', '');
      writeCourseState(options.state);
      return 'passed';
    }

    setPracticeReview(options.lectureState, options.kind, 'needs-review', result.findings.join('; '));
    writeCourseState(options.state);
    return 'needs-review';
  } finally {
    cleanupScreenshotDir(screenshotDir);
  }
}

/**
 * Narration-quality gate: review the generated script before paying for TTS
 * and render. Fails soft - after one revision pass, generation continues even
 * if the reviewer is still unhappy, since narration style is subjective and a
 * stalled pipeline is worse than an imperfect script.
 */
async function runScriptReviewPhase(
  plan: CoursePlan,
  planned: NonNullable<ReturnType<typeof findPlannedLecture>>,
  lectureState: LectureState,
  state: CourseState,
  folderPath: string,
  options: RunCourseOptions
) {
  const reviewOptions = {
    folderPath,
    objective: lectureState.objective,
    audience: plan.audience,
    intent: plan.intent ?? DEFAULT_LEARNING_INTENT,
    durationMinutes: planned.lecture.durationMinutes,
    courseContext: formatLectureSequenceContext(plan, planned.lecture),
    model: options.model
  };

  console.log('  Reviewing narration script...');
  let result: ScriptReviewResult;
  try {
    result = await reviewScriptWithRubric(reviewOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Script review skipped (infrastructure error): ${message}`);
    return;
  }

  if (result.passed) {
    console.log('  Script review: passed');
    return;
  }

  console.log('  Script review failed; running one narration revision pass...');
  result.findings.forEach(finding => console.log(`    - ${finding}`));

  try {
    await runAgentTask({
      workspaceDir: folderPath,
      taskMessage: buildScriptRepairMessage({
        objective: lectureState.objective,
        findings: result.findings
      }),
      maxTurns: options.maxTurns ?? 60,
      model: options.model,
      timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
      onCost: makeCostRecorder(lectureState, state)
    });
    writeCourseState(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Narration revision failed: ${message}. Continuing with original narration.`);
    return;
  }

  try {
    result = await reviewScriptWithRubric(reviewOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Script re-review skipped (infrastructure error): ${message}`);
    return;
  }

  if (result.passed) {
    console.log('  Script review: passed after revision');
    return;
  }
  console.log('  Script review still failing after one revision; continuing to render. Remaining findings:');
  result.findings.forEach(finding => console.log(`    - ${finding}`));
}

async function runPracticePhase(
  plan: CoursePlan,
  state: CourseState,
  lectureState: LectureState,
  planned: NonNullable<ReturnType<typeof findPlannedLecture>>,
  folderPath: string,
  indexPath: string,
  options: RunCourseOptions
) {
  const needsInteractive = planned.lecture.formats.includes('interactive');
  const needsGame = planned.lecture.formats.includes('game');
  if (!needsInteractive && !needsGame) return;

  cleanupLegacyTopLevelPracticeFiles(folderPath);

  lectureState.status = 'generating-practice';
  writeCourseState(state);

  const interactivePath = path.join(folderPath, INTERACTIVE_PRACTICE_REL);
  const gamePath = path.join(folderPath, GAME_PRACTICE_REL);
  const regenAll = Boolean(options.forceLecture);

  if (needsInteractive && (regenAll || !existsSync(interactivePath))) {
    console.log(`  Generating ${INTERACTIVE_PRACTICE_REL}...`);
    const taskMessage = buildInteractiveTaskMessage(plan, planned.lecture, planned.moduleTitle, indexPath);
    try {
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        maxTurns: options.maxPracticeTurns ?? 40,
        model: options.model,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        onCost: makeCostRecorder(lectureState, state)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(lectureState, 'interactive', 'needs-review', `generation failed: ${message}`);
      writeCourseState(state);
    }
  }

  if (needsGame && (regenAll || !existsSync(gamePath))) {
    console.log(`  Generating ${GAME_PRACTICE_REL}...`);
    const taskMessage = buildGameTaskMessage(plan, planned.lecture, planned.moduleTitle, indexPath);
    try {
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        maxTurns: options.maxPracticeTurns ?? 40,
        model: options.model,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        onCost: makeCostRecorder(lectureState, state)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(lectureState, 'game', 'needs-review', `generation failed: ${message}`);
      writeCourseState(state);
    }
  }

  if (options.skipPracticeReview) {
    if (needsInteractive) lectureState.interactiveReview = 'passed';
    if (needsGame) lectureState.gameReview = 'passed';
    return;
  }

  lectureState.status = 'reviewing';
  writeCourseState(state);

  const interactiveSpec = resolveInteractiveSpec(planned.lecture);
  const gameSpec = resolveGameSpec(planned.lecture);

  if (needsInteractive && lectureState.interactiveReview !== 'passed' && interactiveSpec) {
    console.log(`  Reviewing ${INTERACTIVE_PRACTICE_REL}...`);
    await reviewOnePracticeFile({
      lectureState,
      state,
      folderPath,
      fileName: INTERACTIVE_PRACTICE_REL,
      kind: 'interactive',
      specText: formatInteractiveSpec(interactiveSpec),
      spec: interactiveSpec,
      runOptions: options,
      allowRepair: true
    });
  }

  if (needsGame && lectureState.gameReview !== 'passed' && gameSpec) {
    console.log(`  Reviewing ${GAME_PRACTICE_REL}...`);
    await reviewOnePracticeFile({
      lectureState,
      state,
      folderPath,
      fileName: GAME_PRACTICE_REL,
      kind: 'game',
      specText: formatGameSpec(gameSpec),
      spec: gameSpec,
      runOptions: options,
      allowRepair: true
    });
  }
}

function finalizeLectureStatus(lectureState: LectureState) {
  const practiceFailed =
    (lectureState.formats.includes('interactive') && lectureState.interactiveReview === 'needs-review') ||
    (lectureState.formats.includes('game') && lectureState.gameReview === 'needs-review');
  if (practiceFailed) {
    lectureState.status = 'needs-review';
    lectureState.error = [
      lectureState.interactiveReviewNotes && `interactive: ${lectureState.interactiveReviewNotes}`,
      lectureState.gameReviewNotes && `game: ${lectureState.gameReviewNotes}`
    ].filter(Boolean).join(' | ');
    return;
  }
  lectureState.status = 'done';
  lectureState.error = '';
}

async function runOneLecture(
  plan: CoursePlan,
  state: CourseState,
  lectureState: LectureState,
  options: RunCourseOptions
) {
  const planned = findPlannedLecture(plan, lectureState.slug);
  if (!planned) {
    throw new Error(`Lecture not found in plan: ${lectureState.slug}`);
  }

  const folderName = lectureState.folderName || lectureFolderName(lectureState.order, lectureState.slug);
  const folderPath = lectureFolderPath(plan.slug, folderName);
  const existingIndex = findLatestIndexFile(folderPath);
  const videoAlreadyRendered = Boolean(lectureState.mp4Path && existsSync(lectureState.mp4Path));
  const resolvedReady = hasResolvedHtml(folderPath);

  if (options.renderOnly) {
    if (options.dryRun) {
      console.log(`\n--- ${lectureState.title} (render MP4 only) ---\nFolder: ${folderPath}\n`);
      return;
    }
    if (!resolvedReady) {
      lectureState.status = 'failed';
      lectureState.error = 'No resolved HTML found; run generation/resolve first';
      writeCourseState(state);
      return;
    }
    if (videoAlreadyRendered) {
      console.log('  MP4 already exists; skipping.');
      return;
    }
    const priorStatus = lectureState.status;
    const priorError = lectureState.error;
    lectureState.status = 'rendering';
    writeCourseState(state);
    try {
      const mp4Path = await spawnRenderLecture(folderPath, {
        ttsVoice: options.ttsVoice,
        ttsSpeed: options.ttsSpeed
      });
      lectureState.mp4Path = mp4Path;
      if (priorStatus === 'needs-review') {
        lectureState.status = 'needs-review';
        lectureState.error = priorError;
      } else {
        lectureState.status = 'done';
        lectureState.error = '';
      }
    } catch (error) {
      lectureState.status = 'failed';
      lectureState.error = `Render failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    writeCourseState(state);
    return;
  }

  const renderOnly =
    wantsRender(options) &&
    !options.forceLecture &&
    Boolean(existingIndex) &&
    resolvedReady &&
    !videoAlreadyRendered &&
    lectureState.status !== 'pending' &&
    lectureState.status !== 'generating';

  const skipVideo =
    !renderOnly &&
    !options.forceLecture &&
    Boolean(existingIndex) &&
    (videoAlreadyRendered || (!wantsRender(options) && resolvedReady)) &&
    lectureState.status !== 'generating' &&
    lectureState.status !== 'resolving' &&
    lectureState.status !== 'rendering' &&
    lectureState.status !== 'pending';

  if (options.dryRun) {
    if (!skipVideo) {
      console.log(`\n--- ${lectureState.title} (video) ---\n${buildVideoTaskMessage(plan, planned.lecture, planned.moduleTitle)}\n`);
    }
    if (planned.lecture.formats.includes('interactive')) {
      console.log(`\n--- ${lectureState.title} (interactive) ---\n${buildInteractiveTaskMessage(plan, planned.lecture, planned.moduleTitle, existingIndex || 'index.html')}\n`);
    }
    if (planned.lecture.formats.includes('game')) {
      console.log(`\n--- ${lectureState.title} (game) ---\n${buildGameTaskMessage(plan, planned.lecture, planned.moduleTitle, existingIndex || 'index.html')}\n`);
    }
    return;
  }

  mkdirSync(folderPath, { recursive: true });
  lectureState.folderName = folderName;

  if (options.forceLecture) {
    cleanupVideoArtifactsForRerun(folderPath);
    lectureState.interactiveReview = 'not-required';
    lectureState.interactiveReviewNotes = '';
    lectureState.gameReview = 'not-required';
    lectureState.gameReviewNotes = '';
    lectureState.mp4Path = '';
  }

  let indexPath = options.forceLecture ? null : existingIndex;

  if (renderOnly) {
    lectureState.error = '';
    lectureState.status = 'rendering';
    writeCourseState(state);
    try {
      const mp4Path = await spawnRenderLecture(folderPath, {
        ttsVoice: options.ttsVoice,
        ttsSpeed: options.ttsSpeed
      });
      lectureState.mp4Path = mp4Path;
    } catch (error) {
      lectureState.status = 'failed';
      lectureState.error = `Render failed: ${error instanceof Error ? error.message : String(error)}`;
      writeCourseState(state);
      return;
    }
    indexPath = findLatestIndexFile(folderPath);
    if (!indexPath) {
      lectureState.status = 'failed';
      lectureState.error = 'Video index missing; cannot generate practice assets';
      writeCourseState(state);
      return;
    }
    await runPracticePhase(plan, state, lectureState, planned, folderPath, indexPath, options);
    finalizeLectureStatus(lectureState);
    writeCourseState(state);
    return;
  }

  if (!skipVideo) {
    lectureState.attempts += 1;
    lectureState.error = '';
    lectureState.status = 'generating';
    writeCourseState(state);

    const taskMessage = buildVideoTaskMessage(plan, planned.lecture, planned.moduleTitle);
    try {
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        maxTurns: options.maxTurns ?? 60,
        model: options.model,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        onCost: makeCostRecorder(lectureState, state)
      });
    } catch (error) {
      lectureState.status = 'failed';
      lectureState.error = error instanceof Error ? error.message : String(error);
      writeCourseState(state);
      return;
    }

    indexPath = findIndexFile(folderPath);
    cleanupLegacyTopLevelPracticeFiles(folderPath);
    if (!indexPath) {
      lectureState.status = 'failed';
      lectureState.error = 'No index*.html generated';
      writeCourseState(state);
      return;
    }

    if (!options.skipScriptReview) {
      await runScriptReviewPhase(plan, planned, lectureState, state, folderPath, options);
      indexPath = findIndexFile(folderPath) ?? indexPath;
    }

    lectureState.status = 'resolving';
    writeCourseState(state);
    try {
      await spawnResolve(indexPath, {
        ttsVoice: options.ttsVoice,
        ttsSpeed: options.ttsSpeed
      });
    } catch (error) {
      lectureState.status = 'failed';
      lectureState.error = `Resolve failed: ${error instanceof Error ? error.message : String(error)}`;
      writeCourseState(state);
      return;
    }

    if (wantsRender(options)) {
      lectureState.status = 'rendering';
      writeCourseState(state);
      try {
        const mp4Path = await spawnRenderLecture(folderPath, {
          ttsVoice: options.ttsVoice,
          ttsSpeed: options.ttsSpeed
        });
        lectureState.mp4Path = mp4Path;
      } catch (error) {
        lectureState.status = 'failed';
        lectureState.error = `Render failed: ${error instanceof Error ? error.message : String(error)}`;
        writeCourseState(state);
        return;
      }
    } else {
      console.log('  Skipping MP4 render (pass --render to enable).');
    }
  } else if (!indexPath) {
    lectureState.status = 'failed';
    lectureState.error = 'Video index missing; cannot generate practice assets';
    writeCourseState(state);
    return;
  }

  await runPracticePhase(plan, state, lectureState, planned, folderPath, indexPath, options);

  finalizeLectureStatus(lectureState);
  writeCourseState(state);
}

export async function runCourse(options: RunCourseOptions) {
  const plan = readCoursePlan(options.courseSlug);
  let state: CourseState;
  try {
    state = readCourseState(options.courseSlug);
  } catch {
    state = initialCourseState(plan, options.budgetUsd ?? 5);
    if (!options.dryRun) {
      writeCourseState(state);
    }
  }

  if (options.budgetUsd !== undefined) {
    state.budgetUsd = options.budgetUsd;
  }
  state = syncStateFromPlan(state, plan);
  if (!options.dryRun) {
    writeCourseState(state);
    cleanupCourseLegacyPracticeFiles(plan, state);
  }

  const pending = state.lectures.filter(lecture => shouldRunLecture(lecture, plan, options));
  if (pending.length === 0) {
    if (options.renderOnly) {
      console.log('No lectures ready to render. Each lecture needs resolved HTML and no existing MP4.');
    } else {
      console.log('No lectures to run. Use --retry-failed, --force-lecture <slug>, or resume after needs-review.');
    }
    return state;
  }

  printPlanSummary(plan);
  const actionLabel = options.renderOnly ? 'render' : 'generate';
  console.log(`\nLectures to ${actionLabel}: ${pending.map(l => l.slug).join(', ')}`);
  if (!options.renderOnly) {
    console.log(`Budget: $${state.budgetUsd.toFixed(2)} (spent so far: $${state.spentUsd.toFixed(2)})`);
  }

  if (!options.dryRun) {
    const confirmMessage = options.renderOnly
      ? `Render MP4 for ${pending.length} lecture(s) from existing resolved HTML?`
      : `Start generation for ${pending.length} lecture(s)? Estimated ~$${estimateCourseCostUsd(plan).toFixed(2)}.`;
    const ok = await confirm(confirmMessage, options.yes);
    if (!ok) {
      console.log('Cancelled.');
      return state;
    }
  }

  for (const lectureState of state.lectures) {
    if (!shouldRunLecture(lectureState, plan, options)) continue;

    if (
      !options.renderOnly &&
      lectureState.attempts >= state.maxAttempts &&
      !options.forceLecture &&
      lectureState.status === 'pending'
    ) {
      console.log(`Skipping ${lectureState.slug}: max attempts (${state.maxAttempts}) reached. Use --force-lecture to retry.`);
      continue;
    }

    if (!options.renderOnly && state.spentUsd >= state.budgetUsd && !options.forceLecture) {
      console.log(`Budget cap reached ($${state.budgetUsd.toFixed(2)}). Stopping before ${lectureState.slug}.`);
      break;
    }

    console.log(`\n=== Lecture ${lectureState.order}: ${lectureState.title} ===`);
    await runOneLecture(plan, state, lectureState, options);

    if (!options.renderOnly && state.spentUsd >= state.budgetUsd && lectureState.status !== 'done') {
      console.log(`Budget cap reached after ${lectureState.slug}.`);
      break;
    }
  }

  const done = state.lectures.filter(l => l.status === 'done').length;
  const failed = state.lectures.filter(l => l.status === 'failed').length;
  const needsReview = state.lectures.filter(l => l.status === 'needs-review').length;
  const summary = options.renderOnly
    ? `\nRender complete: ${done} done, ${failed} failed, ${needsReview} needs-review`
    : `\nRun complete: ${done} done, ${failed} failed, ${needsReview} needs-review, spent ~$${state.spentUsd.toFixed(2)} / $${state.budgetUsd.toFixed(2)}`;
  console.log(summary);
  console.log(`Course folder: ${getCourseDir(options.courseSlug)}`);
  return state;
}

export function printCourseStatus(courseSlug: string) {
  const plan = readCoursePlan(courseSlug);
  const state = readCourseState(courseSlug);
  printPlanSummary(plan);
  console.log('\nLecture status:');
  for (const lecture of state.lectures) {
    const reviews: string[] = [];
    if (lecture.formats.includes('interactive') && lecture.interactiveReview !== 'not-required') {
      reviews.push(`interactive=${lecture.interactiveReview}`);
    }
    if (lecture.formats.includes('game') && lecture.gameReview !== 'not-required') {
      reviews.push(`game=${lecture.gameReview}`);
    }
    const reviewSuffix = reviews.length > 0 ? ` [${reviews.join(', ')}]` : '';
    console.log(`  [${lecture.status}] ${lecture.order}. ${lecture.title} (attempts=${lecture.attempts}, cost=$${lecture.costUsd.toFixed(2)})${reviewSuffix}`);
    if (lecture.error) console.log(`    error: ${lecture.error.split('\n')[0]}`);
    if (lecture.interactiveReviewNotes) console.log(`    interactive QA: ${lecture.interactiveReviewNotes.split(';')[0]}`);
    if (lecture.gameReviewNotes) console.log(`    game QA: ${lecture.gameReviewNotes.split(';')[0]}`);
    if (lecture.mp4Path && existsSync(lecture.mp4Path)) console.log(`    mp4: ${lecture.mp4Path}`);
  }
  console.log(`\nSpent: $${state.spentUsd.toFixed(2)} / $${state.budgetUsd.toFixed(2)}`);
}
