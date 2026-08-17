import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CoursePlan, PlannedLecture } from './types.ts';
import { flattenPlanLectures } from './types.ts';
import { DEFAULT_LEARNING_INTENT } from './types.ts';
import { assertValidSourceSlug, readSourceManifest } from './source-manifest.ts';
import { getSourceDir } from './paths.ts';

export function formatGenerationLength(minutes: number) {
  const whole = Math.max(2, Math.min(10, Math.round(minutes)));
  return `${whole}:00`;
}

/** Structured API settings derived from the course plan. */
export function buildVideoGenerationSettings(
  _plan: CoursePlan,
  lecture: PlannedLecture
): {
  generationLength: string;
  aspectRatio: string;
  outputs: { video: true; interactive: boolean; game: boolean };
} {
  return {
    generationLength: formatGenerationLength(lecture.durationMinutes),
    aspectRatio: '16:9',
    outputs: {
      video: true,
      interactive: lecture.formats.includes('interactive'),
      game: lecture.formats.includes('game')
    }
  };
}

export function formatLectureSequenceContext(plan: CoursePlan, lecture: PlannedLecture) {
  const rows = flattenPlanLectures(plan);
  const index = rows.findIndex(row => row.slug === lecture.slug);
  if (index < 0) return '';

  const previous = rows[index - 1];
  const next = rows[index + 1];
  const lines = [
    'Course sequence context:',
    `- This is lecture ${index + 1} of ${rows.length}.`,
    previous ? `- Previous lecture: ${previous.title} (${previous.objective})` : '- This is the first lecture in the course.',
    next ? `- Next planned lecture: ${next.title} (${next.objective})` : '- No next lecture is currently planned.'
  ];
  const practiceFormats = lecture.formats.filter(format => format !== 'video');
  if (practiceFormats.length > 0) lines.push(`- Following practice formats: ${practiceFormats.join(', ')}.`);

  return lines.join('\n');
}

export function buildSourceGroundingBlock(
  sourceTitle: string,
  excerpts: Array<{ id: string; title: string; text: string }>
) {
  const lines = [
    '--- source grounding (authority) ---',
    `Source: ${sourceTitle}`,
    '',
    'Rules:',
    '- The source is the authority for facts, definitions, and notation. If your memory disagrees with the source, follow the source.',
    '- Preserve source notation and definitions exactly.',
    '- Adapt the material to the lecture objective instead of mirroring source headings or section order.',
    '',
    'Source excerpts for this lecture:'
  ];

  for (const excerpt of excerpts) {
    lines.push('');
    lines.push(`### ${excerpt.id}: ${excerpt.title}`);
    lines.push(excerpt.text.trim());
  }

  return lines.join('\n');
}

const MAX_GROUNDING_CHARS = 120_000;
/** Extra budget for grounding wrapper headers beyond excerpt body chars. */
const MAX_GROUNDING_BLOCK_CHARS = MAX_GROUNDING_CHARS + 4_000;

export type LectureGrounding = {
  block: string;
};

const TRUNCATION_MARKER = '\n\n[... truncated for context budget ...]';

