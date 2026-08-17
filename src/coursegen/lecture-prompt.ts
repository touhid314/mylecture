import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Audience,
  CoursePlan,
  GameSpec,
  InteractiveSpec,
  LearningIntent,
  PlannedLecture
} from './types.ts';
import { flattenPlanLectures, resolveGameSpec, resolveInteractiveSpec } from './types.ts';
import { DEFAULT_LEARNING_INTENT } from './types.ts';
import { assertValidSourceSlug, readSourceManifest } from './source-manifest.ts';
import { getSourceDir } from './paths.ts';
const PROMPTS_DIR = path.join(import.meta.dirname, 'prompts');
const PROFILES_DIR = path.join(import.meta.dirname, 'profiles');

export const INTERACTIVE_PRACTICE_REL = 'activities/interactive/index.html' as const;
export const GAME_PRACTICE_REL = 'activities/game/index.html' as const;
export type PracticeHtmlRelPath = typeof INTERACTIVE_PRACTICE_REL | typeof GAME_PRACTICE_REL;

const AUDIENCE_PROFILE: Record<Audience, string> = {
  early: 'early.md',
  elementary: 'elementary.md',
  middle: 'middle.md',
  general: 'general.md',
  undergraduate: 'undergraduate.md',
  graduate: 'graduate.md'
};

const INTENT_PROFILE: Record<LearningIntent, string> = {
  foundation: 'foundation.md',
  academic: 'academic.md',
  practice: 'practice.md',
  exam: 'exam.md',
  professional: 'professional.md',
  exploration: 'exploration.md',
  teaching: 'teaching.md'
};

export function loadProfileContent(audience: Audience, intent: LearningIntent = DEFAULT_LEARNING_INTENT) {
  const fileName = AUDIENCE_PROFILE[audience];
  const intentFileName = INTENT_PROFILE[intent];
  const audienceFilePath = path.join(PROFILES_DIR, 'audience', fileName);
  const intentFilePath = path.join(PROFILES_DIR, 'intent', intentFileName);
  return [
    readFileSync(audienceFilePath, 'utf8').trim(),
    readFileSync(intentFilePath, 'utf8').trim()
  ].join('\n\n');
}

/** Split coursegen audience/intent profile into LectureGen theme + teaching style fields. */
export function splitCourseProfile(profileContent: string): { theme: string; teachingStyle: string } {
  const text = String(profileContent || '');
  const teachingMatch = text.match(/(?:^|\n)teaching style:\s*/i);
  if (!teachingMatch || teachingMatch.index == null) {
    return { theme: text.trim(), teachingStyle: '' };
  }
  const labelStart = teachingMatch.index + (text[teachingMatch.index] === '\n' ? 1 : 0);
  const colon = text.indexOf(':', labelStart);
  return {
    theme: text.slice(0, labelStart).trim(),
    teachingStyle: text.slice(colon + 1).trim()
  };
}

export function formatGenerationLength(minutes: number) {
  const whole = Math.max(2, Math.min(10, Math.round(minutes)));
  return `${whole}:00`;
}

/** Typed LectureGen settings derived from a planned lecture (CLI / spawn source of truth). */
export function buildVideoGenerationSettings(
  plan: CoursePlan,
  lecture: PlannedLecture
): {
  generationLength: string;
  aspectRatio: string;
  theme: string;
  teachingStyle: string;
} {
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const { theme, teachingStyle } = splitCourseProfile(loadProfileContent(plan.audience, intent));
  return {
    generationLength: formatGenerationLength(lecture.durationMinutes),
    aspectRatio: '16:9',
    theme,
    teachingStyle
  };
}

function loadPromptFile(name: string) {
  return readFileSync(path.join(PROMPTS_DIR, name), 'utf8').trim();
}

const SCRIPT_CRAFT = loadPromptFile('script-craft.md');

export function formatLectureSequenceContext(plan: CoursePlan, lecture: PlannedLecture) {
  const rows = flattenPlanLectures(plan);
  const index = rows.findIndex(row => row.slug === lecture.slug);
  if (index < 0) return '';

  const previous = rows[index - 1];
  const next = rows[index + 1];
  const lines = [
    'Internal course sequence context (for planning only; do not mention this metadata to learners):',
    `- This is lecture ${index + 1} of ${rows.length}.`,
    previous ? `- Previous lecture: ${previous.title} (${previous.objective})` : '- This is the first lecture in the course.',
    next ? `- Next planned lecture: ${next.title} (${next.objective})` : '- No next lecture is currently planned.'
  ];

  if (!next) {
    lines.push('- Because this is currently the last planned lecture, end by closing the current lesson cleanly while remaining valid if the course is extended later. Do not say "final lecture", "finished the course", "completed the course", "next lecture", "up next", or leave a dangling practice prompt after the conclusion.');
  } else {
    lines.push('- The ending may gently prepare the learner for the next idea, but do not say the lesson number or make the course sequence metadata explicit.');
  }

  if (lecture.formats.includes('interactive') || lecture.formats.includes('game')) {
    lines.push('- If practice follows this video, mention it only as a natural next action before the final closing beat, not as a stray command after the conclusion.');
  }

  return lines.join('\n');
}

