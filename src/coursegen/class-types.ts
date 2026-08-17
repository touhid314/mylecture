import type { Audience, CoursePlanSource, LearningIntent } from './types.ts';
import { AUDIENCES, isLearningIntent, SLUG_RE } from './types.ts';

export type ClassPlanModule = {
  slug: string;
  title: string;
  summary?: string;
  /** Section ids from an ingested source manifest. */
  sourceSections?: string[];
  /** Optional chapter filter hint for ingest/planning. */
  chapters?: string;
};

export type ClassPlan = {
  title: string;
  slug: string;
  audience?: Audience;
  intent?: LearningIntent;
  summary: string;
  description: string;
  source?: CoursePlanSource;
  modules: ClassPlanModule[];
};

function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
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
    throw new Error(`source.slug: invalid slug "${slug}"`);
  }
  if (!title) throw new Error('source.title required when source is present');
  return { slug, title };
}

function validateModule(
  raw: unknown,
  path: string,
  knownSourceIds?: ReadonlySet<string>
): ClassPlanModule {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: module must be an object`);
  }
  const moduleObj = raw as Record<string, unknown>;
  const slug = String(moduleObj.slug || '').trim();
  const title = String(moduleObj.title || '').trim();
  const summary = String(moduleObj.summary || '').trim();
  const chapters = String(moduleObj.chapters || '').trim();

  if (!slug || !SLUG_RE.test(slug)) throw new Error(`${path}: invalid slug`);
  if (!title) throw new Error(`${path}: title required`);

  const sourceSections = validateSourceSections(
    moduleObj.sourceSections,
    `${path}.sourceSections`,
    knownSourceIds
  );

  const result: ClassPlanModule = { slug, title };
  if (summary) result.summary = summary;
  if (chapters) result.chapters = chapters;
  if (sourceSections) result.sourceSections = sourceSections;
  return result;
}

export function validateClassPlan(
  raw: unknown,
  options: { knownSourceSectionIds?: ReadonlySet<string> } = {}
): ClassPlan {
  if (!raw || typeof raw !== 'object') {
    throw new Error('class plan must be an object');
  }
  const plan = raw as Record<string, unknown>;
  const title = String(plan.title || '').trim();
  const slug = String(plan.slug || '').trim();
  const summary = String(plan.summary || '').trim();
  const description = String(plan.description || '').trim();
  const modulesRaw = plan.modules;
  const source = validateCoursePlanSource(plan.source);
  const audience = plan.audience;
  const intent = plan.intent;

  if (!title) throw new Error('title required');
  if (!slug || !SLUG_RE.test(slug)) throw new Error('invalid slug');
  if (audience !== undefined && audience !== null && !isAudience(audience)) {
    throw new Error('invalid audience');
  }
  if (intent !== undefined && intent !== null && !isLearningIntent(intent)) {
    throw new Error('invalid intent');
  }
  if (!summary) throw new Error('summary required');
  if (!description) throw new Error('description required');
  if (!Array.isArray(modulesRaw) || modulesRaw.length === 0) {
    throw new Error('modules must be a non-empty array');
  }

  const knownIds = options.knownSourceSectionIds;
  const seenSlugs = new Set<string>();
  const modules = modulesRaw.map((moduleRaw, index) => {
    const module = validateModule(moduleRaw, `modules[${index}]`, knownIds);
    if (seenSlugs.has(module.slug)) {
      throw new Error(`duplicate module slug: ${module.slug}`);
    }
    seenSlugs.add(module.slug);
    return module;
  });

  const result: ClassPlan = { title, slug, summary, description, modules };
  if (isAudience(audience)) result.audience = audience;
  if (isLearningIntent(intent)) result.intent = intent;
  if (source) result.source = source;
  return result;
}

export function moduleCourseSlug(classSlug: string, moduleSlug: string) {
  return `${classSlug}--${moduleSlug}`;
}
