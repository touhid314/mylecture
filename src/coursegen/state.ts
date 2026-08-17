import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoursePlan, CourseState, LectureState } from './types.ts';
import { DEFAULT_LEARNING_INTENT, isLearningIntent } from './types.ts';
import { coursePlanPath, courseStatePath } from './paths.ts';

function normalizeCoursePlan(raw: CoursePlan): CoursePlan {
  const plan: CoursePlan = {
    ...raw,
    intent: isLearningIntent(raw.intent) ? raw.intent : DEFAULT_LEARNING_INTENT
  };
  if (raw.source?.slug && raw.source?.title) {
    plan.source = { slug: raw.source.slug, title: raw.source.title };
  }
  return plan;
}

function normalizeLectureState(raw: LectureState & { status: string }): LectureState {
  if (['generating-practice', 'reviewing', 'needs-review'].includes(raw.status)) {
    return { ...raw, status: 'pending', error: '' };
  }
  return raw;
}

function normalizeCourseState(raw: CourseState): CourseState {
  return {
    ...raw,
    lectures: Array.isArray(raw.lectures) ? raw.lectures.map(normalizeLectureState) : []
  };
}

export function readCoursePlan(courseSlug: string): CoursePlan {
  const filePath = coursePlanPath(courseSlug);
  if (!existsSync(filePath)) {
    throw new Error(`Course plan not found: ${filePath}`);
  }
  return normalizeCoursePlan(JSON.parse(readFileSync(filePath, 'utf8')) as CoursePlan);
}

export function writeCoursePlan(plan: CoursePlan) {
  const filePath = coursePlanPath(plan.slug);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return filePath;
}

export function readCourseState(courseSlug: string): CourseState {
  const filePath = courseStatePath(courseSlug);
  if (!existsSync(filePath)) {
    throw new Error(`Course state not found: ${filePath}`);
  }
  return normalizeCourseState(JSON.parse(readFileSync(filePath, 'utf8')) as CourseState);
}

export function writeCourseState(state: CourseState) {
  const filePath = courseStatePath(state.courseSlug);
  mkdirSync(path.dirname(filePath), { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return filePath;
}