export function formatInteractiveSpec(spec: InteractiveSpec) {
  const lines = spec.activities.map((activity, index) => {
    return [
      `  Activity ${index + 1} (${activity.id}): "${activity.title}"`,
      `    mode: ${activity.mode}`,
      `    visibleSetup: ${activity.visibleSetup || 'Show the learner what to look at, what to do first, and where progress is tracked.'}`,
      `    learnerAction: ${activity.learnerAction}`,
      `    controls: ${(activity.controls && activity.controls.length > 0 ? activity.controls : ['response control', 'check answer button', 'next button']).join('; ')}`,
      `    feedback: ${activity.feedback || 'After submit, show correctness, a useful hint or explanation, and the next step.'}`,
      `    successCriterion: ${activity.successCriterion}`
    ].join('\n');
  });
  return lines.join('\n');
}

export function formatGameSpec(spec: GameSpec) {
  return [
    `mission: ${spec.mission}`,
    `visibleSetup: ${spec.visibleSetup || 'Show the mission, current challenge, score target, and all needed controls before play starts.'}`,
    `learnerAction: ${spec.learnerAction || 'Complete scored challenges that directly practice the lesson objective.'}`,
    `controls: ${(spec.controls && spec.controls.length > 0 ? spec.controls : ['response control', 'check challenge button', 'next challenge button', 'restart button']).join('; ')}`,
    `feedback: ${spec.feedback || 'After each attempt, show correctness, reasoning, score change, and the next step.'}`,
    `successCriterion: ${spec.successCriterion}`
  ].join('\n');
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
    '- The lecture is a teaching performance, not a summary. Build your own teaching arc (hook, worked example, formalism). Do not walk the source section-by-section or reuse its headings as the lecture structure.',
    '- Use source notation and definitions exactly. Put exact notation in visuals; let narration say what the symbols mean and why they matter.',
    '- Do not copy source sentences into narration.',
    '- For derivations: pay motivation once at the top, then keep tight WHY-chains for each step.',
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
const MAX_REVIEW_SOURCE_CHARS = 60_000;
/** Extra budget for grounding wrapper headers beyond excerpt body chars. */
const MAX_GROUNDING_BLOCK_CHARS = MAX_GROUNDING_CHARS + 4_000;

export type LectureGrounding = {
  block: string;
  reviewContext: string;
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

  const reviewCapped = truncateProportionally(capped.excerpts, MAX_REVIEW_SOURCE_CHARS);
  let reviewContext = reviewCapped.excerpts
    .map(item => `### ${item.id}: ${item.title}\n${item.text}`)
    .join('\n\n');
  reviewContext = capTextToBudget(reviewContext, MAX_REVIEW_SOURCE_CHARS, 'review source context');

  return { block, reviewContext };
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
    formatLectureSequenceContext(plan, lecture),
    lecture.promptNotes ? `Notes: ${lecture.promptNotes}` : '',
    '',
    'render frame: fill the whole 16:9 stage. Prefer a responsive full-viewport root (`html`, `body`, and the main stage at `width: 100vw; height: 100vh`) or a fixed 1920x1080 stage. Do not hard-code a smaller 1280x720 stage unless every visual element scales to fill the export viewport.',
    '',
    'Course lesson structure:',
    '- Open with a concrete question, problem, or motivating example that makes the learning objective feel useful.',
    '- Spend the first minute orienting the learner: the relevant background, the stakes of the problem, and the obstacle this lecture resolves.',
    '- State what the learner will be able to do, then teach through one clear sequence of explanation, example, and consequence.',
    '- Keep the lesson aligned to the single objective; avoid attention-grabbing detours, broad surveys, or tangents that do not support the objective.',
    '- Make visuals carry the story: update the scene when the reasoning advances, reveal assumptions as they matter, and compare before/after states.',
    '- End with a short takeaway that names the skill the learner can now practice.',
    '',
    'Before writing HTML, write `script.md` using this shared script craft guide. Then build the video from that script:',
    SCRIPT_CRAFT
  ];

  if (grounding) {
    requestLines.push('', grounding);
  }

  requestLines.push(
    '',
    'Create only the video lecture (index.html and assets). Do NOT create any interactive practice or game files (no interactive.html, game.html, or anything under activities/) - those are generated in a separate pass.'
  );

  return requestLines.filter(line => line !== '').join('\n');
}

