import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  estimateLecturesCostUsd,
  formatLectureSequenceContext,
  formatAdaptiveSkillContext,
  formatGameSpec,
  formatInteractiveSpec,
  GAME_PRACTICE_REL,
  GAME_STAGE_REL,
  INTERACTIVE_PRACTICE_REL,
  INTERACTIVE_STAGE_REL,
  defaultMaxPracticeRepairTurns,
  defaultMaxPracticeTurns,
  printPlanSummary,
  type PracticeHtmlRelPath
} from './lecture-prompt.ts';
import {
  assembleActivityHtml,
  buildActivityShellConfig,
  stageCssRelForKind,
  stageRelForKind,
  validateStageJs
} from './activity-shell/assemble.ts';
import { buildStageJsScaffold, shouldWriteStageScaffold } from './activity-shell/stage-scaffold.ts';
import { readCoursePlan, readCourseState, writeCourseState } from './state.ts';
import { DEFAULT_LEARNING_INTENT, flattenPlanLectures, initialCourseState, resolveGameSpec, resolveInteractiveSpec } from './types.ts';
import { parseCostUsdFromOutput, spawnAgent, spawnRenderLecture, spawnResolve } from './spawn.ts';

const ADAPTIVE_VIDEO_SKILL = ['adaptive-micro-lesson'] as const;
import { confirm } from './confirm.ts';
import { filterRepairableFindings, isQaInfrastructureFinding, joinReviewNotes, singleLineNote, splitStoredReviewNotes } from './review-notes.ts';
import { LARGE_PRACTICE_FILE_LINES, countPracticeFileLines } from './practice-repair-context.ts';
import { cleanupScreenshotDir, reviewPracticeWithRubric, type RubricResult } from './review-practice.ts';
import { buildScriptRepairMessage, reviewScriptWithRubric, type ScriptReviewResult } from './review-script.ts';
import {
  buildVideoFrameRepairMessage,
  collectVideoFrameFindings,
  MAX_VIDEO_FRAME_FINDINGS
} from './video-frame-qa.ts';

