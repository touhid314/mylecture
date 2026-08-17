import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
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
  buildHtmlEditTaskMessage,
  buildInteractiveTaskMessage,
  buildPracticeRepairMessage,
  buildVideoGenerationSettings,
  buildVideoTaskMessage,
  type HtmlEditTarget,
  estimateCourseCostUsd,
  formatLectureSequenceContext,
  formatGameSpec,
  formatInteractiveSpec,
  loadLectureGrounding,
  GAME_PRACTICE_REL,
  INTERACTIVE_PRACTICE_REL,
  printPlanSummary,
  type LectureGrounding,
  type PracticeHtmlRelPath
} from './lecture-prompt.ts';
import { readCoursePlan, readCourseState, writeCourseState } from './state.ts';
import { DEFAULT_LEARNING_INTENT, flattenPlanLectures, initialCourseState, resolveGameSpec, resolveInteractiveSpec } from './types.ts';
import {
  lectureUsageFileExists,
  lectureUsagePath,
  parseCostUsdFromOutput,
  readLectureUsageCostUsd,
  resolveLectureCostUsd,
  spawnAgent,
  spawnEditorAgent,
  spawnRenderLecture,
  spawnResolve,
  type LectureGenSpawnSettings
} from './spawn.ts';
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
  /** When true, regenerate interactive/game only — keep video artifacts. */
  practiceOnly?: boolean;
  /** When true, keep existing practice HTML and run QA + one IAGen/GameGen repair. */
  practiceRepair?: boolean;
  /** Edit existing HTML via EditorAgent (requires forceLecture). */
  editTarget?: HtmlEditTarget;
  editPrompt?: string;
};

type PracticeKind = 'interactive' | 'game';

const INTERACTIVE_ROOT = 'interactive.html';
const GAME_ROOT = 'game.html';
const PRACTICE_OUTPUT_FILES = [
  INTERACTIVE_PRACTICE_REL,
  GAME_PRACTICE_REL,
  INTERACTIVE_ROOT,
  GAME_ROOT
] as const;

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

function recalculateCourseSpentUsd(state: CourseState) {
  state.spentUsd = Number(state.lectures.reduce((sum, lecture) => sum + lecture.costUsd, 0).toFixed(4));
}

function applyLectureCostFromUsage(
  lectureState: LectureState,
  state: CourseState,
  folderPath: string,
  stdoutFallback?: string
) {
  lectureState.costUsd = resolveLectureCostUsd({
    jsonlExists: lectureUsageFileExists(folderPath),
    jsonlCost: readLectureUsageCostUsd(folderPath),
    stdoutCost: parseCostUsdFromOutput(stdoutFallback || ''),
    previousCost: lectureState.costUsd
  });
  recalculateCourseSpentUsd(state);
}

