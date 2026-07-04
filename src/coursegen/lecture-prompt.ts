import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Audience, CoursePlan, GameSpec, InteractiveSpec, LearningIntent, PlannedLecture } from './types.ts';
import { resolveGameSpec, resolveInteractiveSpec } from './types.ts';
import { DEFAULT_LEARNING_INTENT } from './types.ts';

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

function loadPromptFile(name: string) {
  return readFileSync(path.join(PROMPTS_DIR, name), 'utf8').trim();
}

function formatDuration(minutes: number) {
  const whole = Math.max(2, Math.min(10, Math.round(minutes)));
  return `${whole}:00`;
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

export function buildVideoTaskMessage(plan: CoursePlan, lecture: PlannedLecture, moduleTitle: string) {
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);
  const lines = [
    `Create a ${lecture.durationMinutes}-minute video lesson for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    lecture.promptNotes ? `Notes: ${lecture.promptNotes}` : '',
    '',
    'if the user query is for video generation then follow this:',
    'aspect ratio: 16:9',
    `generation length: ${formatDuration(lecture.durationMinutes)}`,
    'embed subtitle in video: no',
    `profile: ${profileContent}`,
    '',
    'Course lesson structure:',
    '- Open with a concrete question, problem, or motivating example that makes the learning objective feel useful.',
    '- State what the learner will be able to do, then teach through one clear sequence of explanation and examples.',
    '- Keep the lesson aligned to the single objective; avoid attention-grabbing detours, broad surveys, or tangents that do not support the objective.',
    '- End with a short takeaway that names the skill the learner can now practice.',
    '',
    'Create only the video lecture (index.html and assets). Do NOT create any interactive practice or game files (no interactive.html, game.html, or anything under activities/) — those are generated in a separate pass.'
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
  const practiceSpec = loadPromptFile('interactive-practice.md');
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);

  return [
    `Create the interactive practice page at ${INTERACTIVE_PRACTICE_REL} for the course "${plan.title}".`,
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
    '--- interactive-practice spec (mandatory) ---',
    practiceSpec,
    '',
    '--- interactiveSpec (implement exactly these activities) ---',
    formatInteractiveSpec(spec),
    '',
    `profile: ${profileContent}`,
    '',
    `Output ${INTERACTIVE_PRACTICE_REL} only. Do not modify the video index file.`
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
  const practiceSpec = loadPromptFile('interactive-practice.md');
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const profileContent = loadProfileContent(plan.audience, intent);

  return [
    `Create the game practice page at ${GAME_PRACTICE_REL} for the course "${plan.title}".`,
    `Module: ${moduleTitle}`,
    `Lecture: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    '',
    'The video lesson already exists in this workspace. Match its topic and terminology.',
    `Video file: ${path.basename(videoIndexPath)}`,
    '',
    '--- game spec ---',
    formatGameSpec(spec),
    '',
    'Use challenge mode rules from the practice spec (brief start overlay or intro card, score out of 100, clear win condition).',
    '--- interactive-practice spec (layout + challenge rules) ---',
    practiceSpec,
    '',
    `profile: ${profileContent}`,
    '',
    `Output ${GAME_PRACTICE_REL} only. Do not modify the video index file.`
  ].join('\n');
}

export function buildPracticeRepairMessage(options: {
  fileName: PracticeHtmlRelPath;
  objective: string;
  findings: string[];
  specText: string;
}) {
  const practiceSpec = loadPromptFile('interactive-practice.md');
  return [
    `Fix ${options.fileName} based on QA review findings.`,
    `Learning objective: ${options.objective}`,
    '',
    '--- findings to fix ---',
    ...options.findings.map(finding => `- ${finding}`),
    '',
    '--- activity spec ---',
    options.specText,
    '',
    '--- interactive-practice spec ---',
    practiceSpec,
    '',
    `Edit ${options.fileName} only. Do not change the video index file.`
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
  console.log(`\nEstimated generation cost: ~$${estimateCourseCostUsd(plan).toFixed(2)} (rough)`);
}