function stripMarkdownHeading(text: string) {
  return text.replace(/^#\s+[^\n]*\n+/, '').trim();
}

/**
 * Shrink excerpt bodies so the joined text length (including truncation markers)
 * is ≤ maxChars. Uses a proportional first pass, then a greedy shrink loop.
 */
export function truncateProportionally(
  excerpts: Array<{ id: string; title: string; text: string }>,
  maxChars: number
): { excerpts: Array<{ id: string; title: string; text: string }>; truncated: boolean } {
  if (maxChars <= 0) {
    return {
      excerpts: excerpts.map(item => ({ ...item, text: TRUNCATION_MARKER.trim() })),
      truncated: true
    };
  }

  const total = excerpts.reduce((sum, item) => sum + item.text.length, 0);
  if (total <= maxChars) {
    return { excerpts, truncated: false };
  }

  const ratio = maxChars / total;
  let result = excerpts.map(item => {
    const keep = Math.max(0, Math.floor(item.text.length * ratio));
    if (keep >= item.text.length) return { ...item };
    const cut = item.text.slice(0, keep).trimEnd();
    return {
      ...item,
      text: cut ? `${cut}${TRUNCATION_MARKER}` : TRUNCATION_MARKER.trim()
    };
  });

  const joinedLength = (items: typeof result) => items.reduce((sum, item) => sum + item.text.length, 0);

  // Hard cap: markers can push past budget after the proportional pass.
  let guard = 0;
  while (joinedLength(result) > maxChars && guard < 64) {
    guard += 1;
    const overflow = joinedLength(result) - maxChars;
    const longestIdx = result.reduce(
      (best, item, index) => (item.text.length > result[best].text.length ? index : best),
      0
    );
    const longest = result[longestIdx];
    const markerLen = longest.text.endsWith(TRUNCATION_MARKER)
      ? TRUNCATION_MARKER.length
      : longest.text === TRUNCATION_MARKER.trim()
        ? TRUNCATION_MARKER.trim().length
        : 0;
    const bodyLen = longest.text.length - markerLen;
    if (bodyLen <= 0) {
      // Nothing left to cut on the longest; drop its body entirely and continue.
      if (longest.text.length === 0) break;
      result = result.map((item, index) =>
        index === longestIdx ? { ...item, text: TRUNCATION_MARKER.trim() } : item
      );
      continue;
    }
    const shrink = Math.max(1, Math.min(bodyLen, overflow + Math.ceil(overflow * 0.1)));
    const newBody = longest.text.slice(0, bodyLen - shrink).trimEnd();
    result = result.map((item, index) =>
      index === longestIdx
        ? {
            ...item,
            text: newBody ? `${newBody}${TRUNCATION_MARKER}` : TRUNCATION_MARKER.trim()
          }
        : item
    );
  }

  // Final safety: if still over (tiny budget vs many markers), truncate texts bluntly.
  if (joinedLength(result) > maxChars) {
    let remaining = maxChars;
    result = result.map(item => {
      if (remaining <= 0) return { ...item, text: '' };
      if (item.text.length <= remaining) {
        remaining -= item.text.length;
        return item;
      }
      const cut = item.text.slice(0, remaining);
      remaining = 0;
      return { ...item, text: cut };
    });
  }

  return { excerpts: result, truncated: true };
}

/**
 * Resolve section.file under sourceDir; reject absolute paths, `..`, and escapes.
 */
export function resolveContainedSourceFile(sourceDir: string, sectionFile: string): string {
  const raw = String(sectionFile || '').trim();
  if (!raw) {
    throw new Error('source section file path is empty');
  }
  if (path.isAbsolute(raw)) {
    throw new Error(`source section file must be relative (got absolute path: ${raw})`);
  }
  const parts = raw.split(/[/\\]/);
  if (parts.some(part => part === '..')) {
    throw new Error(`source section file must not contain "..": ${raw}`);
  }

  const resolvedSourceDir = path.resolve(sourceDir);
  const filePath = path.resolve(resolvedSourceDir, raw);
  const relative = path.relative(resolvedSourceDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `source section file escapes source directory: ${raw} (resolved ${filePath})`
    );
  }
  return filePath;
}