async function withLectureTokenTrackerEnv<T>(folderPath: string, fn: () => Promise<T>): Promise<T> {
  const prevSessionId = process.env.TOKEN_TRACKER_SESSION_ID;
  const prevUsagePath = process.env.TOKEN_TRACKER_USAGE_PATH;
  process.env.TOKEN_TRACKER_SESSION_ID = path.basename(folderPath);
  process.env.TOKEN_TRACKER_USAGE_PATH = lectureUsagePath(folderPath);
  try {
    return await fn();
  } finally {
    if (prevSessionId === undefined) {
      delete process.env.TOKEN_TRACKER_SESSION_ID;
    } else {
      process.env.TOKEN_TRACKER_SESSION_ID = prevSessionId;
    }
    if (prevUsagePath === undefined) {
      delete process.env.TOKEN_TRACKER_USAGE_PATH;
    } else {
      process.env.TOKEN_TRACKER_USAGE_PATH = prevUsagePath;
    }
  }
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

export function hasEditOptions(options: RunCourseOptions) {
  return Boolean(options.editTarget && options.editPrompt?.trim());
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
  const indexFiles = readdirSync(folderPath).filter(name => isIndexHtmlName(name));
  if (indexFiles.length === 0) return false;
  return indexFiles.every(name =>
    existsSync(resolvedSiblingPathForIndex(path.join(folderPath, name)))
  );
}

export type VideoResumeKind = 'generate' | 'resolve-only' | 'skip-to-render';

export function videoResumeKind(params: {
  existingIndex: boolean;
  forceLecture: boolean;
  resolvedReady: boolean;
}): VideoResumeKind {
  if (!params.existingIndex || params.forceLecture) {
    return 'generate';
  }
  if (!params.resolvedReady) {
    return 'resolve-only';
  }
  return 'skip-to-render';
}

export function lectureRenderReady(plan: CoursePlan, lecture: LectureState) {
  if (!lecture.formats.includes('video')) return false;
  const folderName = lecture.folderName || lectureFolderName(lecture.order, lecture.slug);
  const folderPath = lectureFolderPath(plan.slug, folderName);
  if (!hasResolvedHtml(folderPath)) return false;
  return !(lecture.mp4Path && existsSync(lecture.mp4Path));
}

export function lectureHasPractice(lecture: Pick<LectureState, 'formats'>) {
  return lecture.formats.includes('interactive') || lecture.formats.includes('game');
}

export function shouldRunLecture(lecture: LectureState, plan: CoursePlan, options: RunCourseOptions) {
  if (hasEditOptions(options)) {
    return Boolean(options.forceLecture) && options.forceLecture === lecture.slug;
  }
  if (options.practiceOnly || options.practiceRepair) {
    if (!lectureHasPractice(lecture)) return false;
    if (options.forceLecture) return options.forceLecture === lecture.slug;
    if (options.retryFailed) {
      return lecture.status === 'needs-review' || lecture.status === 'failed';
    }
    return false;
  }
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

function deletePracticeOutputs(folderPath: string) {
  for (const rel of PRACTICE_OUTPUT_FILES) {
    const filePath = path.join(folderPath, rel);
    if (existsSync(filePath)) rmSync(filePath, { force: true });
  }
}

function practiceRootRelPath(kind: PracticeKind): typeof INTERACTIVE_ROOT | typeof GAME_ROOT {
  return kind === 'interactive' ? INTERACTIVE_ROOT : GAME_ROOT;
}

function practiceSidecarRelPath(kind: PracticeKind): PracticeHtmlRelPath {
  return kind === 'interactive' ? INTERACTIVE_PRACTICE_REL : GAME_PRACTICE_REL;
}

function practiceRootPath(folderPath: string, kind: PracticeKind) {
  return path.join(folderPath, practiceRootRelPath(kind));
}

function practiceSidecarPath(folderPath: string, kind: PracticeKind) {
  return path.join(folderPath, practiceSidecarRelPath(kind));
}

function practiceOutputExists(folderPath: string, kind: PracticeKind) {
  return existsSync(practiceSidecarPath(folderPath, kind)) || existsSync(practiceRootPath(folderPath, kind));
}

function copyPracticeSidecarToRoot(folderPath: string, kind: PracticeKind) {
  const rootPath = practiceRootPath(folderPath, kind);
  const sidecarPath = practiceSidecarPath(folderPath, kind);
  if (existsSync(rootPath)) return true;
  if (!existsSync(sidecarPath)) return false;
  copyFileSync(sidecarPath, rootPath);
  return true;
}

function copyPracticeRootToSidecar(folderPath: string, kind: PracticeKind, options?: { required?: boolean }) {
  const rootPath = practiceRootPath(folderPath, kind);
  const sidecarPath = practiceSidecarPath(folderPath, kind);
  if (!existsSync(rootPath)) {
    if (options?.required) {
      throw new Error(`${practiceRootRelPath(kind)} missing after task succeeded`);
    }
    if (existsSync(sidecarPath)) return true;
    return false;
  }
  mkdirSync(path.dirname(sidecarPath), { recursive: true });
  copyFileSync(rootPath, sidecarPath);
  return true;
}

function practiceReferencePath(folderPath: string, kind: PracticeKind, forRepair: boolean) {
  if (forRepair) {
    const rootPath = practiceRootPath(folderPath, kind);
    if (existsSync(rootPath)) return rootPath;
    const sidecarPath = practiceSidecarPath(folderPath, kind);
    if (existsSync(sidecarPath)) return sidecarPath;
    return undefined;
  }
  const scriptPath = path.join(folderPath, 'script.md');
  return existsSync(scriptPath) ? scriptPath : undefined;
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
  lectureState: LectureState;
  state: CourseState;
  /** LectureGen for new videos; EditorAgent for index edits (script repair). */
  mode?: 'generate' | 'edit';
  ttsVoice?: string;
  ttsSpeed?: string;
  /** Typed LectureGen settings (generation length, aspect, theme, teaching style). */
  settings?: LectureGenSpawnSettings;
  referencePath?: string;
}) {
  const timeoutMs = options.timeoutMinutes * 60 * 1000;
  let killAgent: (() => void) | null = null;
  const timeout = setTimeout(() => {
    killAgent?.();
  }, timeoutMs);

  let agentOutput = '';
  let taskError: unknown;
  try {
    const spawn = options.mode === 'edit' ? spawnEditorAgent : spawnAgent;
    const { promise, kill } = spawn({
      workspaceDir: options.workspaceDir,
      taskMessage: options.taskMessage,
      maxTurns: options.maxTurns,
      model: options.model,
      settings: options.settings,
      referencePath: options.referencePath,
      ttsVoice: options.ttsVoice,
      ttsSpeed: options.ttsSpeed,
      onStdout: chunk => { agentOutput += chunk; },
      onStderr: chunk => { agentOutput += chunk; }
    });
    killAgent = kill;
    await promise;
  } catch (error) {
    taskError = error;
  } finally {
    clearTimeout(timeout);
    killAgent = null;
    applyLectureCostFromUsage(options.lectureState, options.state, options.workspaceDir, agentOutput);
    writeCourseState(options.state);
  }
  if (taskError) throw taskError;
  return agentOutput;
}

async function runPracticeLectureGenTask(options: {
  kind: PracticeKind;
  workspaceDir: string;
  taskMessage: string;
  model?: string;
  timeoutMinutes: number;
  lectureState: LectureState;
  state: CourseState;
  referencePath?: string;
}) {
  const settings: LectureGenSpawnSettings = {
    skipVideo: true,
    skipResolve: true,
    aspectRatio: '16:9',
    ...(options.kind === 'interactive' ? { includeInteractive: true } : { includeGame: true })
  };
  await runAgentTask({
    workspaceDir: options.workspaceDir,
    taskMessage: options.taskMessage,
    maxTurns: 1,
    model: options.model,
    timeoutMinutes: options.timeoutMinutes,
    lectureState: options.lectureState,
    state: options.state,
    settings,
    referencePath: options.referencePath
  });
  if (!copyPracticeRootToSidecar(options.workspaceDir, options.kind, { required: true })) {
    throw new Error(`${practiceRootRelPath(options.kind)} missing after LectureGen task succeeded`);
  }
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
      result = await withLectureTokenTrackerEnv(options.folderPath, () => reviewPracticeWithRubric({
        objective: options.lectureState.objective,
        htmlPath,
        kind: options.kind,
        spec: options.spec,
        screenshotDir,
        model: options.runOptions.model
      }));
      applyLectureCostFromUsage(options.lectureState, options.state, options.folderPath);
      writeCourseState(options.state);
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
        // Prompt-edits of interactive.html/game.html use EditorAgent in runEditPhase; repair here uses LectureGen.
        await runPracticeLectureGenTask({
          kind: options.kind,
          workspaceDir: options.folderPath,
          taskMessage: repairMessage,
          model: options.runOptions.model,
          timeoutMinutes: options.runOptions.lectureTimeoutMinutes ?? 20,
          lectureState: options.lectureState,
          state: options.state,
          referencePath: practiceReferencePath(options.folderPath, options.kind, true)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPracticeReview(options.lectureState, options.kind, 'needs-review', `generation failed: ${message}`);
        writeCourseState(options.state);
        return 'needs-review';
      }

      cleanupScreenshotDir(screenshotDir);
      try {
        result = await withLectureTokenTrackerEnv(options.folderPath, () => reviewPracticeWithRubric({
          objective: options.lectureState.objective,
          htmlPath,
          kind: options.kind,
          spec: options.spec,
          screenshotDir,
          model: options.runOptions.model
        }));
        applyLectureCostFromUsage(options.lectureState, options.state, options.folderPath);
        writeCourseState(options.state);
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
  options: RunCourseOptions,
  grounding: LectureGrounding | null
) {
  const reviewOptions = {
    folderPath,
    objective: lectureState.objective,
    audience: plan.audience,
    intent: plan.intent ?? DEFAULT_LEARNING_INTENT,
    durationMinutes: planned.lecture.durationMinutes,
    courseContext: formatLectureSequenceContext(plan, planned.lecture),
    sourceContext: grounding?.reviewContext,
    model: options.model
  };

  console.log('  Reviewing narration script...');
  let result: ScriptReviewResult;
  try {
    result = await withLectureTokenTrackerEnv(folderPath, () => reviewScriptWithRubric(reviewOptions));
    applyLectureCostFromUsage(lectureState, state, folderPath);
    writeCourseState(state);
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
        findings: result.findings,
        grounded: Boolean(grounding)
      }),
      maxTurns: options.maxTurns ?? 60,
      model: options.model,
      timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
      lectureState,
      state,
      mode: 'edit'
    });
    writeCourseState(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Narration revision failed: ${message}. Continuing with original narration.`);
    return;
  }

  try {
    result = await withLectureTokenTrackerEnv(folderPath, () => reviewScriptWithRubric(reviewOptions));
    applyLectureCostFromUsage(lectureState, state, folderPath);
    writeCourseState(state);
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

async function runEditPhase(
  state: CourseState,
  lectureState: LectureState,
  folderPath: string,
  options: RunCourseOptions
) {
  const target = options.editTarget!;
  const prompt = options.editPrompt!.trim();
  const taskMessage = buildHtmlEditTaskMessage({
    target,
    prompt,
    objective: lectureState.objective,
    title: lectureState.title
  });

  lectureState.error = '';
  lectureState.status = target === 'video' ? 'generating' : 'generating-practice';
  writeCourseState(state);

  try {
    if (target === 'video') {
      const indexPath = findLatestIndexFile(folderPath);
      if (!indexPath) {
        throw new Error('No index*.html found to edit');
      }
      console.log(`  Editing video HTML via EditorAgent (${path.basename(indexPath)})...`);
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        maxTurns: options.maxTurns ?? 60,
        model: options.model,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        lectureState,
        state,
        mode: 'edit'
      });
      const updatedIndex = findLatestIndexFile(folderPath);
      if (!updatedIndex) {
        throw new Error('Video index missing after edit');
      }
      lectureState.status = 'resolving';
      writeCourseState(state);
      console.log('  Re-resolving after video edit...');
      await spawnResolve(updatedIndex, {
        ttsVoice: options.ttsVoice,
        ttsSpeed: options.ttsSpeed
      });
      lectureState.mp4Path = '';
      if (wantsRender(options)) {
        lectureState.status = 'rendering';
        writeCourseState(state);
        const mp4Path = await spawnRenderLecture(folderPath, {
          ttsVoice: options.ttsVoice,
          ttsSpeed: options.ttsSpeed,
          skipCaptions: true
        });
        lectureState.mp4Path = mp4Path;
      } else {
        console.log('  Skipping MP4 render (pass --render to enable).');
      }
    } else {
      const kind = target as PracticeKind;
      if (!copyPracticeSidecarToRoot(folderPath, kind)) {
        throw new Error(
          `No ${practiceRootRelPath(kind)} or ${practiceSidecarRelPath(kind)} found to edit`
        );
      }
      console.log(`  Editing ${practiceRootRelPath(kind)} via EditorAgent...`);
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        maxTurns: options.maxTurns ?? 60,
        model: options.model,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        lectureState,
        state,
        mode: 'edit'
      });
      if (!copyPracticeRootToSidecar(folderPath, kind, { required: true })) {
        throw new Error(`${practiceRootRelPath(kind)} missing after edit`);
      }
      setPracticeReview(lectureState, kind, 'passed', '');
    }
  } catch (error) {
    lectureState.status = 'failed';
    lectureState.error = error instanceof Error ? error.message : String(error);
    writeCourseState(state);
    return;
  }

  finalizeLectureStatus(lectureState);
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

  lectureState.status = 'generating-practice';
  writeCourseState(state);

  const interactivePath = practiceSidecarPath(folderPath, 'interactive');
  const gamePath = practiceSidecarPath(folderPath, 'game');
  const regenAll = options.practiceRepair
    ? false
    : Boolean(options.forceLecture) || Boolean(options.practiceOnly);

  if (needsInteractive && (regenAll || !practiceOutputExists(folderPath, 'interactive'))) {
    console.log(`  Generating ${INTERACTIVE_PRACTICE_REL} via IAGen...`);
    const taskMessage = buildInteractiveTaskMessage(plan, planned.lecture, planned.moduleTitle, indexPath);
    try {
      await runPracticeLectureGenTask({
        kind: 'interactive',
        workspaceDir: folderPath,
        taskMessage,
        model: options.model,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        lectureState,
        state,
        referencePath: practiceReferencePath(folderPath, 'interactive', false)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(lectureState, 'interactive', 'needs-review', `generation failed: ${message}`);
      writeCourseState(state);
    }
  }

  if (needsGame && (regenAll || !practiceOutputExists(folderPath, 'game'))) {
    console.log(`  Generating ${GAME_PRACTICE_REL} via GameGen...`);
    const taskMessage = buildGameTaskMessage(plan, planned.lecture, planned.moduleTitle, indexPath);
    try {
      await runPracticeLectureGenTask({
        kind: 'game',
        workspaceDir: folderPath,
        taskMessage,
        model: options.model,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        lectureState,
        state,
        referencePath: practiceReferencePath(folderPath, 'game', false)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(lectureState, 'game', 'needs-review', `generation failed: ${message}`);
      writeCourseState(state);
    }
  }

  if (needsInteractive) copyPracticeRootToSidecar(folderPath, 'interactive');
  if (needsGame) copyPracticeRootToSidecar(folderPath, 'game');

  if (options.skipPracticeReview) {
    if (
      needsInteractive
      && lectureState.interactiveReview !== 'needs-review'
      && practiceOutputExists(folderPath, 'interactive')
    ) {
      lectureState.interactiveReview = 'passed';
    }
    if (
      needsGame
      && lectureState.gameReview !== 'needs-review'
      && practiceOutputExists(folderPath, 'game')
    ) {
      lectureState.gameReview = 'passed';
    }
    return;
  }

  lectureState.status = 'reviewing';
  writeCourseState(state);

  const interactiveSpec = resolveInteractiveSpec(planned.lecture);
  const gameSpec = resolveGameSpec(planned.lecture);

  const interactiveGenerationFailed = (lectureState.interactiveReviewNotes ?? '').startsWith('generation failed');
  const gameGenerationFailed = (lectureState.gameReviewNotes ?? '').startsWith('generation failed');

  if (needsInteractive && lectureState.interactiveReview !== 'passed' && interactiveSpec && !interactiveGenerationFailed) {
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

  if (needsGame && lectureState.gameReview !== 'passed' && gameSpec && !gameGenerationFailed) {
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
  const resumeKind = videoResumeKind({
    existingIndex: Boolean(existingIndex),
    forceLecture: Boolean(options.forceLecture),
    resolvedReady
  });
  const resolveOnlyResume = resumeKind === 'resolve-only';
  const skipToRender = resumeKind === 'skip-to-render';

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
    options.practiceOnly ||
    options.practiceRepair ||
    (!renderOnly &&
      !options.forceLecture &&
      Boolean(existingIndex) &&
      (videoAlreadyRendered || (!wantsRender(options) && resolvedReady)) &&
      lectureState.status !== 'generating' &&
      lectureState.status !== 'resolving' &&
      lectureState.status !== 'rendering' &&
      lectureState.status !== 'pending');

  let grounding: LectureGrounding | null = null;
  const needsGrounding = options.dryRun
    ? !skipVideo && !resolveOnlyResume && !skipToRender
    : !skipVideo && !renderOnly && !resolveOnlyResume && !skipToRender;
  if (needsGrounding) {
    try {
      grounding = loadLectureGrounding(plan, planned.lecture);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.dryRun) {
        throw error;
      }
      lectureState.status = 'failed';
      lectureState.error = message;
      writeCourseState(state);
      console.error(`  ${lectureState.title}: ${message}`);
      return;
    }
  }

  if (options.dryRun) {
    if (hasEditOptions(options)) {
      console.log(
        `\n--- ${lectureState.title} (edit ${options.editTarget}) ---\n${buildHtmlEditTaskMessage({
          target: options.editTarget!,
          prompt: options.editPrompt!,
          objective: lectureState.objective,
          title: lectureState.title
        })}\n`
      );
      return;
    }
    if (skipToRender) {
      console.log(`\n--- ${lectureState.title} (resume: skip to render/practice) ---\nFolder: ${folderPath}\n`);
    } else if (resolveOnlyResume) {
      console.log(`\n--- ${lectureState.title} (resolve-only resume) ---\nFolder: ${folderPath}\n`);
    } else if (!skipVideo) {
      console.log(`\n--- ${lectureState.title} (video) ---\n${buildVideoTaskMessage(plan, planned.lecture, planned.moduleTitle, grounding?.block)}\n`);
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

  if (options.practiceOnly || options.practiceRepair) {
    if (!existingIndex) {
      lectureState.status = 'failed';
      lectureState.error = 'Video index missing; cannot regenerate practice assets';
      writeCourseState(state);
      return;
    }
    lectureState.error = '';
    lectureState.interactiveReview = 'not-required';
    lectureState.interactiveReviewNotes = '';
    lectureState.gameReview = 'not-required';
    lectureState.gameReviewNotes = '';
    if (options.practiceOnly) {
      deletePracticeOutputs(folderPath);
    } else {
      console.log('  Repairing existing practice pages (keeping current HTML)...');
    }
    await runPracticePhase(plan, state, lectureState, planned, folderPath, existingIndex, options);
    finalizeLectureStatus(lectureState);
    writeCourseState(state);
    return;
  }

  if (hasEditOptions(options)) {
    await runEditPhase(state, lectureState, folderPath, options);
    if (lectureState.status === 'failed') {
      writeCourseState(state);
      return;
    }
    writeCourseState(state);
    return;
  }

  if (options.forceLecture) {
    cleanupVideoArtifactsForRerun(folderPath);
    deletePracticeOutputs(folderPath);
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

  if (skipToRender) {
    lectureState.error = '';
    indexPath = existingIndex;
    if (wantsRender(options) && !videoAlreadyRendered) {
      lectureState.status = 'rendering';
      writeCourseState(state);
      try {
        const mp4Path = await spawnRenderLecture(folderPath, {
          ttsVoice: options.ttsVoice,
          ttsSpeed: options.ttsSpeed,
          skipCaptions: true
        });
        lectureState.mp4Path = mp4Path;
      } catch (error) {
        lectureState.status = 'failed';
        lectureState.error = `Render failed: ${error instanceof Error ? error.message : String(error)}`;
        writeCourseState(state);
        return;
      }
    } else if (!wantsRender(options)) {
      console.log('  Skipping MP4 render (pass --render to enable).');
    }
  } else if (!skipVideo) {
    lectureState.attempts += 1;
    lectureState.error = '';

    if (resolveOnlyResume) {
      console.log('  Resuming resolve from existing index HTML (skipping generation).');
      indexPath = existingIndex;
    } else {
      lectureState.status = 'generating';
      writeCourseState(state);

      const taskMessage = buildVideoTaskMessage(plan, planned.lecture, planned.moduleTitle, grounding?.block);
      const settings = {
        ...buildVideoGenerationSettings(plan, planned.lecture),
        skipResolve: true
      };
      try {
        await runAgentTask({
          workspaceDir: folderPath,
          taskMessage,
          maxTurns: options.maxTurns ?? 60,
          model: options.model,
          timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
          lectureState,
          state,
          settings,
          ttsVoice: options.ttsVoice,
          ttsSpeed: options.ttsSpeed
        });
      } catch (error) {
        lectureState.status = 'failed';
        lectureState.error = error instanceof Error ? error.message : String(error);
        writeCourseState(state);
        return;
      }

      indexPath = findIndexFile(folderPath);
      if (!indexPath) {
        lectureState.status = 'failed';
        lectureState.error = 'No index*.html generated';
        writeCourseState(state);
        return;
      }

      if (!options.skipScriptReview) {
        await runScriptReviewPhase(plan, planned, lectureState, state, folderPath, options, grounding);
        indexPath = findIndexFile(folderPath) ?? indexPath;
      }
    }

    if (!indexPath) {
      lectureState.status = 'failed';
      lectureState.error = 'Video index missing; cannot resolve';
      writeCourseState(state);
      return;
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
          ttsSpeed: options.ttsSpeed,
          skipCaptions: true
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
  }

  const pending = state.lectures.filter(lecture => shouldRunLecture(lecture, plan, options));
  if (pending.length === 0) {
    if (options.renderOnly) {
      console.log('No lectures ready to render. Each lecture needs resolved HTML and no existing MP4.');
    } else {
      console.log('No lectures to run. Use --retry-failed, --retry-practice, --repair-practice, --force-lecture <slug>, or resume after needs-review.');
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
      : hasEditOptions(options)
        ? `Edit existing HTML for ${pending.length} lecture(s) via EditorAgent (no full regeneration)?`
        : options.practiceRepair
        ? `Repair existing practice for ${pending.length} lecture(s)? Current HTML is kept; QA + one edit pass.`
        : options.practiceOnly
        ? `Regenerate practice (interactive/game) for ${pending.length} lecture(s)? Video files stay in place.`
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
      !options.practiceOnly &&
      !options.practiceRepair &&
      !hasEditOptions(options) &&
      lectureState.status === 'pending'
    ) {
      console.log(`Skipping ${lectureState.slug}: max attempts (${state.maxAttempts}) reached. Use --force-lecture to retry.`);
      continue;
    }

    if (!options.renderOnly && state.spentUsd >= state.budgetUsd && !options.forceLecture && !options.practiceOnly && !options.practiceRepair && !hasEditOptions(options)) {
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
