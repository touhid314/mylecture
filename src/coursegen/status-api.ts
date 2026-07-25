import { existsSync, readdirSync } from 'node:fs';
import { coursePlanPath, courseStatePath, getCourseDir, getCoursesRoot } from './paths.ts';
import { estimateCourseCostUsd } from './lecture-prompt.ts';
import { lectureRenderReady } from './run-course.ts';
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

  const lectures: LectureSummary[] = (state?.lectures ?? []).map(lecture => ({
    ...lecture,
    hasMp4: Boolean(lecture.mp4Path && existsSync(lecture.mp4Path)),
    renderReady: lectureRenderReady(plan, lecture)
  }));

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
    courseDir: getCourseDir(courseSlug)
  };
}
