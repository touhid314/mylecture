import { isCourseCategoryId, type CourseCategoryId } from './categories.ts';

export const AUDIENCES = ['early', 'elementary', 'middle', 'general', 'undergraduate', 'graduate'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const LEARNING_INTENTS = ['foundation', 'academic', 'practice', 'exam', 'professional', 'exploration', 'teaching'] as const;
export type LearningIntent = (typeof LEARNING_INTENTS)[number];
export const DEFAULT_LEARNING_INTENT: LearningIntent = 'foundation';

export const LECTURE_FORMATS = ['video', 'interactive', 'game'] as const;
export type LectureFormat = (typeof LECTURE_FORMATS)[number];

export const INTERACTIVE_MODES = ['learn', 'practice', 'challenge'] as const;
export type InteractiveMode = (typeof INTERACTIVE_MODES)[number];

export type InteractiveActivitySpec = {
  id: string;
  title: string;
  mode: InteractiveMode;
  visibleSetup: string;
  learnerAction: string;
  controls: string[];
  feedback: string;
  successCriterion: string;
};

export type InteractiveSpec = {
  activities: InteractiveActivitySpec[];
};

export type GameSpec = {
  mission: string;
  visibleSetup: string;
  learnerAction: string;
  controls: string[];
  feedback: string;
  successCriterion: string;
  /**
   * Coarse timed-challenge band. Coursegen maps this to seconds —
   * do not put raw timer durations in the plan.
   * omitted → steady
   */
  pacing?: import('./challenge-pacing.ts').ChallengePacing;
};

export type PlannedLecture = {
  slug: string;
  title: string;
  objective: string;
  durationMinutes: number;
  formats: LectureFormat[];
  promptNotes: string;
  review?: boolean;
  prerequisites?: string[];
  assumes?: string[];
  teaches?: string[];
  commonMistakes?: string[];
  remediationTargets?: string[];
  enrichmentTargets?: string[];
  interactiveSpec?: InteractiveSpec;
  gameSpec?: GameSpec;
};

export type PlannedModule = {
  title: string;
  lectures: PlannedLecture[];
};

export const ADAPTIVE_PATH_INTENT: LearningIntent = 'practice';

export type CoursePlan = {
  title: string;
  slug: string;
  audience: Audience;
  intent: LearningIntent;
  categoryId: CourseCategoryId;
  summary: string;
  description: string;
  modules: PlannedModule[];
  adaptivePath?: boolean;
};

export type SkillDependency = {
  from: string;
  to: string;
};

export type SkillNode = {
  slug: string;
  title: string;
  objective: string;
  order: number;
  module: string;
  difficulty: number;
  review?: boolean;
  prerequisites: string[];
  assumes?: string[];
  teaches?: string[];
  commonMistakes?: string[];
  remediationTargets?: string[];
  enrichmentTargets?: string[];
};

export type SkillGraph = {
  courseSlug: string;
  skills: SkillNode[];
  dependencies: SkillDependency[];
};

export type LectureStatus =
  | 'pending'
  | 'generating'
  | 'resolving'
  | 'rendering'
  | 'generating-practice'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'needs-review';

export type PracticeReviewStatus = 'not-required' | 'passed' | 'needs-review';

export type LectureState = {
  slug: string;
  title: string;
  module: string;
  order: number;
  folderName: string;
  objective: string;
  durationMinutes: number;
  formats: LectureFormat[];
  status: LectureStatus;
  attempts: number;
  costUsd: number;
  error: string;
  mp4Path: string;
  interactiveReview: PracticeReviewStatus;
  interactiveReviewNotes: string;
  gameReview: PracticeReviewStatus;
  gameReviewNotes: string;
  videoFrameReview: PracticeReviewStatus;
  videoFrameReviewNotes: string;
};

export type CourseState = {
  courseSlug: string;
  budgetUsd: number;
  spentUsd: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  lectures: LectureState[];
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

export function isLearningIntent(value: unknown): value is LearningIntent {
  return typeof value === 'string' && (LEARNING_INTENTS as readonly string[]).includes(value);
}

function isFormat(value: unknown): value is LectureFormat {
  return typeof value === 'string' && (LECTURE_FORMATS as readonly string[]).includes(value);
}

function isInteractiveMode(value: unknown): value is InteractiveMode {
  return typeof value === 'string' && (INTERACTIVE_MODES as readonly string[]).includes(value);
}

function validateStringArray(raw: unknown, path: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${path}: must be a non-empty array`);
  }
  const values = raw.map(item => String(item || '').trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${path}: must include at least one non-empty item`);
  }
  return values.slice(0, 6);
}

