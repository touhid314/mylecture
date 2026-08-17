import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_Model } from '../../../mylecture-agent/src/utils/llm_model.ts';
import { resolveAgentModel } from './models.ts';
import { courseStatePath, ensureCourseDir } from './paths.ts';
import { estimateCourseCostUsd, printPlanSummary } from './lecture-prompt.ts';
import { assertValidSourceSlug, readSourceManifest } from './source-manifest.ts';
import { writeCoursePlan, writeCourseState } from './state.ts';
import { initialCourseState, validateCoursePlan } from './types.ts';
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
  /** Ingested source slug under gens/sources/<slug>/ */
  source?: string;
};

function plannerPromptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts', 'planner.md');
}

function buildPlannerUserPrompt(
  options: PlanCourseOptions,
  source?: { slug: string; title: string; sections: Array<{ id: string; title: string; charCount: number }> }
) {
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
  if (options.maxLectures) lines.push(`Target lecture count: ${options.maxLectures}`);

  if (source) {
    lines.push('');
    lines.push(`Source textbook: ${source.title} (slug: ${source.slug})`);
    lines.push('Available source sections (use these exact ids in lecture.sourceSections):');
    for (const section of source.sections) {
      lines.push(`- ${section.id}: ${section.title} (${section.charCount} chars)`);
    }
    lines.push(
      'Source-grounded planning: map each lecture to one or more sourceSections ids from the list above. ' +
        'Cover the listed sections across the course. Do not invent section ids. ' +
        'You may reorganize section order for teaching when a different sequence teaches better.'
    );
    lines.push(`Persist top-level plan.source as { "slug": "${source.slug}", "title": ${JSON.stringify(source.title)} }.`);
  }

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
  const systemPrompt = readFileSync(plannerPromptPath(), 'utf8');
  const sourceSlug = String(options.source || '').trim();
  let sourceMeta: { slug: string; title: string; sections: Array<{ id: string; title: string; charCount: number }> } | undefined;
  let knownSourceSectionIds: Set<string> | undefined;

  if (sourceSlug) {
    assertValidSourceSlug(sourceSlug);
    const manifest = readSourceManifest(sourceSlug);
    sourceMeta = {
      slug: manifest.slug,
      title: manifest.title,
      sections: manifest.sections.map(section => ({
        id: section.id,
        title: section.title,
        charCount: section.charCount
      }))
    };
    knownSourceSectionIds = new Set(manifest.sections.map(section => section.id));
  }

  const userPrompt = buildPlannerUserPrompt(options, sourceMeta);
  const maxLectures = options.maxLectures ?? 12;

  if (options.dryRun) {
    console.log('--- Planner system prompt ---\n');
    console.log(systemPrompt);
    console.log('\n--- Planner user prompt ---\n');
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
      if (sourceMeta && (!parsed.source || typeof parsed.source !== 'object')) {
        parsed.source = { slug: sourceMeta.slug, title: sourceMeta.title };
      }
      const plan = validateCoursePlan(parsed, {
        maxLectures,
        knownSourceSectionIds
      });
      // Always force CLI --source onto the plan (ignore planner-invented slug/title).
      if (sourceMeta) {
        plan.source = { slug: sourceMeta.slug, title: sourceMeta.title };
      }
      ensureCourseDir(plan.slug);
      writeCoursePlan(plan);
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
