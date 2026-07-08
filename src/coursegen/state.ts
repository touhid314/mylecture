import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoursePlan, CourseState, LectureState, SkillGraph } from './types.ts';
import { DEFAULT_LEARNING_INTENT, isLearningIntent } from './types.ts';
import { coursePlanPath, courseStatePath, skillGraphPath } from './paths.ts';

function normalizeCoursePlan(raw: CoursePlan): CoursePlan {
  return {
    ...raw,
    intent: isLearningIntent(raw.intent) ? raw.intent : DEFAULT_LEARNING_INTENT
  };
}

function normalizeLectureState(raw: LectureState): LectureState {
  return {
    ...raw,
    interactiveReview: raw.interactiveReview ?? 'not-required',
    interactiveReviewNotes: raw.interactiveReviewNotes ?? '',
    gameReview: raw.gameReview ?? 'not-required',
    gameReviewNotes: raw.gameReviewNotes ?? '',
    videoFrameReview: raw.videoFrameReview ?? 'not-required',
    videoFrameReviewNotes: raw.videoFrameReviewNotes ?? ''
  };
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

export function readSkillGraph(courseSlug: string): SkillGraph {
  const filePath = skillGraphPath(courseSlug);
  if (!existsSync(filePath)) {
    throw new Error(`Skill graph not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as SkillGraph;
}

export function writeSkillGraph(graph: SkillGraph) {
  const filePath = skillGraphPath(graph.courseSlug);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  return filePath;
}