function validateOptionalStringArray(raw: unknown, path: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${path}: must be an array`);
  }
  return raw.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8);
}

function validateOptionalSlugArray(raw: unknown, path: string): string[] | undefined {
  const values = validateOptionalStringArray(raw, path);
  if (!values) return undefined;
  values.forEach((slug, index) => {
    if (!SLUG_RE.test(slug)) {
      throw new Error(`${path}[${index}]: invalid slug`);
    }
  });
  return values;
}

function validateInteractiveActivity(raw: unknown, path: string): InteractiveActivitySpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: activity must be an object`);
  }
  const activity = raw as Record<string, unknown>;
  const id = String(activity.id || '').trim();
  const title = String(activity.title || '').trim();
  const mode = activity.mode;
  const visibleSetup = String(activity.visibleSetup || '').trim();
  const learnerAction = String(activity.learnerAction || '').trim();
  const controls = validateStringArray(activity.controls, `${path}.controls`);
  const feedback = String(activity.feedback || '').trim();
  const successCriterion = String(activity.successCriterion || '').trim();

  if (!id || !SLUG_RE.test(id)) throw new Error(`${path}: invalid activity id`);
  if (!title) throw new Error(`${path}: title required`);
  if (!isInteractiveMode(mode)) throw new Error(`${path}: invalid mode`);
  if (!visibleSetup) throw new Error(`${path}: visibleSetup required`);
  if (!learnerAction) throw new Error(`${path}: learnerAction required`);
  if (!feedback) throw new Error(`${path}: feedback required`);
  if (!successCriterion) throw new Error(`${path}: successCriterion required`);

  return { id, title, mode, visibleSetup, learnerAction, controls, feedback, successCriterion };
}

function validateInteractiveSpec(raw: unknown, path: string): InteractiveSpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: interactiveSpec must be an object`);
  }
  const spec = raw as Record<string, unknown>;
  const activitiesRaw = spec.activities;
  if (!Array.isArray(activitiesRaw) || activitiesRaw.length === 0) {
    throw new Error(`${path}: interactiveSpec.activities must be a non-empty array`);
  }
  if (activitiesRaw.length > 3) {
    throw new Error(`${path}: interactiveSpec.activities max is 3`);
  }
  const activities = activitiesRaw.map((activityRaw, index) =>
    validateInteractiveActivity(activityRaw, `${path}.activities[${index}]`)
  );
  const seenIds = new Set<string>();
  for (const activity of activities) {
    if (seenIds.has(activity.id)) {
      throw new Error(`${path}: duplicate activity id: ${activity.id}`);
    }
    seenIds.add(activity.id);
  }
  return { activities };
}

function validateGameSpec(raw: unknown, path: string): GameSpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: gameSpec must be an object`);
  }
  const spec = raw as Record<string, unknown>;
  const mission = String(spec.mission || '').trim();
  const visibleSetup = String(spec.visibleSetup || '').trim();
  const learnerAction = String(spec.learnerAction || '').trim();
  const controls = validateStringArray(spec.controls, `${path}.controls`);
  const feedback = String(spec.feedback || '').trim();
  const successCriterion = String(spec.successCriterion || '').trim();
  if (!mission) throw new Error(`${path}: mission required`);
  if (!visibleSetup) throw new Error(`${path}: visibleSetup required`);
  if (!learnerAction) throw new Error(`${path}: learnerAction required`);
  if (!feedback) throw new Error(`${path}: feedback required`);
  if (!successCriterion) throw new Error(`${path}: successCriterion required`);
  const result: GameSpec = { mission, visibleSetup, learnerAction, controls, feedback, successCriterion };
  if (spec.pacing !== undefined && spec.pacing !== null && String(spec.pacing).trim() !== '') {
    const pacing = String(spec.pacing).trim();
    if (!['relaxed', 'steady', 'brisk'].includes(pacing)) {
      throw new Error(`${path}: pacing must be relaxed|steady|brisk`);
    }
    result.pacing = pacing as GameSpec['pacing'];
  }
  return result;
}