function capTextToBudget(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  console.warn(`  Warning: ${label} capped to ${maxChars} chars`);
  const keep = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  return `${text.slice(0, keep).trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * Load source section excerpts for a grounded lecture. Returns null when the
 * plan is not source-grounded. Throws when plan.source.slug is set but
 * sourceSections are missing/empty, the slug is invalid, or a section file
 * is missing (fail closed).
 */
export function loadLectureGrounding(
  plan: CoursePlan,
  lecture: { sourceSections?: string[] }
): LectureGrounding | null {
  if (!plan.source?.slug) return null;
  assertValidSourceSlug(plan.source.slug);

  const rawIds = lecture.sourceSections;
  if (!rawIds || rawIds.length === 0) {
    throw new Error(
      `source-grounded lecture requires non-empty sourceSections (source "${plan.source.slug}")`
    );
  }

  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const sectionIds: string[] = [];
  for (const id of rawIds) {
    const trimmed = String(id || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    sectionIds.push(trimmed);
  }
  if (sectionIds.length === 0) {
    throw new Error(
      `source-grounded lecture requires non-empty sourceSections (source "${plan.source.slug}")`
    );
  }

  const manifest = readSourceManifest(plan.source.slug);
  const byId = new Map(manifest.sections.map(section => [section.id, section]));
  const sourceDir = getSourceDir(plan.source.slug);

  const excerpts: Array<{ id: string; title: string; text: string }> = [];
  for (const id of sectionIds) {
    const section = byId.get(id);
    if (!section) {
      throw new Error(
        `Lecture references unknown source section "${id}" for source "${plan.source.slug}". ` +
          `Known ids: ${manifest.sections.map(s => s.id).join(', ') || '(none)'}`
      );
    }
    const filePath = resolveContainedSourceFile(sourceDir, section.file);
    if (!existsSync(filePath)) {
      throw new Error(
        `Missing source section file for "${id}": ${filePath}. Re-run ingest for source "${plan.source.slug}".`
      );
    }
    const raw = readFileSync(filePath, 'utf8');
    excerpts.push({
      id: section.id,
      title: section.title,
      text: stripMarkdownHeading(raw)
    });
  }

  const capped = truncateProportionally(excerpts, MAX_GROUNDING_CHARS);
  if (capped.truncated) {
    console.warn(
      `  Warning: source excerpts truncated to ~${MAX_GROUNDING_CHARS} chars for lecture grounding`
    );
  }

  let block = buildSourceGroundingBlock(plan.source.title || manifest.title, capped.excerpts);
  block = capTextToBudget(block, MAX_GROUNDING_BLOCK_CHARS, 'source grounding block');

  return { block };
}

export function buildVideoTaskMessage(
  plan: CoursePlan,
  lecture: PlannedLecture,
  moduleTitle: string,
  grounding?: string
) {
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const requestLines = [
    `Create a ${lecture.durationMinutes}-minute video lesson for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    `Requested learning outputs: ${lecture.formats.join(', ')}.`,
    formatLectureSequenceContext(plan, lecture),
    lecture.promptNotes ? `Course-planner notes: ${lecture.promptNotes}` : ''
  ];

  if (grounding) {
    requestLines.push('', grounding);
  }

  return requestLines.filter(Boolean).join('\n');
}

export function estimateCourseCostUsd(plan: CoursePlan) {
  let minutes = 0;
  let practiceAssets = 0;
  for (const module of plan.modules) {
    for (const lecture of module.lectures) {
      minutes += lecture.durationMinutes;
      if (lecture.formats.includes('interactive')) practiceAssets += 1;
      if (lecture.formats.includes('game')) practiceAssets += 1;
    }
  }
  return Math.max(1, Number((minutes * 0.35 + practiceAssets * 0.25 + 0.15).toFixed(2)));
}

export function printPlanSummary(plan: CoursePlan) {
  console.log(`\nCourse: ${plan.title} (${plan.slug})`);
  console.log(`Audience: ${plan.audience}`);
  console.log(`Intent: ${plan.intent ?? DEFAULT_LEARNING_INTENT}`);
  if (plan.source) {
    console.log(`Source: ${plan.source.title} (${plan.source.slug})`);
  }
  console.log(`Summary: ${plan.summary}`);
  console.log(`\nSyllabus:\n${plan.description}\n`);

  let order = 1;
  for (const module of plan.modules) {
    console.log(`  ${module.title}`);
    for (const lecture of module.lectures) {
      const formats = lecture.formats.join(', ');
      console.log(`    ${order}. ${lecture.title} (${lecture.durationMinutes} min, ${formats})`);
      console.log(`       Objective: ${lecture.objective}`);
      if (lecture.sourceSections && lecture.sourceSections.length > 0) {
        console.log(`       Source sections: ${lecture.sourceSections.join(', ')}`);
      }
      order += 1;
    }
  }
  console.log(`\nEstimated generation cost: ~$${estimateCourseCostUsd(plan).toFixed(2)} (rough)`);
}
