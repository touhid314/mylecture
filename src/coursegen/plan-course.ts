import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_Model } from '../../packages/lecture-agent/src/llm_model.ts';
import { formatCategoriesForPlanner } from './categories.ts';
import { courseStatePath, ensureCourseDir } from './paths.ts';
import { estimateCourseCostUsd, printPlanSummary } from './lecture-prompt.ts';
import { buildSkillGraphFromPlan } from './skill-graph.ts';
import { writeCoursePlan, writeCourseState, writeSkillGraph } from './state.ts';
import { initialCourseState, validateAdaptiveCoursePlan, validateCoursePlan, validateSkillGraph } from './types.ts';
import type { Audience, CoursePlan, LearningIntent } from './types.ts';

export type PlanCourseOptions = {
  topic: string;
  audience?: Audience;
  intent?: LearningIntent;
  scope?: string;
  maxLectures?: number;
  model?: string;
  dryRun?: boolean;
  budgetUsd?: number;
  adaptive?: boolean;
};

const DEFAULT_NON_ADAPTIVE_MAX_LECTURES = 12;
const DEFAULT_ADAPTIVE_MAX_NODES = 80;

function plannerPromptPath(adaptive: boolean) {
  const fileName = adaptive ? 'planner-adaptive.md' : 'planner.md';
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts', fileName);
}

function isAdaptiveTopic(topic: string) {
  return /\b(algebra|adaptive|skill path|duolingo|pre-algebra)\b/i.test(topic);
}

function useAdaptivePlanner(options: PlanCourseOptions) {
  return options.adaptive === true || (options.intent === 'practice' && isAdaptiveTopic(options.topic));
}

function buildPlannerUserPrompt(options: PlanCourseOptions, adaptive: boolean) {
  const lines = [
    `Topic: ${options.topic}`,
    options.audience
      ? `Audience level override: ${options.audience}`
      : 'Audience level: choose the best catalog placement for this topic',
    options.intent
      ? `Learning intent override: ${options.intent}`
      : 'Learning intent: choose the best catalog placement for this topic'
  ];
  if (options.scope) lines.push(`Scope: ${options.scope}`);
  if (adaptive) {
    lines.push('Planning mode: map the complete adaptive skill graph needed to teach the scoped subject, not a generation batch.');
    if (options.maxLectures) {
      lines.push(`Maximum node cap: ${options.maxLectures}`);
    }
  } else if (options.maxLectures) {
    lines.push(`Target lecture count: ${options.maxLectures}`);
  }
  lines.push('Catalog categories (choose exactly one categoryId):');
  lines.push(formatCategoriesForPlanner());
  lines.push('Return the course plan JSON only.');
  return lines.join('\n');
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('Planner response did not contain JSON.');
}

export function normalizePlannerResponse(response: unknown): Record<string, unknown> {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return response as Record<string, unknown>;
  }
  if (typeof response === 'string') {
    return extractJsonObject(response);
  }
  throw new Error('Planner response did not contain JSON.');
}

export function serializePlannerResponse(response: unknown) {
  if (typeof response === 'string') return response;
  try {
    return JSON.stringify(response, null, 2);
  } catch {
    return String(response);
  }
}

export async function planCourse(options: PlanCourseOptions): Promise<CoursePlan> {
  const adaptive = useAdaptivePlanner(options);
  const systemPrompt = readFileSync(plannerPromptPath(adaptive), 'utf8');
  const userPrompt = buildPlannerUserPrompt(options, adaptive);
  const maxLectures = options.maxLectures ?? (adaptive ? DEFAULT_ADAPTIVE_MAX_NODES : DEFAULT_NON_ADAPTIVE_MAX_LECTURES);

  if (options.dryRun) {
    console.log('--- Planner system prompt ---\n');
    console.log(systemPrompt);
    console.log('\n--- Planner user prompt ---\n');
    console.log(userPrompt);
    throw new Error('Dry run complete (no LLM call).');
  }

  const model = options.model || process.env.AGENT_MODEL || '';
  if (!model) {
    throw new Error('AGENT_MODEL environment variable or --model flag must be specified.');
  }

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
      const plan = adaptive
        ? validateAdaptiveCoursePlan({ ...parsed, adaptivePath: true }, { maxLectures })
        : validateCoursePlan(parsed, { maxLectures });
      ensureCourseDir(plan.slug);
      writeCoursePlan(plan);
      if (adaptive || plan.adaptivePath) {
        const skillGraph = buildSkillGraphFromPlan(plan);
        validateSkillGraph(skillGraph, plan);
        const skillGraphFile = writeSkillGraph(skillGraph);
        console.log(`Saved: gens/courses/${plan.slug}/skillGraph.json (${skillGraph.skills.length} skills)`);
        console.log(`Skill graph: ${skillGraphFile}`);
      }
      const statePath = courseStatePath(plan.slug);
      if (!existsSync(statePath)) {
        writeCourseState(initialCourseState(plan, options.budgetUsd ?? 5));
      } else {
        console.log(`Note: existing state kept (${statePath})`);
      }
      printPlanSummary(plan);
      console.log(`\nSaved: gens/courses/${plan.slug}/course-plan.json`);
      console.log(`Estimated cost: ~$${estimateCourseCostUsd(plan).toFixed(2)}`);
      return plan;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const debugPath = path.join(ensureCourseDir('invalid-planner-output'), `planner-raw-${Date.now()}.txt`);
  writeFileSync(debugPath, serializePlannerResponse(rawResponse), 'utf8');
  throw new Error(`${lastError?.message || 'Invalid planner output'} (saved raw response to ${debugPath})`);
}