export function defaultInteractiveSpec(lecture: Pick<PlannedLecture, 'objective' | 'title'>): InteractiveSpec {
  return {
    activities: [
      {
        id: 'main',
        title: lecture.title,
        mode: 'practice',
        visibleSetup: 'Show a clear prompt, one worked visual area, and controls labeled with the action the learner should take.',
        learnerAction: `Practice the skill from this lesson: ${lecture.objective}`,
        controls: ['Response control', 'Check answer', 'Next question'],
        feedback: 'After each submission, say whether the answer is correct and show one concrete hint or explanation.',
        successCriterion: 'Answer 3 questions correctly'
      }
    ]
  };
}

export function defaultGameSpec(lecture: Pick<PlannedLecture, 'objective'>): GameSpec {
  return {
    mission: `Master the lesson objective through a scored challenge.`,
    visibleSetup: 'Show the challenge target, the current problem, the score, and the controls needed to answer before the first attempt.',
    learnerAction: `Apply the lesson objective in a sequence of scored challenges: ${lecture.objective}`,
    controls: ['Response controls', 'Check challenge', 'Next challenge', 'Restart challenge'],
    feedback: 'After each attempt, show correctness, the correct reasoning, and the updated score.',
    successCriterion: `Score at least 70 out of 100 by applying: ${lecture.objective}`,
    pacing: 'steady'
  };
}

export function resolveInteractiveSpec(lecture: PlannedLecture): InteractiveSpec | null {
  if (!lecture.formats.includes('interactive')) return null;
  return lecture.interactiveSpec ?? defaultInteractiveSpec(lecture);
}

export function resolveGameSpec(lecture: PlannedLecture): GameSpec | null {
  if (!lecture.formats.includes('game')) return null;
  return lecture.gameSpec ?? defaultGameSpec(lecture);
}

