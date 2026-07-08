import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Audience, CoursePlan, GameSpec, InteractiveSpec, LearningIntent, PlannedLecture } from './types.ts';
import { flattenPlanLectures, resolveGameSpec, resolveInteractiveSpec } from './types.ts';
import { DEFAULT_LEARNING_INTENT } from './types.ts';
import { formatPracticeRepairContext } from './practice-repair-context.ts';
import {
  buildActivityShellConfig,
  toRuntimeActivityShellConfig,
  GAME_STAGE_CSS_REL,
  GAME_STAGE_REL,
  INTERACTIVE_STAGE_CSS_REL,
  INTERACTIVE_STAGE_REL
} from './activity-shell/assemble.ts';

const PROMPTS_DIR = path.join(import.meta.dirname, 'prompts');
const PROFILES_DIR = path.join(import.meta.dirname, 'profiles');

export const INTERACTIVE_PRACTICE_REL = 'activities/interactive/index.html' as const;
export const GAME_PRACTICE_REL = 'activities/game/index.html' as const;
export { INTERACTIVE_STAGE_REL, INTERACTIVE_STAGE_CSS_REL, GAME_STAGE_REL, GAME_STAGE_CSS_REL };
export type PracticeHtmlRelPath = typeof INTERACTIVE_PRACTICE_REL | typeof GAME_PRACTICE_REL;
export type PracticeStageRelPath = typeof INTERACTIVE_STAGE_REL | typeof GAME_STAGE_REL;

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

function loadPromptFile(name: string) {
  return readFileSync(path.join(PROMPTS_DIR, name), 'utf8').trim();
}

function formatDuration(minutes: number) {
  const whole = Math.max(2, Math.min(10, Math.round(minutes)));
  return `${whole}:00`;
}

const SCRIPT_CRAFT = loadPromptFile('script-craft.md');

/** Default agent turn cap for practice/game generation (overridable via --max-practice-turns). */
export const DEFAULT_MAX_PRACTICE_TURNS = 40;
export const DEFAULT_ADAPTIVE_MAX_PRACTICE_TURNS = 12;

/** Tighter cap for QA-driven repair passes (targeted edits, not full rewrites). */
export const DEFAULT_MAX_PRACTICE_REPAIR_TURNS = 15;
export const DEFAULT_ADAPTIVE_MAX_PRACTICE_REPAIR_TURNS = 18;

export function defaultMaxPracticeTurns(plan: CoursePlan, override?: number) {
  if (override !== undefined) return override;
  return plan.adaptivePath === true ? DEFAULT_ADAPTIVE_MAX_PRACTICE_TURNS : DEFAULT_MAX_PRACTICE_TURNS;
}

export function defaultMaxPracticeRepairTurns(plan: CoursePlan, override?: number) {
  if (override !== undefined) return override;
  return plan.adaptivePath === true ? DEFAULT_ADAPTIVE_MAX_PRACTICE_REPAIR_TURNS : DEFAULT_MAX_PRACTICE_REPAIR_TURNS;
}

const ADAPTIVE_VIDEO_AGENT_WORKFLOW = [
  'Agent workflow (mandatory):',
  '- The lecture-agent system CORE RULE (divide-and-conquer into index1.html, index2.html, …) is **overridden** for this task: write script.md and the full video in a **single** index.html only.',
  '- Do not create index2.html or additional scene files for a 2–3 minute node.',
  '- Size the stage so it fills the export viewport: `html, body { width: 100%; height: 100%; overflow: hidden }` and the stage root at `width: 100vw; height: 100vh` (or exactly 1920x1080). NEVER fit a fixed smaller stage with `transform: scale(calc(...))` — length ratios are invalid inside scale() and the transform silently fails, leaving the stage small in the top-left corner.',
  '- Contract footguns: `narration+visual` segments must have `{ id, kind, audio, text }` only — never declare `duration` on narration+visual (timing is derived from audio). `visual-only` may use `duration`.',
  '- No horizontal overflow past the viewport; the stage must fill 100vw/100vh with no letterboxing.',
  '- Composition: avoid stacking competing absolute panels in the same region; keep clear header / main / footer zones. When an overlay points at a target, position it by measuring the target (getBoundingClientRect) — do not guess percentages. One value→pixel mapper per axis/diagram (ticks, arrows, markers share it).',
  '- __RENDER_SECTION__ must be stateless: the player seeks and replays arbitrary (segment, time) pairs, so every call must first rebuild/reset any DOM content that other segments mutate (innerHTML swaps, emptied spans, appended nodes) before applying its own state. Never assume the previous segment ran.',
  '- After index.html writes successfully, do ONE targeted layout check: stage fills the viewport, no scale(calc()), no overlapping competing panels, no content outside the frame. Fix if wrong, then reply done. Do not do broad polish passes or re-read the whole file.'
].join('\n');

