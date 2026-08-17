import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_Model } from '../../../mylecture-agent/src/utils/llm_model.ts';
import {
  collectObjectivesFromPlan,
  validateCourseAssessments,
  type CourseAssessments
} from './assessment-validation.ts';
import { resolveAgentModel } from './models.ts';
import { assessmentsPath, ensureCourseDir } from './paths.ts';
import { normalizePlannerResponse, serializePlannerResponse } from './plan-course.ts';
import { readCoursePlan } from './state.ts';

export type GenerateAssessmentsOptions = {
  courseSlug: string;
  model?: string;
  dryRun?: boolean;
};

function assessmentWriterPromptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts', 'assessment-writer.md');
}

function buildAssessmentUserPrompt(objectives: ReturnType<typeof collectObjectivesFromPlan>, courseTitle: string) {
  const lines = [
    `Course: ${courseTitle}`,
    '',
    'Lecture objectives (write one pre and one post MCQ per objective):',
    JSON.stringify(objectives, null, 2),
    '',
    'Return assessments JSON only.'
  ];
  return lines.join('\n');
}

export function readCourseAssessments(courseSlug: string): CourseAssessments {
  const filePath = assessmentsPath(courseSlug);
  if (!existsSync(filePath)) {
    throw new Error(`Assessments not found: ${filePath}`);
  }
  return validateCourseAssessments(JSON.parse(readFileSync(filePath, 'utf8')));
}

export function writeCourseAssessments(courseSlug: string, assessments: CourseAssessments) {
  const validated = validateCourseAssessments(assessments);
  const filePath = assessmentsPath(courseSlug);
  ensureCourseDir(courseSlug);
  writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function generateAssessments(options: GenerateAssessmentsOptions): Promise<CourseAssessments> {
  const plan = readCoursePlan(options.courseSlug);
  const objectives = collectObjectivesFromPlan(plan);
  if (objectives.length === 0) {
    throw new Error('Course plan has no lecture objectives.');
  }

  const systemPrompt = readFileSync(assessmentWriterPromptPath(), 'utf8');
  const userPrompt = buildAssessmentUserPrompt(objectives, plan.title);

  if (options.dryRun) {
    console.log('--- Assessment writer system prompt ---\n');
    console.log(systemPrompt);
    console.log('\n--- Assessment writer user prompt ---\n');
    console.log(userPrompt);
    throw new Error('Dry run complete (no LLM call).');
  }

  const model = resolveAgentModel(options.model);
  let lastError: Error | null = null;
  let rawResponse: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const llm = new LLM_Model(model, systemPrompt, null, true);
    const prompt = attempt === 0
      ? userPrompt
      : `${userPrompt}\n\nPrevious response was invalid: ${lastError?.message}. Return valid JSON only.`;
    rawResponse = await llm.generate(prompt, null, null, null, null, true, false);
    try {
      const parsed = normalizePlannerResponse(rawResponse);
      if (!parsed.objectives || !Array.isArray(parsed.objectives) || parsed.objectives.length === 0) {
        parsed.objectives = objectives;
      }
      const assessments = validateCourseAssessments(parsed);
      const filePath = writeCourseAssessments(options.courseSlug, assessments);
      console.log(`\nAssessments: ${assessments.objectives.length} objectives`);
      console.log(`Pre items: ${assessments.pre.items.length}`);
      console.log(`Post items: ${assessments.post.items.length}`);
      console.log(`Saved: ${filePath}`);
      return assessments;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const debugPath = path.join(ensureCourseDir(options.courseSlug), `assessments-raw-${Date.now()}.txt`);
  writeFileSync(debugPath, serializePlannerResponse(rawResponse), 'utf8');
  throw new Error(`${lastError?.message || 'Invalid assessment output'} (saved raw response to ${debugPath})`);
}