export function buildInteractiveTaskMessage(
  plan: CoursePlan,
  lecture: PlannedLecture,
  moduleTitle: string,
  videoIndexPath: string
) {
  const spec = resolveInteractiveSpec(lecture);
  if (!spec) {
    throw new Error(`Lecture ${lecture.slug} has no interactive spec`);
  }
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);

  return [
    `Create the interactive practice for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    lecture.promptNotes ? `Notes: ${lecture.promptNotes}` : '',
    '',
    'The video lesson already exists in this workspace. Match its topic and terminology.',
    `Video file: ${path.basename(videoIndexPath)}`,
    '',
    'Follow iagen_system.md: build a playground / step-through interaction, not a quiz.',
    'Implement the interactiveSpec below as the interaction design.',
    '',
    '--- interactiveSpec (implement exactly these activities) ---',
    formatInteractiveSpec(spec),
    '',
    `profile: ${profileContent}`,
    '',
    'LectureGen writes interactive.html at the workspace root. Do not modify the video index file.'
  ].join('\n');
}

export function buildGameTaskMessage(
  plan: CoursePlan,
  lecture: PlannedLecture,
  moduleTitle: string,
  videoIndexPath: string
) {
  const spec = resolveGameSpec(lecture);
  if (!spec) {
    throw new Error(`Lecture ${lecture.slug} has no game spec`);
  }
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);

  return [
    `Create the game practice for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    '',
    'The video lesson already exists in this workspace. Match its topic and terminology.',
    `Video file: ${path.basename(videoIndexPath)}`,
    '',
    'Follow gamegen_system.md: challenge-mode game with a brief start overlay or intro card, score out of 100, and a clear win condition.',
    '',
    '--- game spec ---',
    formatGameSpec(spec),
    '',
    `profile: ${profileContent}`,
    '',
    'LectureGen writes game.html at the workspace root. Do not modify the video index file.'
  ].join('\n');
}

export type HtmlEditTarget = 'video' | 'interactive' | 'game';

export function buildHtmlEditTaskMessage(options: {
  target: HtmlEditTarget;
  prompt: string;
  objective: string;
  title: string;
}) {
  const targetFile =
    options.target === 'video'
      ? 'index.html or indexN.html'
      : options.target === 'interactive'
        ? 'interactive.html'
        : 'game.html';
  const scopeLines =
    options.target === 'video'
      ? [
          'Edit the existing video lecture HTML only (index.html / indexN.html).',
          'Do NOT create or modify interactive.html, game.html, or anything under activities/.'
        ]
      : options.target === 'interactive'
        ? ['Edit interactive.html only.', 'Do NOT modify index*.html, game.html, or activities/.']
        : ['Edit game.html only.', 'Do NOT modify index*.html, interactive.html, or activities/.'];

  return [
    `Edit the existing ${options.target} HTML for this lecture.`,
    `Lecture: ${options.title}`,
    `Learning objective: ${options.objective}`,
    '',
    'Apply the requested change to the current page. Do not regenerate the lesson from scratch.',
    `Target file: ${targetFile}`,
    '',
    ...scopeLines,
    '',
    'User instruction:',
    options.prompt.trim()
  ].join('\n');
}

export function buildPracticeRepairMessage(options: {
  fileName: PracticeHtmlRelPath;
  objective: string;
  findings: string[];
  specText: string;
}) {
  return [
    `Fix ${options.fileName} based on QA review findings.`,
    `Learning objective: ${options.objective}`,
    '',
    'Follow iagen_system.md for interactives or gamegen_system.md for games. Fix the findings without breaking the interaction design.',
    '',
    '--- findings to fix ---',
    ...options.findings.map(finding => `- ${finding}`),
    '',
    '--- activity spec ---',
    options.specText,
    '',
    'LectureGen writes interactive.html or game.html at the workspace root. Do not change the video index file.'
  ].join('\n');
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
      const interactiveSpec = resolveInteractiveSpec(lecture);
      if (interactiveSpec) {
        const modes = interactiveSpec.activities.map(a => a.mode).join(', ');
        console.log(`       Interactive: ${interactiveSpec.activities.length} activity/ies (${modes})`);
      }
      order += 1;
    }
  }
  console.log(`\nEstimated generation cost: ~$${estimateCourseCostUsd(plan).toFixed(2)} (rough)`);
}