const STAGE_AUTHORING_SPEC = loadPromptFile('stage-authoring.md');
const PRACTICE_REPAIR_RULES = loadPromptFile('practice-repair-rules.md');
const STAGE_REPAIR_RULES = loadPromptFile('stage-repair-rules.md');

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

export function formatAdaptiveSkillContext(plan: CoursePlan, lecture: PlannedLecture) {
  const rows = flattenPlanLectures(plan);
  const bySlug = new Map(rows.map(row => [row.slug, row]));
  const prerequisites = lecture.prerequisites ?? [];
  const prerequisiteTitles = prerequisites.map(slug => {
    const prereq = bySlug.get(slug);
    return prereq ? `${prereq.title} (${slug})` : slug;
  });

  const lines = [
    'Internal adaptive skill-node context (for planning only; do not mention this metadata to learners):',
    '- This lesson is a portable skill node inside a graph with a recommended route, not an episode in a fixed sequence.',
    '- The learner may reach this node after a diagnostic, a remediation detour, a review session, or the recommended route.',
    '- Do not say "previous lesson", "next lesson", "earlier in the course", "later in the course", or anything that assumes a fixed path.',
    prerequisites.length > 0
      ? `- Direct prerequisites: ${prerequisiteTitles.join('; ')}. Assume only these prerequisite ideas, and briefly re-anchor any notation needed from them.`
      : '- Entry skill: assume no prior nodes from this path.',
    lecture.assumes?.length ? `- Assumes: ${lecture.assumes.join('; ')}` : '',
    lecture.teaches?.length ? `- Teaches: ${lecture.teaches.join('; ')}` : '',
    lecture.commonMistakes?.length ? `- Common mistakes to anticipate: ${lecture.commonMistakes.join('; ')}` : '',
    lecture.remediationTargets?.length ? `- If the learner struggles, likely remediation targets: ${lecture.remediationTargets.join('; ')}` : '',
    lecture.enrichmentTargets?.length ? `- After mastery, sensible enrichment targets: ${lecture.enrichmentTargets.join('; ')}` : '',
    '- End by naming the practice move this node prepares, without pointing to a specific next lesson.'
  ];

  return lines.filter(Boolean).join('\n');
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
    `successCriterion: ${spec.successCriterion}`,
    `pacing: ${spec.pacing ?? 'steady'} (use ctx.activity.timer from the shell config — never invent raw seconds)`
  ].join('\n');
}

export function formatSectionSkillsForReview(plan: CoursePlan, lecture: PlannedLecture): string {
  const rows = flattenPlanLectures(plan);
  const bySlug = new Map(rows.map(row => [row.slug, row]));
  const prerequisites = lecture.prerequisites ?? [];
  const lines = prerequisites.map(slug => {
    const node = bySlug.get(slug);
    if (!node) return `- ${slug}`;
    const teaches = node.teaches?.length ? `; teaches: ${node.teaches.join('; ')}` : '';
    return `- ${node.title} (${slug}): ${node.objective}${teaches}`;
  });
  return [
    'Section skills to cover (the game must sample ALL of these):',
    ...lines
  ].join('\n');
}

