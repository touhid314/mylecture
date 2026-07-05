import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LLM_Model } from '../../packages/lecture-agent/src/llm_model.ts';
import { getCourseDir } from './paths.ts';
import { formatLectureSequenceContext, loadProfileContent } from './lecture-prompt.ts';
import { readCoursePlan } from './state.ts';
import { DEFAULT_LEARNING_INTENT, flattenPlanLectures } from './types.ts';
import type { CoursePlan, LearningIntent, PlannedLecture } from './types.ts';
import { reviewScriptWithRubric } from './review-script.ts';

const PROMPTS_DIR = path.join(import.meta.dirname, 'prompts');

export type ScriptLabOptions = {
  courseSlug: string;
  lectureSlug?: string;
  model?: string;
  review?: boolean;
};

function readPromptFile(name: string) {
  return readFileSync(path.join(PROMPTS_DIR, name), 'utf8').trim();
}

function readScriptWriterPrompt() {
  return [
    readPromptFile('script-writer.md'),
    '',
    readPromptFile('script-craft.md')
  ].join('\n');
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function lectureModuleTitle(plan: CoursePlan, lectureSlug: string) {
  for (const module of plan.modules) {
    if (module.lectures.some(lecture => lecture.slug === lectureSlug)) {
      return module.title;
    }
  }
  return '';
}

function buildScriptUserPrompt(plan: CoursePlan, lecture: PlannedLecture, order: number) {
  const intent = plan.intent ?? DEFAULT_LEARNING_INTENT;
  const moduleTitle = lectureModuleTitle(plan, lecture.slug);
  const previous = flattenPlanLectures(plan)
    .filter(item => item.order < order)
    .slice(-2)
    .map(item => `${item.order}. ${item.title}: ${item.objective}`);
  const next = flattenPlanLectures(plan)
    .filter(item => item.order > order)
    .slice(0, 2)
    .map(item => `${item.order}. ${item.title}: ${item.objective}`);

  return [
    `Course: ${plan.title}`,
    `Module: ${moduleTitle}`,
    `Lecture ${order}: ${lecture.title}`,
    `Learning objective: ${lecture.objective}`,
    `Audience level: ${plan.audience}`,
    `Learning intent: ${intent}`,
    `Target duration: ${lecture.durationMinutes} minutes`,
    lecture.promptNotes ? `Planner notes: ${lecture.promptNotes}` : '',
    previous.length ? `Previous lecture context:\n${previous.join('\n')}` : '',
    next.length ? `Upcoming lecture context:\n${next.join('\n')}` : '',
    '',
    `Audience and intent profile:\n${loadProfileContent(plan.audience, intent as LearningIntent)}`,
    '',
    'Write only the markdown script draft. Do not write HTML. Do not mention implementation files.'
  ].filter(Boolean).join('\n');
}

function normalizeDraft(raw: unknown) {
  if (typeof raw === 'string') return raw.trim();
  return JSON.stringify(raw, null, 2).trim();
}

async function generateOneScriptDraft(options: {
  plan: CoursePlan;
  lecture: PlannedLecture;
  order: number;
  model: string;
  review: boolean;
}) {
  const systemPrompt = readScriptWriterPrompt();
  const userPrompt = buildScriptUserPrompt(options.plan, options.lecture, options.order);
  const llm = new LLM_Model(options.model, systemPrompt, null, true);
  const raw = await llm.generate(userPrompt, null, null, null, null, false, false);
  const draft = normalizeDraft(raw);

  const outDir = path.join(
    getCourseDir(options.plan.slug),
    '.script-lab',
    `${String(options.order).padStart(2, '0')}-${options.lecture.slug}`,
    timestampSlug()
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'prompt.txt'), `${systemPrompt}\n\n--- user prompt ---\n${userPrompt}\n`, 'utf8');
  writeFileSync(path.join(outDir, 'script.md'), `${draft}\n`, 'utf8');

  console.log(`\nScript draft: ${path.relative(process.cwd(), path.join(outDir, 'script.md'))}`);

  if (options.review) {
    const review = await reviewScriptWithRubric({
      folderPath: outDir,
      objective: options.lecture.objective,
      audience: options.plan.audience,
      intent: options.plan.intent ?? DEFAULT_LEARNING_INTENT,
      durationMinutes: options.lecture.durationMinutes,
      courseContext: formatLectureSequenceContext(options.plan, options.lecture),
      model: options.model
    });
    writeFileSync(path.join(outDir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`, 'utf8');
    console.log(`Review: ${review.passed ? 'passed' : 'failed'}`);
    for (const finding of review.findings) {
      console.log(`  - ${finding}`);
    }
  }

  return outDir;
}

export async function runScriptLab(options: ScriptLabOptions) {
  const plan = readCoursePlan(options.courseSlug);
  const model = options.model || process.env.AGENT_MODEL || '';
  if (!model) {
    throw new Error('AGENT_MODEL environment variable or --model flag must be specified.');
  }

  const rows = flattenPlanLectures(plan);
  const selected = options.lectureSlug
    ? rows.filter(row => row.slug === options.lectureSlug)
    : rows;

  if (selected.length === 0) {
    throw new Error(options.lectureSlug
      ? `Lecture not found in plan: ${options.lectureSlug}`
      : 'No lectures found in plan');
  }

  for (const row of selected) {
    await generateOneScriptDraft({
      plan,
      lecture: row,
      order: row.order,
      model,
      review: options.review ?? true
    });
  }
}
