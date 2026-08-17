import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { moduleCourseSlug, validateClassPlan, type ClassPlan } from './class-types.ts';
import {
  assessmentsPath,
  classPlanPath,
  coursePlanPath,
  courseStatePath,
  getClassDir,
  getClassesRoot,
  getCourseDir,
  getCoursesRoot,
  isIndexHtmlName,
  lectureFolderName,
  lectureFolderPath
} from './paths.ts';
import { estimateCourseCostUsd, GAME_PRACTICE_REL, INTERACTIVE_PRACTICE_REL } from './lecture-prompt.ts';
import { lectureHasPractice, lectureRenderReady } from './run-course.ts';
import { lectureUsageFileExists, readLectureUsageCostUsd } from './spawn.ts';
import { readCoursePlan, readCourseState } from './state.ts';
import type { CoursePlan, CourseState, LectureState } from './types.ts';

export type CourseListItem = {
  slug: string;
  title: string;
  hasState: boolean;
  updatedAt?: string;
  lectureCount: number;
  doneCount: number;
};

export type LectureSummary = LectureState & {
  hasMp4: boolean;
  renderReady: boolean;
  canRetryPractice: boolean;
  canRepairPractice: boolean;
  canEditVideo: boolean;
  canEditInteractive: boolean;
  canEditGame: boolean;
};

export type ClassListItem = {
  slug: string;
  title: string;
  moduleCount: number;
  plannedCount: number;
  assessmentCount: number;
};

export type ClassModuleSummary = {
  slug: string;
  title: string;
  summary?: string;
  courseSlug: string;
  hasCoursePlan: boolean;
  hasAssessments: boolean;
  lectureCount: number;
  doneCount: number;
};

export type ClassSummary = {
  plan: ClassPlan;
  classDir: string;
  modules: ClassModuleSummary[];
};

export type CourseSummary = {
  plan: CoursePlan;
  state: CourseState | null;
  estimatedCostUsd: number;
  progress: {
    total: number;
    done: number;
    failed: number;
    needsReview: number;
    inProgress: number;
    pending: number;
    renderReady: number;
  };
  lectures: LectureSummary[];
  courseDir: string;
  hasAssessments: boolean;
};

function countDone(state: CourseState | null) {
  if (!state) return 0;
  return state.lectures.filter(lecture => lecture.status === 'done').length;
}

export function listCourses(): CourseListItem[] {
  const root = getCoursesRoot();
  if (!existsSync(root)) return [];

  const items: CourseListItem[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const planPath = coursePlanPath(slug);
    if (!existsSync(planPath)) continue;

    let plan: CoursePlan;
    try {
      plan = readCoursePlan(slug);
    } catch {
      continue;
    }

    const statePath = courseStatePath(slug);
    const hasState = existsSync(statePath);
    let updatedAt: string | undefined;
    let doneCount = 0;
    if (hasState) {
      try {
        const state = readCourseState(slug);
        updatedAt = state.updatedAt;
        doneCount = countDone(state);
      } catch {
        // ignore malformed state
      }
    }

    const lectureCount = plan.modules.reduce((sum, module) => sum + module.lectures.length, 0);
    items.push({
      slug,
      title: plan.title,
      hasState,
      updatedAt,
      lectureCount,
      doneCount
    });
  }

  return items.sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.title.localeCompare(b.title);
  });
}