export function buildVideoTaskMessage(plan: CoursePlan, lecture: PlannedLecture, moduleTitle: string) {
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);
  const adaptivePath = plan.adaptivePath === true;
  const isReviewNode = adaptivePath && lecture.review === true;
  const lessonStructure = isReviewNode
    ? [
        'Adaptive section review video structure:',
        '- Build this as a 2-minute recap video in a single index.html only.',
        '- Quickly reactivate EACH prerequisite skill from this section — one worked micro-example per skill where feasible.',
        '- Keep pacing brisk; this is consolidation, not first teaching.',
        '- End by pointing the learner at the section review game that follows.',
        ADAPTIVE_VIDEO_AGENT_WORKFLOW
      ]
    : adaptivePath
    ? [
        'Adaptive micro-lesson structure:',
        '- Build this as a lightweight 2-3 minute mobile-like primer, not a full course lecture.',
        '- Build the whole lesson as ONE scene in a single index.html; do not split a 2-3 minute lesson into multiple index files or scenes.',
        '- Open with one concrete problem or misconception in the first 10-15 seconds.',
        '- Teach only the smallest useful idea needed for the practice that follows.',
        '- Use one worked example or visual transformation; avoid broad background, extended analogies, or multi-part surveys.',
        '- Keep on-screen text sparse and touch-readable; the video should feel like the first step of an active session.',
        '- End by naming the exact practice move the learner is ready to try.',
        ADAPTIVE_VIDEO_AGENT_WORKFLOW
      ]
    : [
        'Course lesson structure:',
        '- Open with a concrete question, problem, or motivating example that makes the learning objective feel useful.',
        '- Spend the first minute orienting the learner: the relevant background, the stakes of the problem, and the obstacle this lecture resolves.',
        '- State what the learner will be able to do, then teach through one clear sequence of explanation, example, and consequence.',
        '- Keep the lesson aligned to the single objective; avoid attention-grabbing detours, broad surveys, or tangents that do not support the objective.',
        '- Make visuals carry the story: update the scene when the reasoning advances, reveal assumptions as they matter, and compare before/after states.',
        '- End with a short takeaway that names the skill the learner can now practice.'
      ];
  const lines = [
    `Create a ${lecture.durationMinutes}-minute video lesson for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    adaptivePath ? formatAdaptiveSkillContext(plan, lecture) : formatLectureSequenceContext(plan, lecture),
    lecture.promptNotes ? `Notes: ${lecture.promptNotes}` : '',
    '',
    'if the user query is for video generation then follow this:',
    'aspect ratio: 16:9',
    'render frame: fill the whole 16:9 stage. Prefer a responsive full-viewport root (`html`, `body`, and the main stage at `width: 100vw; height: 100vh`) or a fixed 1920x1080 stage. Do not hard-code a smaller 1280x720 stage unless every visual element scales to fill the export viewport.',
    `generation length: ${formatDuration(lecture.durationMinutes)}`,
    'embed subtitle in video: no',
    `profile: ${profileContent}`,
    '',
    ...lessonStructure,
    '',
    'Before writing HTML, write `script.md` using this shared script craft guide. Then build the video from that script:',
    SCRIPT_CRAFT,
    '',
    'Overlay alignment: any highlight box, bracket, arrow, or label that points at another element must be positioned by measuring the target with getBoundingClientRect() inside the render function - never hard-coded percentages or guessed pixel offsets, which drift out of alignment. For number lines, axes, and timelines: compute every tick, arrow endpoint, and marker position from ONE shared value-to-pixel mapping function.',
    '',
    'Create only the video lecture (index.html and assets). Do NOT create any interactive practice or game files (no interactive.html, game.html, or anything under activities/) - those are generated in a separate pass.'
  ].filter(line => line !== '');

  return lines.join('\n');
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
  const adaptive = plan.adaptivePath === true;
  const practiceSpec = adaptive
    ? STAGE_AUTHORING_SPEC
    : loadPromptFile('interactive-practice.md');
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);
  const shellConfig = adaptive
    ? buildActivityShellConfig('interactive', spec, { title: lecture.title, objective: lecture.objective })
    : null;

  return [
    adaptive
      ? `Create the interactive practice stage at ${INTERACTIVE_STAGE_REL} for the course "${plan.title}".`
      : `Create the interactive practice page at ${INTERACTIVE_PRACTICE_REL} for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    lecture.promptNotes ? `Notes: ${lecture.promptNotes}` : '',
    adaptive
      ? 'Adaptive skill-node rule: this practice must stand alone for this exact skill. Do not reference previous/next lessons or require course context beyond the listed prerequisite ideas.'
      : '',
    adaptive
      ? [
          'A stage.js scaffold already exists with registerStage() stubs for every activity id.',
          'Edit or replace the stubs via `edits` or `write` — keep registerStage() and the listed activity ids.',
          'Do not rebuild shell chrome (tabs, score, streak, progress, feedback banners).',
          'Do not add `.game-hud`, score panels, streak counters, goal text, or duplicate progress UI.'
        ].join('\n')
      : '',
    '',
    'The video lesson already exists in this workspace. Match its topic and terminology.',
    `Video file: ${path.basename(videoIndexPath)}`,
    '',
    adaptive
      ? '--- stage authoring spec (mandatory) ---'
      : '--- interactive-practice spec (mandatory) ---',
    practiceSpec,
    '',
    '--- interactiveSpec (implement exactly these activities) ---',
    formatInteractiveSpec(spec),
    adaptive && shellConfig
      ? [
          '',
          '--- activity shell config (register every activity id below) ---',
          JSON.stringify(toRuntimeActivityShellConfig(shellConfig), null, 2)
        ].join('\n')
      : '',
    '',
    `profile: ${profileContent}`,
    '',
    adaptive
      ? `Output ${INTERACTIVE_STAGE_REL} only (optional ${INTERACTIVE_STAGE_CSS_REL}). Do not write index.html — the build system assembles it. Do not modify the video index file.`
      : `Output ${INTERACTIVE_PRACTICE_REL} only. Do not modify the video index file.`
  ].filter(line => line !== '').join('\n');
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
  const adaptive = plan.adaptivePath === true;
  const practiceSpec = adaptive
    ? STAGE_AUTHORING_SPEC
    : loadPromptFile('interactive-practice.md');
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);
  const shellConfig = adaptive
    ? buildActivityShellConfig('game', spec, { title: lecture.title, objective: lecture.objective })
    : null;

  return [
    adaptive
      ? `Create the game practice stage at ${GAME_STAGE_REL} for the course "${plan.title}".`
      : `Create the game practice page at ${GAME_PRACTICE_REL} for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    adaptive
      ? [
          lecture.review === true ? formatSectionSkillsForReview(plan, lecture) : '',
          'Adaptive skill-node rule: this game must work as a portable review/challenge for the listed prerequisite graph. Do not reference previous/next lessons or a fixed course sequence.',
          'A stage.js scaffold already exists with registerStage() stubs for every activity id.',
          'Edit or replace the stubs via `edits` or `write` — keep registerStage() and the listed activity ids.',
          'Do not rebuild shell chrome (tabs, score, streak, progress, feedback banners).',
          'Do not add `.game-hud`, score panels, streak counters, goal text, or duplicate progress UI.'
        ].filter(Boolean).join('\n')
      : '',
    '',
    'The video lesson already exists in this workspace. Match its topic and terminology.',
    `Video file: ${path.basename(videoIndexPath)}`,
    '',
    '--- game spec ---',
    formatGameSpec(spec),
    '',
    adaptive
      ? '--- stage authoring spec (challenge mode) ---'
      : 'Use challenge mode rules from the practice spec (brief start overlay or intro card, score out of 100, clear win condition).',
    practiceSpec,
    adaptive && shellConfig
      ? [
          '',
          '--- activity shell config ---',
          JSON.stringify(toRuntimeActivityShellConfig(shellConfig), null, 2)
        ].join('\n')
      : '',
    '',
    `profile: ${profileContent}`,
    '',
    adaptive
      ? `Output ${GAME_STAGE_REL} only (optional ${GAME_STAGE_CSS_REL}). Do not write index.html — the build system assembles it. Do not modify the video index file.`
      : `Output ${GAME_PRACTICE_REL} only. Do not modify the video index file.`
  ].filter(line => line !== '').join('\n');
}

export function buildPracticeRepairMessage(options: {
  fileName: PracticeHtmlRelPath;
  objective: string;
  findings: string[];
  specText: string;
  htmlPath: string;
  maxTurns: number;
  adaptive?: boolean;
  shellBased?: boolean;
  stageRel?: PracticeStageRelPath;
  stagePath?: string;
  kind?: 'interactive' | 'game';
  spec?: InteractiveSpec | GameSpec;
  title?: string;
}) {
  if (options.shellBased && options.stageRel) {
    const shellConfig = options.kind && options.spec && options.title
      ? buildActivityShellConfig(options.kind, options.spec, {
          title: options.title,
          objective: options.objective
        })
      : null;
    return [
      `Fix ${options.stageRel} based on QA review findings.`,
      `Learning objective: ${options.objective}`,
      options.stagePath ? `Stage file: ${options.stageRel} (read the full file at ${options.stageRel})` : '',
      '',
      '--- findings to fix ---',
      ...options.findings.map(finding => `- ${finding}`),
      '',
      '--- stage repair rules ---',
      STAGE_REPAIR_RULES,
      '',
      shellConfig
        ? ['--- activity shell config ---', JSON.stringify({
            title: shellConfig.title,
            activities: shellConfig.activities
          }, null, 2)].join('\n')
        : '',
      '',
      '--- activity spec ---',
      options.specText,
      '',
      `Edit ${options.stageRel} only. Do not change the video index file or index.html.`
    ].filter(Boolean).join('\n');
  }

  const repairContext = formatPracticeRepairContext(options.htmlPath, options.maxTurns);
  const mobileFindings = options.findings.some(finding =>
    /phone|mobile|390|844|viewport|responsive|overflow|scroll|clipping|squeez|crowd|page flow|desktop board/i.test(finding)
  );
  const adaptiveMobileRepair = options.adaptive && mobileFindings
    ? [
        '--- adaptive mobile repair mode ---',
        'The QA finding is about phone/mobile layout. Do not merely shrink fonts, reduce padding, or hide random elements.',
        'If the current page is a desktop-style board, list, table, matching workspace, or multi-question panel, add/repair a mobile-only paged flow instead.',
        'At phone width, render one current prompt/question/challenge at a time with compact progress, one answer control cluster, feedback, and a clear Check/Next action.',
        'Desktop may keep its existing richer layout. Prefer adding a small mobile branch/state (`currentQuestionIndex`, `renderMobileQuestion`, or equivalent) over refactoring every desktop component.',
        'For large files, do not read every section. Read only the layout CSS, the main render function/current question data, and the action/check handler, then patch those regions.',
        'A focused structural mobile patch is allowed when it fixes the QA finding; this is not an unrelated refactor.'
      ].join('\n')
    : '';
  return [
    `Fix ${options.fileName} based on QA review findings.`,
    `Learning objective: ${options.objective}`,
    '',
    '--- findings to fix ---',
    ...options.findings.map(finding => `- ${finding}`),
    '',
    adaptiveMobileRepair,
    '',
    repairContext,
    '',
    '--- activity spec ---',
    options.specText,
    '',
    '--- practice repair rules ---',
    PRACTICE_REPAIR_RULES,
    '',
    `Edit ${options.fileName} only. Do not change the video index file.`
  ].filter(Boolean).join('\n');
}

type LectureCostRow = { durationMinutes: number; formats: string[] };

export function estimateLecturesCostUsd(lectures: LectureCostRow[]) {
  let minutes = 0;
  let practiceAssets = 0;
  for (const lecture of lectures) {
    minutes += lecture.durationMinutes;
    if (lecture.formats.includes('interactive')) practiceAssets += 1;
    if (lecture.formats.includes('game')) practiceAssets += 1;
  }
  return Math.max(1, Number((minutes * 0.35 + practiceAssets * 0.25 + 0.15).toFixed(2)));
}

export function estimateCourseCostUsd(plan: CoursePlan) {
  return estimateLecturesCostUsd(flattenPlanLectures(plan));
}

export function printPlanSummary(plan: CoursePlan) {
  const unitLabel = plan.adaptivePath ? 'Node' : 'Lecture';
  console.log(`\nCourse: ${plan.title} (${plan.slug})`);
  console.log(`Audience: ${plan.audience}`);
  console.log(`Intent: ${plan.intent ?? DEFAULT_LEARNING_INTENT}`);
  console.log(`Summary: ${plan.summary}`);
  console.log(`\nSyllabus:\n${plan.description}\n`);

  let order = 1;
  for (const module of plan.modules) {
    console.log(`  ${module.title}`);
    for (const lecture of module.lectures) {
      const formats = lecture.formats.join(', ');
      console.log(`    ${order}. ${lecture.title} (${lecture.durationMinutes} min, ${formats})`);
      console.log(`       Objective: ${lecture.objective}`);
      const interactiveSpec = resolveInteractiveSpec(lecture);
      if (interactiveSpec) {
        const modes = interactiveSpec.activities.map(a => a.mode).join(', ');
        console.log(`       Interactive: ${interactiveSpec.activities.length} activity/ies (${modes})`);
      }
      order += 1;
    }
  }
  console.log(`\nEstimated ${unitLabel.toLowerCase()} generation cost: ~$${estimateCourseCostUsd(plan).toFixed(2)} (rough)`);
}