function validateLecture(raw: unknown, path: string): PlannedLecture {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: lecture must be an object`);
  }
  const lecture = raw as Record<string, unknown>;
  const slug = String(lecture.slug || '').trim();
  const title = String(lecture.title || '').trim();
  const objective = String(lecture.objective || '').trim();
  const durationMinutes = Number(lecture.durationMinutes);
  const formats = Array.isArray(lecture.formats) ? lecture.formats.filter(isFormat) : [];
  const promptNotes = String(lecture.promptNotes || '').trim();

  if (!slug || !SLUG_RE.test(slug)) throw new Error(`${path}: invalid slug`);
  if (!title) throw new Error(`${path}: title required`);
  if (!objective) throw new Error(`${path}: objective required`);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 2 || durationMinutes > 10) {
    throw new Error(`${path}: durationMinutes must be 2-10`);
  }
  if (!formats.includes('video')) {
    throw new Error(`${path}: every lecture must include "video" in formats`);
  }

  let interactiveSpec: InteractiveSpec | undefined;
  if (formats.includes('interactive')) {
    if (lecture.interactiveSpec) {
      interactiveSpec = validateInteractiveSpec(lecture.interactiveSpec, `${path}.interactiveSpec`);
    }
  } else if (lecture.interactiveSpec) {
    throw new Error(`${path}: interactiveSpec only allowed when formats includes interactive`);
  }

  let gameSpec: GameSpec | undefined;
  if (formats.includes('game')) {
    if (lecture.gameSpec) {
      gameSpec = validateGameSpec(lecture.gameSpec, `${path}.gameSpec`);
    }
  } else if (lecture.gameSpec) {
    throw new Error(`${path}: gameSpec only allowed when formats includes game`);
  }

  let review: boolean | undefined;
  if (lecture.review !== undefined) {
    if (typeof lecture.review !== 'boolean') {
      throw new Error(`${path}: review must be a boolean when present`);
    }
    review = lecture.review;
  }

  let prerequisites: string[] | undefined;
  if (lecture.prerequisites !== undefined) {
    if (!Array.isArray(lecture.prerequisites)) {
      throw new Error(`${path}: prerequisites must be an array`);
    }
    prerequisites = lecture.prerequisites.map((item, index) => {
      const slugValue = String(item || '').trim();
      if (!slugValue || !SLUG_RE.test(slugValue)) {
        throw new Error(`${path}: prerequisites[${index}] invalid slug`);
      }
      return slugValue;
    });
  }

  const result: PlannedLecture = { slug, title, objective, durationMinutes, formats, promptNotes };
  if (review !== undefined) result.review = review;
  if (prerequisites) result.prerequisites = prerequisites;
  const assumes = validateOptionalStringArray(lecture.assumes, `${path}.assumes`);
  const teaches = validateOptionalStringArray(lecture.teaches, `${path}.teaches`);
  const commonMistakes = validateOptionalStringArray(lecture.commonMistakes, `${path}.commonMistakes`);
  const remediationTargets = validateOptionalSlugArray(lecture.remediationTargets, `${path}.remediationTargets`);
  const enrichmentTargets = validateOptionalSlugArray(lecture.enrichmentTargets, `${path}.enrichmentTargets`);
  if (assumes) result.assumes = assumes;
  if (teaches) result.teaches = teaches;
  if (commonMistakes) result.commonMistakes = commonMistakes;
  if (remediationTargets) result.remediationTargets = remediationTargets;
  if (enrichmentTargets) result.enrichmentTargets = enrichmentTargets;
  if (interactiveSpec) result.interactiveSpec = interactiveSpec;
  if (gameSpec) result.gameSpec = gameSpec;
  return result;
}

export function validateCoursePlan(raw: unknown, options: { maxLectures?: number } = {}): CoursePlan {
  const maxLectures = options.maxLectures ?? 30;
  if (!raw || typeof raw !== 'object') {
    throw new Error('course plan must be an object');
  }
  const plan = raw as Record<string, unknown>;
  const title = String(plan.title || '').trim();
  const slug = String(plan.slug || '').trim();
  const audience = plan.audience;
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const summary = String(plan.summary || '').trim();
  const description = String(plan.description || '').trim();
  const categoryId = plan.categoryId;
  const modulesRaw = plan.modules;
  const adaptivePath = plan.adaptivePath === true;

  if (!title) throw new Error('title required');
  if (!slug || !SLUG_RE.test(slug)) throw new Error('invalid slug');
  if (!isAudience(audience)) throw new Error('invalid audience');
  if (!isLearningIntent(intent)) throw new Error('invalid intent');
  if (!summary) throw new Error('summary required');
  if (!description) throw new Error('description required');
  if (!isCourseCategoryId(categoryId)) throw new Error('invalid categoryId');
  if (!Array.isArray(modulesRaw) || modulesRaw.length === 0) {
    throw new Error('modules must be a non-empty array');
  }

  const modules: PlannedModule[] = [];
  let lectureCount = 0;
  const seenSlugs = new Set<string>();

  modulesRaw.forEach((moduleRaw, moduleIndex) => {
    if (!moduleRaw || typeof moduleRaw !== 'object') {
      throw new Error(`modules[${moduleIndex}] must be an object`);
    }
    const moduleObj = moduleRaw as Record<string, unknown>;
    const moduleTitle = String(moduleObj.title || '').trim();
    const lecturesRaw = moduleObj.lectures;
    if (!moduleTitle) throw new Error(`modules[${moduleIndex}].title required`);
    if (!Array.isArray(lecturesRaw) || lecturesRaw.length === 0) {
      throw new Error(`modules[${moduleIndex}].lectures must be a non-empty array`);
    }

    const lectures = lecturesRaw.map((lectureRaw, lectureIndex) => {
      const lecture = validateLecture(lectureRaw, `modules[${moduleIndex}].lectures[${lectureIndex}]`);
      if (seenSlugs.has(lecture.slug)) {
        throw new Error(`duplicate lecture slug: ${lecture.slug}`);
      }
      seenSlugs.add(lecture.slug);
      lectureCount += 1;
      return lecture;
    });

    modules.push({ title: moduleTitle, lectures });
  });

  if (lectureCount > maxLectures) {
    throw new Error(`plan has ${lectureCount} lectures; max is ${maxLectures}`);
  }

  const result: CoursePlan = { title, slug, audience, intent, categoryId, summary, description, modules };
  if (adaptivePath) result.adaptivePath = true;
  return result;
}

function assertReviewNodeValid(lecture: PlannedLecture, path: string): void {
  if (!lecture.formats.includes('video') || !lecture.formats.includes('game')) {
    throw new Error(`${path}: review nodes must include video and game formats`);
  }
  if (lecture.formats.includes('interactive')) {
    throw new Error(`${path}: review nodes must not include interactive format`);
  }
  if (!lecture.gameSpec) {
    throw new Error(`${path}: review nodes must include gameSpec`);
  }
  if (!lecture.prerequisites || lecture.prerequisites.length === 0) {
    throw new Error(`${path}: review nodes must include a non-empty prerequisites array`);
  }
}

export function validateAdaptiveCoursePlan(raw: unknown, options: { maxLectures?: number } = {}): CoursePlan {
  const maxLectures = options.maxLectures ?? 30;
  const plan = validateCoursePlan(raw, { maxLectures });
  if (!plan.adaptivePath) {
    throw new Error('adaptivePath must be true for adaptive course validation');
  }

  const lectures = flattenPlanLectures(plan);
  if (lectures.length > maxLectures) {
    throw new Error(`adaptive plan has ${lectures.length} lectures; max is ${maxLectures}`);
  }

  for (const lecture of lectures) {
    const path = `lecture ${lecture.slug}`;
    if (lecture.durationMinutes !== 2 && lecture.durationMinutes !== 3) {
      throw new Error(`${path}: adaptive durationMinutes must be 2 or 3`);
    }
    if (!Array.isArray(lecture.prerequisites)) {
      throw new Error(`${path}: adaptive lectures must include explicit prerequisites array`);
    }
    if (lecture.review === true) {
      assertReviewNodeValid(lecture, path);
    } else {
      if (!lecture.formats.includes('video') || !lecture.formats.includes('interactive')) {
        throw new Error(`${path}: adaptive skill nodes must include video and interactive formats`);
      }
    }
  }

  return plan;
}

export function detectCycles(skills: SkillNode[]): string[] | null {
  const slugSet = new Set(skills.map(skill => skill.slug));
  const adjacency = new Map<string, string[]>();
  for (const skill of skills) {
    adjacency.set(skill.slug, []);
  }
  for (const skill of skills) {
    for (const prereq of skill.prerequisites) {
      if (!slugSet.has(prereq)) continue;
      adjacency.get(prereq)!.push(skill.slug);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(slug: string): string[] | null {
    if (visiting.has(slug)) return [slug];
    if (visited.has(slug)) return null;
    visiting.add(slug);
    for (const next of adjacency.get(slug) ?? []) {
      const cycle = dfs(next);
      if (cycle) {
        cycle.unshift(slug);
        return cycle;
      }
    }
    visiting.delete(slug);
    visited.add(slug);
    return null;
  }

  for (const skill of skills) {
    const cycle = dfs(skill.slug);
    if (cycle) return cycle;
  }
  return null;
}

export function validateSkillGraph(graph: SkillGraph, plan?: CoursePlan): void {
  if (!graph.courseSlug || !SLUG_RE.test(graph.courseSlug)) {
    throw new Error('skill graph: invalid courseSlug');
  }
  if (!Array.isArray(graph.skills) || graph.skills.length === 0) {
    throw new Error('skill graph: skills must be a non-empty array');
  }

  const slugSet = new Set<string>();
  for (const skill of graph.skills) {
    if (!skill.slug || !SLUG_RE.test(skill.slug)) {
      throw new Error(`skill graph: invalid skill slug: ${skill.slug}`);
    }
    if (slugSet.has(skill.slug)) {
      throw new Error(`skill graph: duplicate skill slug: ${skill.slug}`);
    }
    slugSet.add(skill.slug);
  }

  for (const skill of graph.skills) {
    for (const prereq of skill.prerequisites) {
      if (!slugSet.has(prereq)) {
        throw new Error(`skill graph: ${skill.slug} references missing prerequisite: ${prereq}`);
      }
      if (prereq === skill.slug) {
        throw new Error(`skill graph: ${skill.slug} cannot depend on itself`);
      }
    }
    for (const target of skill.remediationTargets ?? []) {
      if (!slugSet.has(target)) {
        throw new Error(`skill graph: ${skill.slug} references missing remediation target: ${target}`);
      }
    }
    for (const target of skill.enrichmentTargets ?? []) {
      if (!slugSet.has(target)) {
        throw new Error(`skill graph: ${skill.slug} references missing enrichment target: ${target}`);
      }
    }
  }

  const cycle = detectCycles(graph.skills);
  if (cycle) {
    throw new Error(`skill graph: prerequisite cycle detected: ${cycle.join(' -> ')}`);
  }

  if (plan?.adaptivePath) {
    const planBySlug = new Map(flattenPlanLectures(plan).map(lecture => [lecture.slug, lecture]));
    for (const skill of graph.skills) {
      const lecture = planBySlug.get(skill.slug);
      if (!lecture) {
        throw new Error(`skill graph: skill ${skill.slug} has no matching lecture in plan`);
      }
      if (lecture.durationMinutes !== 2 && lecture.durationMinutes !== 3) {
        throw new Error(`skill graph: ${skill.slug} durationMinutes must be 2 or 3 for adaptive paths`);
      }
      if (lecture.review === true) {
        assertReviewNodeValid(lecture, `skill graph: ${skill.slug}`);
      } else if (!lecture.formats.includes('video') || !lecture.formats.includes('interactive')) {
        throw new Error(`skill graph: ${skill.slug} must include video and interactive for adaptive paths`);
      }
    }
  }

  if (!Array.isArray(graph.dependencies)) {
    throw new Error('skill graph: dependencies must be an array');
  }
  for (const dep of graph.dependencies) {
    if (!slugSet.has(dep.from) || !slugSet.has(dep.to)) {
      throw new Error(`skill graph: dependency references unknown skill: ${dep.from} -> ${dep.to}`);
    }
  }
}

export function flattenPlanLectures(plan: CoursePlan) {
  const rows: Array<PlannedLecture & { module: string; order: number }> = [];
  let order = 1;
  for (const module of plan.modules) {
    for (const lecture of module.lectures) {
      rows.push({ ...lecture, module: module.title, order: order++ });
    }
  }
  return rows;
}

export function initialCourseState(plan: CoursePlan, budgetUsd: number): CourseState {
  const now = new Date().toISOString();
  return {
    courseSlug: plan.slug,
    budgetUsd,
    spentUsd: 0,
    maxAttempts: 2,
    createdAt: now,
    updatedAt: now,
    lectures: flattenPlanLectures(plan).map(row => ({
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
      interactiveReview: 'not-required',
      interactiveReviewNotes: '',
      gameReview: 'not-required',
      gameReviewNotes: '',
      videoFrameReview: 'not-required',
      videoFrameReviewNotes: ''
    }))
  };
}
