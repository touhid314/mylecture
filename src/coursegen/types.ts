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
};

export type PlannedLecture = {
  slug: string;
  title: string;
  objective: string;
  durationMinutes: number;
  formats: LectureFormat[];
  promptNotes: string;
  interactiveSpec?: InteractiveSpec;
  gameSpec?: GameSpec;
  /** Optional source section ids from an ingested textbook (e.g. "01-introduction"). */
  sourceSections?: string[];
};

export type PlannedModule = {
  title: string;
  lectures: PlannedLecture[];
};

export type CoursePlanSource = {
  slug: string;
  title: string;
};

export type CoursePlan = {
  title: string;
  slug: string;
  audience: Audience;
  intent: LearningIntent;
  summary: string;
  description: string;
  modules: PlannedModule[];
  /** Optional ingested textbook this plan is grounded in. */
  source?: CoursePlanSource;
  /** Parent class slug when this course is a module under a class plan. */
  classSlug?: string;
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

/** Lowercase hyphenated slug (sources, lecture/activity ids, class/module ids). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Course slugs: standalone `topic` or class-module `class--module`. */
export const COURSE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export const MAX_SPEC_LIST_ITEMS = 6;

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
  return values.slice(0, MAX_SPEC_LIST_ITEMS);
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

  return {
    id,
    title,
    mode,
    visibleSetup,
    learnerAction,
    controls,
    feedback,
    successCriterion
  };
}

export function validateInteractiveSpec(raw: unknown, path: string): InteractiveSpec {
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

export function validateGameSpec(raw: unknown, path: string): GameSpec {
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

  return {
    mission,
    visibleSetup,
    learnerAction,
    controls,
    feedback,
    successCriterion
  };
}

export function defaultInteractiveSpec(lecture: Pick<PlannedLecture, 'objective' | 'title'>): InteractiveSpec {
  const successCriterion = 'Answer 3 questions correctly';
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
        successCriterion
      }
    ]
  };
}

export function defaultGameSpec(lecture: Pick<PlannedLecture, 'objective'>): GameSpec {
  const successCriterion = `Score at least 70 out of 100 by applying: ${lecture.objective}`;
  return {
    mission: `Master the lesson objective through a scored challenge.`,
    visibleSetup: 'Show the challenge target, the current problem, the score, and the controls needed to answer before the first attempt.',
    learnerAction: `Apply the lesson objective in a sequence of scored challenges: ${lecture.objective}`,
    controls: ['Response controls', 'Check challenge', 'Next challenge', 'Restart challenge'],
    feedback: 'After each attempt, show correctness, the correct reasoning, and the updated score.',
    successCriterion
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

function validateSourceSections(
  raw: unknown,
  path: string,
  knownIds?: ReadonlySet<string>
): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${path}: sourceSections must be an array when present`);
  }
  if (raw.length === 0) {
    throw new Error(`${path}: sourceSections must be a non-empty array when present`);
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const id = String(raw[i] ?? '').trim();
    if (!id) {
      throw new Error(`${path}: sourceSections[${i}] must be a non-empty string`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    values.push(id);
  }
  if (knownIds) {
    for (const id of values) {
      if (!knownIds.has(id)) {
        throw new Error(`${path}: unknown sourceSections id "${id}"`);
      }
    }
  }
  return values;
}

function validateCoursePlanSource(raw: unknown): CoursePlanSource | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error('source must be an object when present');
  }
  const source = raw as Record<string, unknown>;
  const slug = String(source.slug || '').trim();
  const title = String(source.title || '').trim();
  if (!slug) throw new Error('source.slug required when source is present');
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `source.slug: invalid slug "${slug}" (expected lowercase hyphenated, e.g. my-textbook)`
    );
  }
  if (!title) throw new Error('source.title required when source is present');
  return { slug, title };
}

function validateLecture(
  raw: unknown,
  path: string,
  knownSourceIds?: ReadonlySet<string>
): PlannedLecture {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: lecture must be an object`);
  }
  const lecture = raw as Record<string, unknown>;
  const slug = String(lecture.slug || '').trim();
  const title = String(lecture.title || '').trim();
  const objective = String(lecture.objective || '').trim();
  const durationMinutes = Number(lecture.durationMinutes);
  const formats = Array.isArray(lecture.formats)
    ? lecture.formats
        .map(format => (format === 'practice' ? 'interactive' : format))
        .filter(isFormat)
    : [];
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

  const sourceSections = validateSourceSections(
    lecture.sourceSections,
    `${path}.sourceSections`,
    knownSourceIds
  );

  const result: PlannedLecture = { slug, title, objective, durationMinutes, formats, promptNotes };
  if (interactiveSpec) result.interactiveSpec = interactiveSpec;
  if (gameSpec) result.gameSpec = gameSpec;
  if (sourceSections) result.sourceSections = sourceSections;
  return result;
}

export function validateCoursePlan(
  raw: unknown,
  options: { maxLectures?: number; knownSourceSectionIds?: ReadonlySet<string> } = {}
): CoursePlan {
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
  const modulesRaw = plan.modules;
  const source = validateCoursePlanSource(plan.source);

  if (!title) throw new Error('title required');
  if (!slug || !COURSE_SLUG_RE.test(slug)) {
    throw new Error(`invalid slug "${slug}"`);
  }
  if (!isAudience(audience)) throw new Error('invalid audience');
  if (!isLearningIntent(intent)) throw new Error('invalid intent');
  if (!summary) throw new Error('summary required');
  if (!description) throw new Error('description required');
  if (!Array.isArray(modulesRaw) || modulesRaw.length === 0) {
    throw new Error('modules must be a non-empty array');
  }

  const knownIds = options.knownSourceSectionIds;
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
      const lecture = validateLecture(
        lectureRaw,
        `modules[${moduleIndex}].lectures[${lectureIndex}]`,
        knownIds
      );
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

  if (source && knownIds) {
    const missing: string[] = [];
    for (const module of modules) {
      for (const lecture of module.lectures) {
        if (!lecture.sourceSections || lecture.sourceSections.length === 0) {
          missing.push(lecture.slug);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `source-grounded plan requires every lecture to list ≥1 sourceSections. ` +
          `Missing for: ${missing.join(', ')}`
      );
    }
  }

  const result: CoursePlan = { title, slug, audience, intent, summary, description, modules };
  if (source) result.source = source;
  return result;
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
      gameReviewNotes: ''
    }))
  };
}
