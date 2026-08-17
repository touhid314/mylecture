import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_Model } from '../../../mylecture-agent/src/utils/llm_model.ts';
import { validateClassPlan, type ClassPlan } from './class-types.ts';
import { resolveAgentModel } from './models.ts';
import { classPlanPath, ensureClassDir } from './paths.ts';
import { assertValidSourceSlug, readSourceManifest } from './source-manifest.ts';
import { normalizePlannerResponse, serializePlannerResponse } from './plan-course.ts';
import type { Audience, LearningIntent } from './types.ts';

export type PlanClassOptions = {
  topic: string;
  classSlug?: string;
  audience?: Audience;
  intent?: LearningIntent;
  scope?: string;
  model?: string;
  dryRun?: boolean;
  source?: string;
};

function plannerClassPromptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts', 'planner-class.md');
}

function slugifyTopic(topic: string) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'class';
}

function buildClassPlannerUserPrompt(
  options: PlanClassOptions,
  source?: { slug: string; title: string; sections: Array<{ id: string; title: string; charCount: number }> }
) {
  const lines = [
    `Topic: ${options.topic}`,
    options.audience
      ? `Audience level override: ${options.audience}`
      : 'Audience level: choose the best catalog placement for this class',
    options.intent
      ? `Learning intent override: ${options.intent}`
      : 'Learning intent: choose the best catalog placement for this class'
  ];
  if (options.scope) lines.push(`Scope: ${options.scope}`);
  if (options.classSlug) lines.push(`Preferred class slug: ${options.classSlug}`);

  if (source) {
    lines.push('');
    lines.push(`Source textbook: ${source.title} (slug: ${source.slug})`);
    lines.push('Available source sections (use these exact ids in module.sourceSections):');
    for (const section of source.sections) {
      lines.push(`- ${section.id}: ${section.title} (${section.charCount} chars)`);
    }
    lines.push(
      'Assign every listed section to exactly one module via sourceSections. ' +
        'Do not invent section ids. You may reorder for teaching clarity.'
    );
    lines.push(`Persist top-level plan.source as { "slug": "${source.slug}", "title": ${JSON.stringify(source.title)} }.`);
  }

  lines.push('Return the class plan JSON only. Do not plan lectures.');
  return lines.join('\n');
}

export function readClassPlan(classSlug: string): ClassPlan {
  const filePath = classPlanPath(classSlug);
  if (!existsSync(filePath)) {
    throw new Error(`Class plan not found: ${filePath}`);
  }
  return validateClassPlan(JSON.parse(readFileSync(filePath, 'utf8')));
}

export function writeClassPlan(plan: ClassPlan) {
  const filePath = classPlanPath(plan.slug);
  ensureClassDir(plan.slug);
  writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function planClass(options: PlanClassOptions): Promise<ClassPlan> {
  const systemPrompt = readFileSync(plannerClassPromptPath(), 'utf8');
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

  const userPrompt = buildClassPlannerUserPrompt(options, sourceMeta);

  if (options.dryRun) {
    console.log('--- Class planner system prompt ---\n');
    console.log(systemPrompt);
    console.log('\n--- Class planner user prompt ---\n');
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
      if (!parsed.slug && options.classSlug) {
        parsed.slug = options.classSlug;
      }
      if (!parsed.slug) {
        parsed.slug = slugifyTopic(options.topic);
      }
      const plan = validateClassPlan(parsed, { knownSourceSectionIds });
      if (sourceMeta) {
        plan.source = { slug: sourceMeta.slug, title: sourceMeta.title };
      }
      writeClassPlan(plan);
      console.log(`\nClass: ${plan.title} (${plan.slug})`);
      console.log(`Modules: ${plan.modules.length}`);
      for (const module of plan.modules) {
        const sections = module.sourceSections?.length ? ` [${module.sourceSections.length} sections]` : '';
        console.log(`  - ${module.slug}: ${module.title}${sections}`);
      }
      console.log(`\nSaved: gens/classes/${plan.slug}/class-plan.json`);
      return plan;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const debugPath = path.join(ensureClassDir('invalid-class-planner-output'), `planner-raw-${Date.now()}.txt`);
  writeFileSync(debugPath, serializePlannerResponse(rawResponse), 'utf8');
  throw new Error(`${lastError?.message || 'Invalid class planner output'} (saved raw response to ${debugPath})`);
}