export function getCourseSummary(courseSlug: string): CourseSummary {
  const plan = readCoursePlan(courseSlug);
  const statePath = courseStatePath(courseSlug);
  const state = existsSync(statePath) ? readCourseState(courseSlug) : null;

  const lectures: LectureSummary[] = (state?.lectures ?? []).map(lecture => {
    const folderName = lecture.folderName || lectureFolderName(lecture.order, lecture.slug);
    const folderPath = lectureFolderPath(courseSlug, folderName);
    const hasVideoIndex = existsSync(folderPath) && readdirSync(folderPath).some(name => isIndexHtmlName(name));
    const liveCost = lectureUsageFileExists(folderPath)
      ? readLectureUsageCostUsd(folderPath)
      : lecture.costUsd;
    return {
      ...lecture,
      costUsd: Number(liveCost.toFixed(4)),
      hasMp4: Boolean(lecture.mp4Path && existsSync(lecture.mp4Path)),
      renderReady: lectureRenderReady(plan, lecture),
      canRetryPractice: lectureHasPractice(lecture) && Boolean(lecture.folderName),
      canRepairPractice: lectureHasPractice(lecture) && (
        existsSync(path.join(folderPath, INTERACTIVE_PRACTICE_REL)) ||
        existsSync(path.join(folderPath, GAME_PRACTICE_REL)) ||
        existsSync(path.join(folderPath, 'interactive.html')) ||
        existsSync(path.join(folderPath, 'game.html'))
      ),
      canEditVideo: hasVideoIndex,
      canEditInteractive:
        existsSync(path.join(folderPath, INTERACTIVE_PRACTICE_REL)) ||
        existsSync(path.join(folderPath, 'interactive.html')),
      canEditGame:
        existsSync(path.join(folderPath, GAME_PRACTICE_REL)) ||
        existsSync(path.join(folderPath, 'game.html'))
    };
  });
  if (state) {
    state.spentUsd = Number(lectures.reduce((sum, lecture) => sum + lecture.costUsd, 0).toFixed(4));
  }

  const progress = {
    total: lectures.length,
    done: lectures.filter(lecture => lecture.status === 'done').length,
    failed: lectures.filter(lecture => lecture.status === 'failed').length,
    needsReview: lectures.filter(lecture => lecture.status === 'needs-review').length,
    inProgress: lectures.filter(lecture =>
      !['done', 'failed', 'needs-review', 'pending'].includes(lecture.status)
    ).length,
    pending: lectures.filter(lecture => lecture.status === 'pending').length,
    renderReady: lectures.filter(lecture => lecture.renderReady).length
  };

  return {
    plan,
    state,
    estimatedCostUsd: estimateCourseCostUsd(plan),
    progress,
    lectures,
    courseDir: getCourseDir(courseSlug),
    hasAssessments: existsSync(assessmentsPath(courseSlug))
  };
}

function readClassPlanFile(classSlug: string): ClassPlan {
  return validateClassPlan(JSON.parse(readFileSync(classPlanPath(classSlug), 'utf8')));
}

function moduleProgress(classSlug: string, moduleSlug: string): ClassModuleSummary {
  const courseSlug = moduleCourseSlug(classSlug, moduleSlug);
  const hasCoursePlan = existsSync(coursePlanPath(courseSlug));
  const hasAssessments = existsSync(assessmentsPath(courseSlug));
  let lectureCount = 0;
  let doneCount = 0;

  if (hasCoursePlan) {
    try {
      const plan = readCoursePlan(courseSlug);
      lectureCount = plan.modules.reduce((sum, module) => sum + module.lectures.length, 0);
    } catch {
      lectureCount = 0;
    }
    try {
      if (existsSync(courseStatePath(courseSlug))) {
        doneCount = countDone(readCourseState(courseSlug));
      }
    } catch {
      doneCount = 0;
    }
  }

  return {
    slug: moduleSlug,
    title: moduleSlug,
    courseSlug,
    hasCoursePlan,
    hasAssessments,
    lectureCount,
    doneCount
  };
}

export function listClasses(): ClassListItem[] {
  const root = getClassesRoot();
  if (!existsSync(root)) return [];

  const items: ClassListItem[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (!existsSync(classPlanPath(slug))) continue;

    let plan: ClassPlan;
    try {
      plan = readClassPlanFile(slug);
    } catch {
      continue;
    }

    let plannedCount = 0;
    let assessmentCount = 0;
    for (const module of plan.modules) {
      const progress = moduleProgress(plan.slug, module.slug);
      if (progress.hasCoursePlan) plannedCount += 1;
      if (progress.hasAssessments) assessmentCount += 1;
    }

    items.push({
      slug: plan.slug,
      title: plan.title,
      moduleCount: plan.modules.length,
      plannedCount,
      assessmentCount
    });
  }

  return items.sort((a, b) => a.title.localeCompare(b.title));
}

export function getClassSummary(classSlug: string): ClassSummary {
  const plan = readClassPlanFile(classSlug);
  return {
    plan,
    classDir: getClassDir(classSlug),
    modules: plan.modules.map(module => ({
      ...moduleProgress(plan.slug, module.slug),
      title: module.title,
      summary: module.summary
    }))
  };
}
