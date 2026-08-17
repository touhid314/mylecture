import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleCourseSlug } from './class-types.ts';
import { readClassPlan } from './plan-class.ts';
import { planCourse } from './plan-course.ts';
import { assertValidSourceSlug, readSourceManifest } from './source-manifest.ts';
import type { Audience, LearningIntent } from './types.ts';

export type PlanModuleOptions = {
  classSlug: string;
  moduleSlug: string;
  source?: string;
  maxLectures?: number;
  audience?: Audience;
  intent?: LearningIntent;
  model?: string;
  dryRun?: boolean;
  budgetUsd?: number;
};

function plannerModulePromptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts', 'planner-module.md');
}

function readPlannerModuleAddon() {
  return readFileSync(plannerModulePromptPath(), 'utf8');
}

export async function planModule(options: PlanModuleOptions) {
  const classPlan = readClassPlan(options.classSlug);
  const module = classPlan.modules.find(entry => entry.slug === options.moduleSlug);
  if (!module) {
    throw new Error(
      `Module "${options.moduleSlug}" not found in class plan ${options.classSlug}. ` +
        `Available: ${classPlan.modules.map(entry => entry.slug).join(', ')}`
    );
  }

  const sourceSlug = String(options.source || classPlan.source?.slug || '').trim();
  let scopedSections: Array<{ id: string; title: string; charCount: number }> | undefined;
  if (sourceSlug) {
    assertValidSourceSlug(sourceSlug);
    const manifest = readSourceManifest(sourceSlug);
    const sectionIds = module.sourceSections?.length
      ? new Set(module.sourceSections)
      : null;
    scopedSections = manifest.sections
      .filter(section => !sectionIds || sectionIds.has(section.id))
      .map(section => ({
        id: section.id,
        title: section.title,
        charCount: section.charCount
      }));
    if (sectionIds && scopedSections.length !== sectionIds.size) {
      const found = new Set(scopedSections.map(section => section.id));
      const missing = [...sectionIds].filter(id => !found.has(id));
      throw new Error(`Module sourceSections not found in manifest: ${missing.join(', ')}`);
    }
  }

  const courseSlug = moduleCourseSlug(options.classSlug, options.moduleSlug);
  const topic = `${classPlan.title} — ${module.title}`;
  const scopeLines = [
    `Parent class: ${classPlan.title} (${classPlan.slug})`,
    `Module: ${module.title} (${module.slug})`
  ];
  if (module.summary) scopeLines.push(`Module summary: ${module.summary}`);
  if (module.chapters) scopeLines.push(`Chapter hint: ${module.chapters}`);
  if (scopedSections?.length) {
    scopeLines.push('Scoped source sections for this module:');
    for (const section of scopedSections) {
      scopeLines.push(`- ${section.id}: ${section.title}`);
    }
    scopeLines.push('Cover these sections completely across the module lectures.');
  } else {
    scopeLines.push('Cover the full module scope described above.');
  }

  const coverageFirst = options.maxLectures === undefined;
  const plan = await planCourse({
    topic,
    audience: options.audience ?? classPlan.audience,
    intent: options.intent ?? classPlan.intent,
    scope: scopeLines.join('\n'),
    maxLectures: options.maxLectures,
    validationMaxLectures: 30,
    coverageFirst,
    moduleMode: true,
    forcedSlug: courseSlug,
    classSlug: options.classSlug,
    plannerSystemAddon: readPlannerModuleAddon(),
    model: options.model,
    dryRun: options.dryRun,
    budgetUsd: options.budgetUsd ?? 5,
    source: sourceSlug || undefined,
    sourceSectionFilter: module.sourceSections
  });

  console.log(`\nModule course slug: ${plan.slug}`);
  if (plan.classSlug) {
    console.log(`Parent class: ${plan.classSlug}`);
  }
  return plan;
}