export type RunCourseOptions = {
  courseSlug: string;
  yes?: boolean;
  budgetUsd?: number;
  maxTurns?: number;
  maxPracticeTurns?: number;
  lectureTimeoutMinutes?: number;
  retryFailed?: boolean;
  forceLecture?: string;
  /** Re-run practice QA/repair for one lecture without touching video artifacts. */
  repairPractice?: string;
  nodeLimit?: number;
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

const MAX_PRACTICE_REPAIR_PASSES = 2;

function isShellBasedPractice(folderPath: string, kind: PracticeKind): boolean {
  return existsSync(path.join(folderPath, stageRelForKind(kind)));
}

function assembleAdaptivePracticeHtml(options: {
  folderPath: string;
  kind: PracticeKind;
  spec: NonNullable<ReturnType<typeof resolveInteractiveSpec>> | NonNullable<ReturnType<typeof resolveGameSpec>>;
  title: string;
  objective: string;
}): string[] {
  const stagePath = path.join(options.folderPath, stageRelForKind(options.kind));
  const htmlPath = path.join(
    options.folderPath,
    options.kind === 'interactive' ? INTERACTIVE_PRACTICE_REL : GAME_PRACTICE_REL
  );
  const stageCssPath = path.join(options.folderPath, stageCssRelForKind(options.kind));

  if (!existsSync(stagePath)) {
    if (existsSync(htmlPath)) {
      console.log(`  Warning: ${stageRelForKind(options.kind)} missing; using existing index.html as legacy practice.`);
      return [];
    }
    return [`${stageRelForKind(options.kind)} not found after generation`];
  }

  const stageJs = readFileSync(stagePath, 'utf8');
  const validationFindings = validateStageJs(stageJs);
  if (validationFindings.length > 0) {
    if (existsSync(htmlPath)) {
      rmSync(htmlPath, { force: true });
      console.log(`  Removed stale ${options.kind === 'interactive' ? INTERACTIVE_PRACTICE_REL : GAME_PRACTICE_REL} after stage validation failure.`);
    }
    return validationFindings.map(finding => `Stage validation: ${finding}`);
  }

  const config = buildActivityShellConfig(options.kind, options.spec, {
    title: options.title,
    objective: options.objective
  });
  const stageCss = existsSync(stageCssPath) ? readFileSync(stageCssPath, 'utf8') : undefined;
  const html = assembleActivityHtml({ config, stageJs, stageCss });
  mkdirSync(path.dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`  Assembled ${options.kind === 'interactive' ? INTERACTIVE_PRACTICE_REL : GAME_PRACTICE_REL} from stage module.`);
  return [];
}

function seedAdaptiveStageScaffold(options: {
  folderPath: string;
  kind: PracticeKind;
  spec: NonNullable<ReturnType<typeof resolveInteractiveSpec>> | NonNullable<ReturnType<typeof resolveGameSpec>>;
  title: string;
  objective: string;
  forceOverwrite?: boolean;
}): void {
  const stageRel = stageRelForKind(options.kind);
  const stagePath = path.join(options.folderPath, stageRel);
  const stageExists = existsSync(stagePath);
  if (!shouldWriteStageScaffold(stageExists, options.forceOverwrite === true)) return;

  const shellConfig = buildActivityShellConfig(options.kind, options.spec, {
    title: options.title,
    objective: options.objective
  });
  mkdirSync(path.dirname(stagePath), { recursive: true });
  writeFileSync(stagePath, buildStageJsScaffold(options.kind, shellConfig), 'utf8');
  console.log(`  ${stageExists ? 'Re-seeded' : 'Seeded'} ${stageRel} scaffold`);
}

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

function setVideoFrameReview(
  lectureState: LectureState,
  status: PracticeReviewStatus,
  notes: string
) {
  lectureState.videoFrameReview = status;
  lectureState.videoFrameReviewNotes = notes;
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
    gameReviewNotes: lecture.gameReviewNotes ?? '',
    videoFrameReview: lecture.videoFrameReview ?? 'not-required',
    videoFrameReviewNotes: lecture.videoFrameReviewNotes ?? ''
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
      if (!row.formats.includes('video')) {
        synced.videoFrameReview = 'not-required';
        synced.videoFrameReviewNotes = '';
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

function getimgToolEnabledForPlan(plan: CoursePlan) {
  return plan.adaptivePath === true ? false : undefined;
}

function findLatestIndexFile(folderPath: string) {
  const files = findIndexHtmlFiles(folderPath);
  return files.length > 0 ? files[files.length - 1] : null;
}

function findIndexHtmlFiles(folderPath: string): string[] {
  if (!existsSync(folderPath)) return [];
  return readdirSync(folderPath)
    .filter(name => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(name => path.join(folderPath, name));
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
  if (options.repairPractice) {
    return lecture.slug === options.repairPractice;
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
  skills?: string[];
  enableGetimgTool?: boolean;
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
      skills: options.skills,
      enableGetimgTool: options.enableGetimgTool,
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
  plan: CoursePlan;
  lectureState: LectureState;
  state: CourseState;
  folderPath: string;
  fileName: PracticeHtmlRelPath;
  kind: PracticeKind;
  specText: string;
  spec: NonNullable<ReturnType<typeof resolveInteractiveSpec>> | NonNullable<ReturnType<typeof resolveGameSpec>>;
  runOptions: RunCourseOptions;
  storedFindings?: string[];
}): Promise<'passed' | 'needs-review'> {
  const htmlPath = path.join(options.folderPath, options.fileName);
  const screenshotDir = path.join(options.folderPath, '.practice-review', options.kind);
  const shellBased = options.plan.adaptivePath === true && isShellBasedPractice(options.folderPath, options.kind);

  let assemblyPreflight: RubricResult | null = null;
  if (shellBased) {
    const assemblyFindings = assembleAdaptivePracticeHtml({
      folderPath: options.folderPath,
      kind: options.kind,
      spec: options.spec,
      title: options.lectureState.title,
      objective: options.lectureState.objective
    });
    if (assemblyFindings.length > 0) {
      assemblyPreflight = { passed: false, findings: assemblyFindings };
    }
  }

  if (!assemblyPreflight && !existsSync(htmlPath)) {
    const existingNotes = options.kind === 'interactive'
      ? options.lectureState.interactiveReviewNotes.trim()
      : options.lectureState.gameReviewNotes.trim();
    const notFoundLine = `${options.fileName} not found after generation`;
    const priorFindings = splitStoredReviewNotes(existingNotes)
      .filter(finding => !finding.startsWith(notFoundLine));
    setPracticeReview(
      options.lectureState,
      options.kind,
      'needs-review',
      joinReviewNotes([notFoundLine, ...priorFindings])
    );
    writeCourseState(options.state);
    return 'needs-review';
  }

  const runRubricReview = async (): Promise<RubricResult | null> => {
    try {
      return await reviewPracticeWithRubric({
        objective: options.lectureState.objective,
        htmlPath,
        kind: options.kind,
        spec: options.spec,
        screenshotDir,
        model: options.runOptions.model
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(options.lectureState, options.kind, 'needs-review', singleLineNote(`QA infrastructure error: ${message}`));
      writeCourseState(options.state);
      return null;
    }
  };

  try {
    let result: RubricResult;
    const lineCountPath = shellBased
      ? path.join(options.folderPath, stageRelForKind(options.kind))
      : htmlPath;
    const fileLineCount = existsSync(lineCountPath)
      ? countPracticeFileLines(readFileSync(lineCountPath, 'utf8'))
      : 0;
    const storedFindingsRepairable = options.storedFindings
      ? filterRepairableFindings(options.storedFindings)
      : [];
    const skipStoredFindingsForOversizedFile =
      storedFindingsRepairable.length > 0 && fileLineCount > LARGE_PRACTICE_FILE_LINES;

    if (skipStoredFindingsForOversizedFile) {
      console.log(
        `  Practice ${shellBased ? 'stage' : 'file'} is ${fileLineCount} lines (>${LARGE_PRACTICE_FILE_LINES}); re-running QA before repair instead of using stored notes alone.`
      );
    }

    if (assemblyPreflight) {
      result = assemblyPreflight;
    } else if (options.storedFindings && options.storedFindings.length > 0 && !skipStoredFindingsForOversizedFile) {
      const repairable = storedFindingsRepairable;
      if (repairable.length === 0) {
        console.log('  Stored notes are QA tooling errors or shell-chrome findings (not stage-fixable); re-running automated review...');
        if (options.storedFindings.some(isQaInfrastructureFinding)) {
          console.log('  Tip: restart `npm run adaptive:ui` after updating coursegen so QA uses the latest code.');
        }
        const reviewed = await runRubricReview();
        if (!reviewed) return 'needs-review';
        result = reviewed;
      } else {
        result = { passed: false, findings: repairable };
      }
    } else {
      const reviewed = await runRubricReview();
      if (!reviewed) return 'needs-review';
      result = reviewed;
    }

    for (let repairPass = 0; repairPass < MAX_PRACTICE_REPAIR_PASSES; repairPass += 1) {
      if (result.passed) break;

      const actionableFindings = filterRepairableFindings(result.findings);
      if (actionableFindings.length === 0) {
        console.log('  No HTML-fixable QA findings; skipping agent repair.');
        break;
      }

      const repairTurns = defaultMaxPracticeRepairTurns(options.plan);
      console.log(`  Practice QA failed for ${options.fileName}; running repair pass ${repairPass + 1}/${MAX_PRACTICE_REPAIR_PASSES} (max ${repairTurns} turns)...`);
      actionableFindings.forEach(finding => console.log(`    - ${finding}`));
      const shellBased = options.plan.adaptivePath === true && isShellBasedPractice(options.folderPath, options.kind);
      const stageRel = options.kind === 'interactive' ? INTERACTIVE_STAGE_REL : GAME_STAGE_REL;
      const stagePath = path.join(options.folderPath, stageRel);
      const repairMessage = buildPracticeRepairMessage({
        fileName: options.fileName,
        objective: options.lectureState.objective,
        findings: actionableFindings,
        specText: options.specText,
        htmlPath,
        maxTurns: repairTurns,
        adaptive: options.plan.adaptivePath === true,
        shellBased,
        stageRel,
        stagePath,
        kind: options.kind,
        spec: options.spec,
        title: options.lectureState.title
      });
      try {
        await runAgentTask({
          workspaceDir: options.folderPath,
          taskMessage: repairMessage,
          maxTurns: repairTurns,
          model: options.runOptions.model,
          enableGetimgTool: getimgToolEnabledForPlan(options.plan),
          timeoutMinutes: options.runOptions.lectureTimeoutMinutes ?? 20,
          onCost: makeCostRecorder(options.lectureState, options.state)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPracticeReview(options.lectureState, options.kind, 'needs-review', singleLineNote(`QA infrastructure error: ${message}`));
        writeCourseState(options.state);
        return 'needs-review';
      }

      if (options.plan.adaptivePath === true) {
        const assemblyFindings = assembleAdaptivePracticeHtml({
          folderPath: options.folderPath,
          kind: options.kind,
          spec: options.spec,
          title: options.lectureState.title,
          objective: options.lectureState.objective
        });
        if (assemblyFindings.length > 0) {
          result = { passed: false, findings: assemblyFindings };
          continue;
        }
      }

      cleanupScreenshotDir(screenshotDir);
      const reviewed = await runRubricReview();
      if (!reviewed) return 'needs-review';
      result = reviewed;

      if (result.passed) break;
    }

    if (result.passed) {
      setPracticeReview(options.lectureState, options.kind, 'passed', '');
      writeCourseState(options.state);
      return 'passed';
    }

    setPracticeReview(options.lectureState, options.kind, 'needs-review', joinReviewNotes(result.findings.map(singleLineNote)));
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
    courseContext: plan.adaptivePath
      ? formatAdaptiveSkillContext(plan, planned.lecture)
      : formatLectureSequenceContext(plan, planned.lecture),
    adaptiveSkill: plan.adaptivePath ? planned.lecture : undefined,
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
        findings: result.findings,
        adaptive: plan.adaptivePath === true
      }),
      maxTurns: options.maxTurns ?? 60,
      model: options.model,
      skills: plan.adaptivePath ? [...ADAPTIVE_VIDEO_SKILL] : undefined,
      enableGetimgTool: getimgToolEnabledForPlan(plan),
      timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
      onCost: makeCostRecorder(lectureState, state)
    });
    writeCourseState(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Narration revision failed: ${message}. Continuing with original narration.`);
    return;
  }

  console.log('  Narration revision applied; continuing.');
}

async function runVideoFrameQaPhase(
  plan: CoursePlan,
  lectureState: LectureState,
  state: CourseState,
  folderPath: string,
  options: RunCourseOptions
): Promise<void> {
  if (!plan.adaptivePath) return;

  const htmlPaths = findIndexHtmlFiles(folderPath);
  if (htmlPaths.length === 0) return;

  console.log('  Reviewing video frame layout...');
  let findings: string[];
  try {
    findings = await collectVideoFrameFindings(htmlPaths);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Video frame QA skipped (infrastructure error): ${message}`);
    setVideoFrameReview(lectureState, 'needs-review', singleLineNote(`QA infrastructure error: ${message}`));
    writeCourseState(state);
    return;
  }

  if (findings.length === 0) {
    console.log('  Video frame QA: passed');
    setVideoFrameReview(lectureState, 'passed', '');
    writeCourseState(state);
    return;
  }

  setVideoFrameReview(lectureState, 'needs-review', joinReviewNotes(findings.map(singleLineNote)));
  writeCourseState(state);

  console.log('  Video frame QA failed; running one layout repair pass...');
  findings.forEach(finding => console.log(`    - ${finding}`));

  try {
    await runAgentTask({
      workspaceDir: folderPath,
      taskMessage: buildVideoFrameRepairMessage(findings),
      maxTurns: options.maxTurns ?? 60,
      model: options.model,
      skills: [...ADAPTIVE_VIDEO_SKILL],
      enableGetimgTool: getimgToolEnabledForPlan(plan),
      timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
      onCost: makeCostRecorder(lectureState, state)
    });
    writeCourseState(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Video frame repair failed: ${message}. Continuing with current HTML.`);
  }

  const rerunPaths = findIndexHtmlFiles(folderPath);
  try {
    findings = rerunPaths.length > 0 ? await collectVideoFrameFindings(rerunPaths) : findings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Video frame QA re-check skipped: ${message}`);
    setVideoFrameReview(lectureState, 'needs-review', joinReviewNotes([
      ...findings.map(singleLineNote),
      singleLineNote(`QA infrastructure error: ${message}`)
    ]));
    writeCourseState(state);
    return;
  }

  if (findings.length === 0) {
    console.log('  Video frame QA: passed after repair');
    setVideoFrameReview(lectureState, 'passed', '');
    writeCourseState(state);
    return;
  }

  console.log('  Video frame QA still failing after repair; marking needs-review at finalize.');
  findings.slice(0, MAX_VIDEO_FRAME_FINDINGS).forEach(finding => console.log(`    - ${finding}`));
  setVideoFrameReview(lectureState, 'needs-review', joinReviewNotes(findings.map(singleLineNote)));
  writeCourseState(state);
}

/**
 * A video-frame repair edits index.html after resolved.html was already built,
 * leaving the viewer playing the stale broken copy. Re-resolve when the index
 * is newer than its resolved sibling (skipped while frame QA still fails).
 */
async function reresolveIfIndexNewer(
  folderPath: string,
  lectureState: LectureState,
  state: CourseState,
  options: RunCourseOptions
): Promise<void> {
  if (lectureState.videoFrameReview === 'needs-review') return;
  const indexPath = findLatestIndexFile(folderPath);
  if (!indexPath) return;
  const resolvedPath = resolvedSiblingPathForIndex(indexPath);
  if (existsSync(resolvedPath) && statSync(resolvedPath).mtimeMs >= statSync(indexPath).mtimeMs) return;

  console.log('  Resolved HTML is stale after video repair; re-resolving...');
  lectureState.status = 'resolving';
  writeCourseState(state);
  try {
    await spawnResolve(indexPath, {
      ttsVoice: options.ttsVoice,
      ttsSpeed: options.ttsSpeed
    });
    lectureState.mp4Path = '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Re-resolve failed: ${message}. Viewer may play a stale resolved copy.`);
  }
}

function storedFindingsForRepairPractice(
  lectureState: LectureState,
  kind: PracticeKind,
  runOptions: RunCourseOptions
): string[] | undefined {
  if (runOptions.repairPractice !== lectureState.slug) return undefined;
  const notes = kind === 'interactive'
    ? lectureState.interactiveReviewNotes.trim()
    : lectureState.gameReviewNotes.trim();
  const status = kind === 'interactive'
    ? lectureState.interactiveReview
    : lectureState.gameReview;
  if (status !== 'needs-review' || !notes) return undefined;
  const findings = splitStoredReviewNotes(notes);
  if (findings.length === 0) return undefined;
  if (filterRepairableFindings(findings).length === 0) return undefined;
  return findings;
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
  const interactiveStagePath = path.join(folderPath, INTERACTIVE_STAGE_REL);
  const gameStagePath = path.join(folderPath, GAME_STAGE_REL);
  const regenAll = Boolean(options.forceLecture);
  const adaptive = plan.adaptivePath === true;

  if (needsInteractive && (regenAll || (adaptive ? !existsSync(interactiveStagePath) : !existsSync(interactivePath)))) {
    if (adaptive) {
      const interactiveSpec = resolveInteractiveSpec(planned.lecture);
      if (interactiveSpec) {
        seedAdaptiveStageScaffold({
          folderPath,
          kind: 'interactive',
          spec: interactiveSpec,
          title: lectureState.title,
          objective: lectureState.objective,
          forceOverwrite: regenAll
        });
      }
    }
    console.log(`  Generating ${INTERACTIVE_PRACTICE_REL}...`);
    const taskMessage = buildInteractiveTaskMessage(plan, planned.lecture, planned.moduleTitle, indexPath);
    try {
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        maxTurns: defaultMaxPracticeTurns(plan, options.maxPracticeTurns),
        model: options.model,
        enableGetimgTool: getimgToolEnabledForPlan(plan),
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        onCost: makeCostRecorder(lectureState, state)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(lectureState, 'interactive', 'needs-review', singleLineNote(`generation failed: ${message}`));
      writeCourseState(state);
    }
  }

  if (needsGame && (regenAll || (adaptive ? !existsSync(gameStagePath) : !existsSync(gamePath)))) {
    if (adaptive) {
      const gameSpec = resolveGameSpec(planned.lecture);
      if (gameSpec) {
        seedAdaptiveStageScaffold({
          folderPath,
          kind: 'game',
          spec: gameSpec,
          title: lectureState.title,
          objective: lectureState.objective,
          forceOverwrite: regenAll
        });
      }
    }
    console.log(`  Generating ${GAME_PRACTICE_REL}...`);
    const taskMessage = buildGameTaskMessage(plan, planned.lecture, planned.moduleTitle, indexPath);
    try {
      await runAgentTask({
        workspaceDir: folderPath,
        taskMessage,
        maxTurns: defaultMaxPracticeTurns(plan, options.maxPracticeTurns),
        model: options.model,
        enableGetimgTool: getimgToolEnabledForPlan(plan),
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        onCost: makeCostRecorder(lectureState, state)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPracticeReview(lectureState, 'game', 'needs-review', singleLineNote(`generation failed: ${message}`));
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
      plan,
      lectureState,
      state,
      folderPath,
      fileName: INTERACTIVE_PRACTICE_REL,
      kind: 'interactive',
      specText: formatInteractiveSpec(interactiveSpec),
      spec: interactiveSpec,
      runOptions: options,
      storedFindings: storedFindingsForRepairPractice(lectureState, 'interactive', options)
    });
  } else if (options.repairPractice === lectureState.slug && needsInteractive && lectureState.interactiveReview === 'passed') {
    console.log(`  ${INTERACTIVE_PRACTICE_REL}: practice review already passed; nothing to repair (use --force-lecture to regenerate).`);
  }

  if (needsGame && lectureState.gameReview !== 'passed' && gameSpec) {
    console.log(`  Reviewing ${GAME_PRACTICE_REL}...`);
    await reviewOnePracticeFile({
      plan,
      lectureState,
      state,
      folderPath,
      fileName: GAME_PRACTICE_REL,
      kind: 'game',
      specText: formatGameSpec(gameSpec),
      spec: gameSpec,
      runOptions: options,
      storedFindings: storedFindingsForRepairPractice(lectureState, 'game', options)
    });
  } else if (options.repairPractice === lectureState.slug && needsGame && lectureState.gameReview === 'passed') {
    console.log(`  ${GAME_PRACTICE_REL}: practice review already passed; nothing to repair (use --force-lecture to regenerate).`);
  }
}

function finalizeLectureStatus(lectureState: LectureState) {
  const practiceFailed =
    (lectureState.formats.includes('interactive') && lectureState.interactiveReview === 'needs-review') ||
    (lectureState.formats.includes('game') && lectureState.gameReview === 'needs-review');
  const videoFrameFailed = lectureState.videoFrameReview === 'needs-review';
  if (practiceFailed || videoFrameFailed) {
    lectureState.status = 'needs-review';
    lectureState.error = [
      videoFrameFailed && lectureState.videoFrameReviewNotes
        ? `video frame: ${lectureState.videoFrameReviewNotes.replace(/\n/g, '; ')}`
        : '',
      lectureState.interactiveReviewNotes &&
        `interactive: ${lectureState.interactiveReviewNotes.replace(/\n/g, '; ')}`,
      lectureState.gameReviewNotes &&
        `game: ${lectureState.gameReviewNotes.replace(/\n/g, '; ')}`
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
  let videoFrameQaRanThisInvocation = false;

  if (options.repairPractice === lectureState.slug) {
    const indexPath = findLatestIndexFile(folderPath);
    if (options.dryRun) {
      console.log(`\n--- ${lectureState.title} (practice repair only) ---\nFolder: ${folderPath}\n`);
      if (planned.lecture.formats.includes('interactive')) {
        console.log(`Review/repair: ${INTERACTIVE_PRACTICE_REL}`);
      }
      if (planned.lecture.formats.includes('game')) {
        console.log(`Review/repair: ${GAME_PRACTICE_REL}`);
      }
      return;
    }
    if (!indexPath) {
      lectureState.status = 'failed';
      lectureState.error = 'Video index missing; cannot repair practice without existing lecture artifacts';
      writeCourseState(state);
      return;
    }
    if (plan.adaptivePath && lectureState.videoFrameReview === 'needs-review') {
      await runVideoFrameQaPhase(plan, lectureState, state, folderPath, options);
      videoFrameQaRanThisInvocation = true;
      await reresolveIfIndexNewer(folderPath, lectureState, state, options);
    }
    lectureState.status = 'reviewing';
    writeCourseState(state);
    await runPracticePhase(plan, state, lectureState, planned, folderPath, indexPath, options);
    finalizeLectureStatus(lectureState);
    writeCourseState(state);
    return;
  }

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
    setVideoFrameReview(lectureState, 'not-required', '');
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
        skills: plan.adaptivePath ? [...ADAPTIVE_VIDEO_SKILL] : undefined,
        enableGetimgTool: getimgToolEnabledForPlan(plan),
        timeoutMinutes: options.lectureTimeoutMinutes ?? 20,
        onCost: makeCostRecorder(lectureState, state)
      });
    } catch (error) {
      lectureState.status = 'failed';
      lectureState.error = error instanceof Error ? error.message : String(error);
      writeCourseState(state);
      return;
    }

    indexPath = findLatestIndexFile(folderPath);
    cleanupLegacyTopLevelPracticeFiles(folderPath);
    if (!indexPath) {
      lectureState.status = 'failed';
      lectureState.error = 'No index*.html generated';
      writeCourseState(state);
      return;
    }

    if (!options.skipScriptReview) {
      await runScriptReviewPhase(plan, planned, lectureState, state, folderPath, options);
      indexPath = findLatestIndexFile(folderPath) ?? indexPath;
    }

    if (plan.adaptivePath) {
      await runVideoFrameQaPhase(plan, lectureState, state, folderPath, options);
      videoFrameQaRanThisInvocation = true;
      indexPath = findLatestIndexFile(folderPath) ?? indexPath;
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

  if (
    plan.adaptivePath &&
    lectureState.videoFrameReview === 'needs-review' &&
    indexPath &&
    !videoFrameQaRanThisInvocation
  ) {
    await runVideoFrameQaPhase(plan, lectureState, state, folderPath, options);
    await reresolveIfIndexNewer(folderPath, lectureState, state, options);
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

  const selectedPending =
    options.repairPractice || options.forceLecture
      ? pending
      : options.nodeLimit
        ? pending.slice(0, options.nodeLimit)
        : pending;
  const selectedSlugs = new Set(selectedPending.map(lecture => lecture.slug));

  printPlanSummary(plan);
  const actionLabel = options.renderOnly ? 'render' : 'generate';
  const unitLabel = plan.adaptivePath ? 'Nodes' : 'Lectures';
  const unitLabelSingular = plan.adaptivePath ? 'Node' : 'Lecture';
  console.log(`\n${unitLabel} to ${actionLabel}: ${selectedPending.map(l => l.slug).join(', ')}`);
  if (selectedPending.length < pending.length) {
    console.log(`Batch limit: ${selectedPending.length}/${pending.length} pending node(s) selected.`);
  }
  if (!options.renderOnly) {
    console.log(`Budget: $${state.budgetUsd.toFixed(2)} (spent so far: $${state.spentUsd.toFixed(2)})`);
  }

  if (!options.dryRun) {
    if (!options.renderOnly && !options.repairPractice) {
      const estimatedCost = estimateLecturesCostUsd(selectedPending);
      const remainingBudget = state.budgetUsd - state.spentUsd;
      if (estimatedCost > remainingBudget) {
        console.log(
          `Warning: estimated cost for selected batch (~$${estimatedCost.toFixed(2)}) exceeds remaining budget $${remainingBudget.toFixed(2)}; generation will stop at the budget cap.`
        );
      }
    }
    const confirmMessage = options.renderOnly
      ? `Render MP4 for ${selectedPending.length} ${unitLabelSingular.toLowerCase()}(s) from existing resolved HTML?`
      : options.repairPractice
        ? `Re-run practice QA/repair for ${selectedPending[0]?.title ?? options.repairPractice}? Video artifacts will be kept; video frame check is re-run when flagged.`
      : `Start generation for ${selectedPending.length} ${unitLabelSingular.toLowerCase()}(s)? Estimated full-course cost is ~$${estimateCourseCostUsd(plan).toFixed(2)}.`;
    const ok = await confirm(confirmMessage, options.yes);
    if (!ok) {
      console.log('Cancelled.');
      return state;
    }
  }

  for (const lectureState of state.lectures) {
    if (!shouldRunLecture(lectureState, plan, options)) continue;
    if (!selectedSlugs.has(lectureState.slug)) continue;

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

    console.log(`\n=== ${unitLabelSingular} ${lectureState.order}: ${lectureState.title} ===`);
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

const IN_PROGRESS_LECTURE_STATUSES = new Set<LectureState['status']>([
  'generating',
  'resolving',
  'rendering',
  'generating-practice',
  'reviewing'
]);

export function lectureSlugFromJobArgs(args: string[]) {
  for (const flag of ['--force-lecture', '--repair-practice']) {
    const index = args.indexOf(flag);
    if (index >= 0) {
      const slug = String(args[index + 1] || '').trim();
      if (slug) return slug;
    }
  }
  return undefined;
}

export function resetInterruptedLectures(
  courseSlug: string,
  options: { lectureSlug?: string; reason?: string } = {},
) {
  const state = readCourseState(courseSlug);
  const reason = options.reason ?? 'Stopped by user';
  let changed = false;

  for (const lecture of state.lectures) {
    if (options.lectureSlug && lecture.slug !== options.lectureSlug) continue;
    if (!IN_PROGRESS_LECTURE_STATUSES.has(lecture.status)) continue;
    lecture.status = 'failed';
    lecture.error = reason;
    changed = true;
  }

  if (changed) {
    writeCourseState(state);
  }
  return changed;
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
    if (lecture.videoFrameReview !== 'not-required') {
      reviews.push(`videoFrame=${lecture.videoFrameReview}`);
    }
    const reviewSuffix = reviews.length > 0 ? ` [${reviews.join(', ')}]` : '';
    console.log(`  [${lecture.status}] ${lecture.order}. ${lecture.title} (attempts=${lecture.attempts}, cost=$${lecture.costUsd.toFixed(2)})${reviewSuffix}`);
    if (lecture.error) console.log(`    error: ${lecture.error.split('\n')[0]}`);
    if (lecture.interactiveReviewNotes) {
      const firstFinding = splitStoredReviewNotes(lecture.interactiveReviewNotes)[0];
      if (firstFinding) console.log(`    interactive QA: ${firstFinding}`);
    }
    if (lecture.gameReviewNotes) {
      const firstFinding = splitStoredReviewNotes(lecture.gameReviewNotes)[0];
      if (firstFinding) console.log(`    game QA: ${firstFinding}`);
    }
    if (lecture.videoFrameReviewNotes) {
      const firstFinding = splitStoredReviewNotes(lecture.videoFrameReviewNotes)[0];
      if (firstFinding) console.log(`    video frame QA: ${firstFinding}`);
    }
    if (lecture.mp4Path && existsSync(lecture.mp4Path)) console.log(`    mp4: ${lecture.mp4Path}`);
  }
  console.log(`\nSpent: $${state.spentUsd.toFixed(2)} / $${state.budgetUsd.toFixed(2)}`);
}
