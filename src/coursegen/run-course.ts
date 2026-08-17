import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { CoursePlan, CourseState, LectureState } from './types.ts';
import {
  getCourseDir,
  isIndexHtmlName,
  isResolvedHtmlName,
  lectureFolderName,
  lectureFolderPath,
  resolvedSiblingPathForIndex
} from './paths.ts';
import {
  buildVideoGenerationSettings,
  buildVideoTaskMessage,
  estimateCourseCostUsd,
  loadLectureGrounding,
  printPlanSummary,
  type LectureGrounding
} from './lecture-prompt.ts';
import { readCoursePlan, readCourseState, writeCourseState } from './state.ts';
import { DEFAULT_LEARNING_INTENT, flattenPlanLectures, initialCourseState } from './types.ts';
import {
  parseCostUsdFromOutput,
  spawnAgent,
  spawnRenderLecture,
  spawnResolve,
  type LectureGenSpawnSettings
} from './spawn.ts';
import { confirm } from './confirm.ts';

export type RunCourseOptions = {
  courseSlug: string;
  yes?: boolean;
  budgetUsd?: number;
  lectureTimeoutMinutes?: number;
  retryFailed?: boolean;
  forceLecture?: string;
  ttsProvider?: string;
  ttsVoice?: string;
  ttsSpeed?: string;
  model?: string;
  dryRun?: boolean;
  /** When true, mux resolved HTML to MP4 after resolve. Default: false (resolve-only). */
  render?: boolean;
  /** When true, only mux existing resolved HTML to MP4 — no generation or resolve. */
  renderOnly?: boolean;
};

function makeCostRecorder(lectureState: LectureState, state: CourseState) {
  return (costUsd: number) => {
    lectureState.costUsd = Number((lectureState.costUsd + costUsd).toFixed(4));
    state.spentUsd = Number((state.spentUsd + costUsd).toFixed(4));
  };
}

export function syncStateFromPlan(state: CourseState, plan: CoursePlan) {
  const rows = flattenPlanLectures(plan);
  const bySlug = new Map(state.lectures.map(lecture => [lecture.slug, lecture]));
  state.lectures = rows.map(row => {
    const existing = bySlug.get(row.slug);
    if (existing) {
      const synced = {
        ...existing,
        title: row.title,
        module: row.module,
        order: row.order,
        objective: row.objective,
        durationMinutes: row.durationMinutes,
        formats: row.formats
      };
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
      mp4Path: ''
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
    lecture.status === 'rendering'
  ) {
    return true;
  }
  if (lecture.status === 'done' && wantsRender(options) && lecture.formats.includes('video')) {
    if (!lecture.mp4Path || !existsSync(lecture.mp4Path)) return true;
  }
  return lecture.status === 'pending';
}

function findIndexFile(folderPath: string) {
  return findLatestIndexFile(folderPath);
}

function cleanupLectureArtifactsForRerun(folderPath: string) {
  if (!existsSync(folderPath)) return;
  for (const entry of readdirSync(folderPath, { withFileTypes: true })) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'audio' || entry.name === 'activities') {
        rmSync(entryPath, { recursive: true, force: true });
      }
      continue;
    }
    if (
      isIndexHtmlName(entry.name) ||
      isResolvedHtmlName(entry.name) ||
      entry.name.toLowerCase() === 'interactive.html' ||
      entry.name.toLowerCase() === 'game.html' ||
      entry.name.toLowerCase().endsWith('.mp4')
    ) {
      rmSync(entryPath, { force: true });
    }
  }
}

async function runAgentTask(options: {
  workspaceDir: string;
  taskMessage: string;
  model?: string;
  ttsProvider?: string;
  ttsVoice?: string;
  ttsSpeed?: string;
  timeoutMinutes: number;
  onCost: (costUsd: number) => void;
  /** Typed LectureGen settings (generation length, aspect, theme, teaching style). */
  settings?: LectureGenSpawnSettings;
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
      model: options.model,
      ttsProvider: options.ttsProvider,
      ttsVoice: options.ttsVoice,
      ttsSpeed: options.ttsSpeed,
      settings: options.settings,
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

function finalizeLectureStatus(lectureState: LectureState) {
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
        ttsProvider: options.ttsProvider,
        ttsVoice: options.ttsVoice,
        ttsSpeed: options.ttsSpeed
      });
      lectureState.mp4Path = mp4Path;
      lectureState.status = priorStatus === 'failed' ? 'failed' : 'done';
      lectureState.error = priorStatus === 'failed' ? priorError : '';
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

  let grounding: LectureGrounding | null = null;
  const needsGrounding = options.dryRun ? !skipVideo : !skipVideo && !renderOnly;
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
    if (!skipVideo) {
      console.log(`\n--- ${lectureState.title} (${planned.lecture.formats.join(', ')}) ---\n${buildVideoTaskMessage(plan, planned.lecture, planned.moduleTitle, grounding?.block)}\n`);
    }
    return;
  }

  mkdirSync(folderPath, { recursive: true });
  lectureState.folderName = folderName;

  if (options.forceLecture) {
    cleanupLectureArtifactsForRerun(folderPath);
    lectureState.mp4Path = '';
  }

  let indexPath = options.forceLecture ? null : existingIndex;

  if (renderOnly) {
    lectureState.error = '';
    lectureState.status = 'rendering';
    writeCourseState(state);
    try {
      const mp4Path = await spawnRenderLecture(folderPath, {
        ttsProvider: options.ttsProvider,
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
      lectureState.error = 'Video index missing after render';
      writeCourseState(state);
      return;
    }
    finalizeLectureStatus(lectureState);
    writeCourseState(state);
    return;
  }

  if (!skipVideo) {
    lectureState.attempts += 1;
    lectureState.error = '';
    lectureState.status = 'generating';
    writeCourseState(state);

    const taskMessage = buildVideoTaskMessage(plan, planned.lecture, planned.moduleTitle, grounding?.block);
    const settings = buildVideoGenerationSettings(plan, planned.lecture);
    try {
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        model: options.model,
        ttsProvider: options.ttsProvider,
        ttsVoice: options.ttsVoice,
        ttsSpeed: options.ttsSpeed,
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        onCost: makeCostRecorder(lectureState, state),
        settings
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

    lectureState.status = 'resolving';
    writeCourseState(state);
    try {
      await spawnResolve(indexPath, {
        ttsProvider: options.ttsProvider,
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
          ttsProvider: options.ttsProvider,
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
    lectureState.error = 'Video index missing after lecture generation';
    writeCourseState(state);
    return;
  }

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
      console.log('No lectures to run. Use --retry-failed or --force-lecture <slug>.');
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
  const summary = options.renderOnly
    ? `\nRender complete: ${done} done, ${failed} failed`
    : `\nRun complete: ${done} done, ${failed} failed, spent ~$${state.spentUsd.toFixed(2)} / $${state.budgetUsd.toFixed(2)}`;
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
    console.log(`  [${lecture.status}] ${lecture.order}. ${lecture.title} (attempts=${lecture.attempts}, cost=$${lecture.costUsd.toFixed(2)})`);
    if (lecture.error) console.log(`    error: ${lecture.error.split('\n')[0]}`);
    if (lecture.mp4Path && existsSync(lecture.mp4Path)) console.log(`    mp4: ${lecture.mp4Path}`);
  }
  console.log(`\nSpent: $${state.spentUsd.toFixed(2)} / $${state.budgetUsd.toFixed(2)}`);
}
