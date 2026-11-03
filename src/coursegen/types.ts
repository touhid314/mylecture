export const AUDIENCES = ['early', 'elementary', 'middle', 'general', 'undergraduate', 'graduate'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const LEARNING_INTENTS = ['foundation', 'academic', 'practice', 'exam', 'professional', 'exploration', 'teaching'] as const;
export type LearningIntent = (typeof LEARNING_INTENTS)[number];
export const DEFAULT_LEARNING_INTENT: LearningIntent = 'foundation';

export const LECTURE_FORMATS = ['video', 'interactive', 'game'] as const;
export type LectureFormat = (typeof LECTURE_FORMATS)[number];

export type PlannedLecture = {
  slug: string;
  title: string;
  objective: string;
  durationMinutes: number;
  formats: LectureFormat[];
  promptNotes: string;
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
};

export type LectureStatus =
  | 'pending'
  | 'generating'
  | 'resolving'
  | 'rendering'
  | 'done'
  | 'failed';

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

/** Lowercase hyphenated slug (courses, sources, lecture/activity ids). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

export function isLearningIntent(value: unknown): value is LearningIntent {
  return typeof value === 'string' && (LEARNING_INTENTS as readonly string[]).includes(value);
}

function isFormat(value: unknown): value is LectureFormat {
  return typeof value === 'string' && (LECTURE_FORMATS as readonly string[]).includes(value);
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
  const formats = Array.isArray(lecture.formats) ? lecture.formats.filter(isFormat) : [];
  const promptNotes = String(lecture.promptNotes || '').trim();

  if (!slug || !SLUG_RE.test(slug)) throw new Error(`${path}: invalid slug`);
  if (!title) throw new Error(`${path}: title required`);
  if (!objective) throw new Error(`${path}: objective required`);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 2 || durationMinutes > 15) {
    throw new Error(`${path}: durationMinutes must be 2-15`);
  }
  if (!formats.includes('video')) {
    throw new Error(`${path}: every lecture must include "video" in formats`);
  }

  const sourceSections = validateSourceSections(
    lecture.sourceSections,
    `${path}.sourceSections`,
    knownSourceIds
  );

  const result: PlannedLecture = { slug, title, objective, durationMinutes, formats, promptNotes };
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
  if (!slug || !SLUG_RE.test(slug)) throw new Error('invalid slug');
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
      mp4Path: ''
    }))
  };
}
