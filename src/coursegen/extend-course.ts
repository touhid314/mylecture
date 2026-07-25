import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_Model } from '../../packages/lecture-agent/src/utils/llm_model.ts';
import { resolveAgentModel } from './models.ts';
import { ensureCourseDir } from './paths.ts';
import { estimateCourseCostUsd, printPlanSummary } from './lecture-prompt.ts';
import { normalizePlannerResponse, serializePlannerResponse } from './plan-course.ts';
import { assertValidSourceSlug, readSourceManifest } from './source-manifest.ts';
import { readCoursePlan, readCourseState, writeCoursePlan, writeCourseState } from './state.ts';
import { syncStateFromPlan } from './run-course.ts';
import {
  flattenPlanLectures,
  initialCourseState,
  validateCoursePlan,
  type CoursePlan,
  type PlannedModule
} from './types.ts';

const MAX_COURSE_LECTURES = 30;

export type ExtendCourseOptions = {
  courseSlug: string;
  topic?: string;
  scope?: string;
  moduleTitle?: string;
  placement?: ExtensionPlacementMode;
  maxLectures?: number;
  model?: string;
  dryRun?: boolean;
};

export type ExtensionPlacementMode = 'auto' | 'append-last' | 'new-module';

type ExtensionPlacement =
  | {
      action: 'append_to_module';
      targetModuleTitle: string;
      reason?: string;
    }
  | {
      action: 'create_module';
      reason?: string;
    };

type ExtendPlanPatch = {
  summary?: string;
  description?: string;
  placement?: ExtensionPlacement;
  modules: PlannedModule[];
};

function plannerExtendPromptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts', 'planner-extend.md');
}

function existingLectureSlugs(plan: CoursePlan) {
  return flattenPlanLectures(plan).map(row => row.slug);
}

function summarizeExistingPlan(plan: CoursePlan) {
  const lines = [
    `Title: ${plan.title}`,
    `Slug: ${plan.slug}`,
    `Audience: ${plan.audience}`,
    `Intent: ${plan.intent}`,
    `Summary: ${plan.summary}`,
    `Description: ${plan.description}`,
    '',
    'Current modules and lectures:'
  ];
  for (const module of plan.modules) {
    lines.push(`  ${module.title}`);
    for (const lecture of module.lectures) {
      lines.push(`    - ${lecture.slug}: ${lecture.title}`);
      lines.push(`      Objective: ${lecture.objective}`);
      if (lecture.sourceSections && lecture.sourceSections.length > 0) {
        lines.push(`      Source sections: ${lecture.sourceSections.join(', ')}`);
      }
    }
  }
  return lines.join('\n');
}

const INTERACTIVE_SPEC_RETRY_HINT = [
  'interactiveSpec.activities[] must use: id, title, mode (learn|practice|challenge), visibleSetup, learnerAction, controls (non-empty string array), feedback, successCriterion.',
  'Do NOT use quiz fields (type, question, options, correctAnswer).'
].join(' ');

function hasValidInteractiveSpec(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const activities = (raw as Record<string, unknown>).activities;
  if (!Array.isArray(activities) || activities.length === 0) return false;
  return activities.every(activity => {
    if (!activity || typeof activity !== 'object') return false;
    const act = activity as Record<string, unknown>;
    const controls = act.controls;
    return (
      String(act.id || '').trim() &&
      String(act.title || '').trim() &&
      ['learn', 'practice', 'challenge'].includes(String(act.mode || '')) &&
      Array.isArray(controls) &&
      controls.length > 0 &&
      controls.every(c => typeof c === 'string' && c.trim())
    );
  });
}

function hasValidGameSpec(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const spec = raw as Record<string, unknown>;
  const controls = spec.controls;
  return (
    String(spec.mission || '').trim() &&
    Array.isArray(controls) &&
    controls.length > 0 &&
    controls.every(c => typeof c === 'string' && c.trim())
  );
}

function sanitizeExtensionLecture(lecture: Record<string, unknown>) {
  const formats = Array.isArray(lecture.formats)
    ? lecture.formats.map(value => String(value))
    : [];

  if (formats.includes('interactive') && !hasValidInteractiveSpec(lecture.interactiveSpec)) {
    delete lecture.interactiveSpec;
  }
  if (formats.includes('game') && !hasValidGameSpec(lecture.gameSpec)) {
    delete lecture.gameSpec;
  }

  const duration = Number(lecture.durationMinutes);
  if (!Number.isFinite(duration) || duration < 2 || duration > 10) {
    const rounded = Number.isFinite(duration) ? Math.round(duration) : 6;
    lecture.durationMinutes = Math.min(10, Math.max(2, rounded));
  }
}

function sanitizeExtensionModules(modulesRaw: unknown): unknown {
  if (!Array.isArray(modulesRaw)) return modulesRaw;
  return modulesRaw.map(moduleRaw => {
    if (!moduleRaw || typeof moduleRaw !== 'object') return moduleRaw;
    const module = { ...(moduleRaw as Record<string, unknown>) };
    if (Array.isArray(module.lectures)) {
      module.lectures = module.lectures.map(lectureRaw => {
        if (!lectureRaw || typeof lectureRaw !== 'object') return lectureRaw;
        const lecture = { ...(lectureRaw as Record<string, unknown>) };
        sanitizeExtensionLecture(lecture);
        return lecture;
      });
    }
    return module;
  });
}

function exampleInteractiveSpecFromPlan(plan: CoursePlan): string | null {
  for (const module of plan.modules) {
    for (const lecture of module.lectures) {
      if (lecture.interactiveSpec?.activities?.[0]) {
        const activity = lecture.interactiveSpec.activities[0];
        return JSON.stringify({ activities: [activity] }, null, 2);
      }
    }
  }
  return null;
}

function buildExtendUserPrompt(
  plan: CoursePlan,
  options: ExtendCourseOptions,
  source?: { slug: string; title: string; sections: Array<{ id: string; title: string; charCount: number }> }
) {
  const existingCount = flattenPlanLectures(plan).length;
  const maxNew = options.maxLectures ?? 3;
  const remaining = Math.max(0, MAX_COURSE_LECTURES - existingCount);
  const targetNew = Math.min(maxNew, remaining);
  const placementMode = options.placement ?? 'auto';
  const lastModule = plan.modules[plan.modules.length - 1];

  const lines = [
    'Extend this existing course plan.',
    '',
    summarizeExistingPlan(plan),
    '',
    `Existing lecture slugs (do not reuse): ${existingLectureSlugs(plan).join(', ')}`,
    '',
    'Decide the best next lecture sequence. Infer the natural continuation from the course above unless optional hints override.',
    `Target new lecture count: ${targetNew}`,
    `Placement mode: ${placementMode}`
  ];
  if (options.topic) lines.push(`Optional user hint - topic focus: ${options.topic}`);
  if (options.scope) lines.push(`Optional user hint - scope: ${options.scope}`);
  if (options.moduleTitle) lines.push(`Optional user hint - module title: ${options.moduleTitle}`);
  if (placementMode === 'append-last' && lastModule) {
    lines.push(`Manual placement: append the new lecture(s) to the existing final module ${lastModule.title}.`);
  } else if (placementMode === 'new-module') {
    lines.push('Manual placement: create a new module for the extension.');
  } else {
    lines.push('Automatic placement: decide whether the addition belongs inside an existing module or should start a new module. Append to an existing module when the new lecture continues the same skill chain; create a new module only when the extension changes conceptual region, learning mode, or course unit.');
  }

  if (source) {
    lines.push('');
    lines.push(`Source textbook: ${source.title} (slug: ${source.slug})`);
    lines.push('Available source sections (use these exact ids in lecture.sourceSections):');
    for (const section of source.sections) {
      lines.push(`- ${section.id}: ${section.title} (${section.charCount} chars)`);
    }
    lines.push(
      'Source-grounded extension: every new lecture must include ≥1 sourceSections ids from the list above. ' +
        'Do not invent section ids. Keep covering unused or underused sections when they fit the extension. ' +
        `Preserve top-level plan.source as { "slug": "${source.slug}", "title": ${JSON.stringify(source.title)} }.`
    );
  }

  const exampleSpec = exampleInteractiveSpecFromPlan(plan);
  if (exampleSpec) {
    lines.push(
      '',
      'When you include interactive lectures, match this interactiveSpec shape from an existing lecture in this course:',
      exampleSpec
    );
  }
  lines.push(
    '',
    'Return JSON with the placement decision, only the new lecture content, plus optional updated summary/description for the whole course.',
    'Return the extension JSON only.'
  );
  return lines.join('\n');
}

function parsePlacement(raw: unknown): ExtensionPlacement | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const placement = raw as Record<string, unknown>;
  const action = String(placement.action || '').trim();
  const reason = String(placement.reason || '').trim() || undefined;
  if (action === 'append_to_module') {
    const targetModuleTitle = String(placement.targetModuleTitle || '').trim();
    if (!targetModuleTitle) {
      throw new Error('placement.targetModuleTitle is required for append_to_module');
    }
    return { action, targetModuleTitle, reason };
  }
  if (action === 'create_module') {
    return { action, reason };
  }
  throw new Error('placement.action must be append_to_module or create_module');
}

function parseExtendPatch(
  raw: Record<string, unknown>,
  plan: CoursePlan,
  options: ExtendCourseOptions,
  knownSourceSectionIds?: ReadonlySet<string>
): ExtendPlanPatch {
  const modulesRaw = sanitizeExtensionModules(raw.modules);
  if (!Array.isArray(modulesRaw) || modulesRaw.length === 0) {
    throw new Error('extension must include a non-empty modules array');
  }

  const tempPlan = validateCoursePlan(
    {
      title: 'extension-validation',
      slug: 'extension-validation',
      audience: 'general',
      intent: 'foundation',
      summary: 'validation only',
      description: 'validation only',
      modules: modulesRaw,
      ...(plan.source ? { source: plan.source } : {})
    },
    {
      maxLectures: MAX_COURSE_LECTURES,
      knownSourceSectionIds: plan.source ? knownSourceSectionIds : undefined
    }
  );

  const patch: ExtendPlanPatch = { modules: tempPlan.modules };
  const lastModule = plan.modules[plan.modules.length - 1];
  if (options.placement === 'append-last') {
    if (!lastModule) throw new Error('cannot append to final module because the course has no modules');
    patch.placement = {
      action: 'append_to_module',
      targetModuleTitle: lastModule.title,
      reason: 'Manual placement override: append to final module.'
    };
  } else if (options.placement === 'new-module') {
    patch.placement = {
      action: 'create_module',
      reason: 'Manual placement override: create a new module.'
    };
  } else if (raw.placement !== undefined) {
    patch.placement = parsePlacement(raw.placement);
  }
  const summary = String(raw.summary || '').trim();
  const description = String(raw.description || '').trim();
  if (summary) patch.summary = summary;
  if (description) patch.description = description;
  return patch;
}

function mergeExtension(
  plan: CoursePlan,
  patch: ExtendPlanPatch,
  knownSourceSectionIds?: ReadonlySet<string>
): CoursePlan {
  const existingSlugs = new Set(existingLectureSlugs(plan));
  for (const module of patch.modules) {
    for (const lecture of module.lectures) {
      if (existingSlugs.has(lecture.slug)) {
        throw new Error(`extension reuses existing lecture slug: ${lecture.slug}`);
      }
      existingSlugs.add(lecture.slug);
    }
  }

  let modules: PlannedModule[];
  if (patch.placement?.action === 'append_to_module') {
    const targetTitle = patch.placement.targetModuleTitle.trim().toLowerCase();
    const targetIndex = plan.modules.findIndex(module => module.title.trim().toLowerCase() === targetTitle);
    if (targetIndex < 0) {
      throw new Error(`extension targets unknown module: ${patch.placement.targetModuleTitle}`);
    }
    const newLectures = patch.modules.flatMap(module => module.lectures);
    modules = plan.modules.map((module, index) =>
      index === targetIndex
        ? { ...module, lectures: [...module.lectures, ...newLectures] }
        : module
    );
  } else {
    modules = [...plan.modules, ...patch.modules];
  }

  const merged: CoursePlan = {
    ...plan,
    modules
  };
  if (patch.summary) merged.summary = patch.summary;
  if (patch.description) merged.description = patch.description;
  // Preserve plan.source from the existing course.
  if (plan.source) merged.source = { ...plan.source };

  return validateCoursePlan(merged, {
    maxLectures: MAX_COURSE_LECTURES,
    knownSourceSectionIds: plan.source ? knownSourceSectionIds : undefined
  });
}

export async function extendCourse(options: ExtendCourseOptions): Promise<CoursePlan> {
  const plan = readCoursePlan(options.courseSlug);
  const systemPrompt = readFileSync(plannerExtendPromptPath(), 'utf8');

  let sourceMeta:
    | { slug: string; title: string; sections: Array<{ id: string; title: string; charCount: number }> }
    | undefined;
  let knownSourceSectionIds: Set<string> | undefined;
  if (plan.source?.slug) {
    assertValidSourceSlug(plan.source.slug);
    const manifest = readSourceManifest(plan.source.slug);
    sourceMeta = {
      slug: plan.source.slug,
      title: plan.source.title || manifest.title,
      sections: manifest.sections.map(section => ({
        id: section.id,
        title: section.title,
        charCount: section.charCount
      }))
    };
    knownSourceSectionIds = new Set(manifest.sections.map(section => section.id));
  }

  const userPrompt = buildExtendUserPrompt(plan, options, sourceMeta);
  const existingCount = flattenPlanLectures(plan).length;

  if (existingCount >= MAX_COURSE_LECTURES) {
    throw new Error(`Course already has ${existingCount} lectures (max ${MAX_COURSE_LECTURES}).`);
  }

  if (options.dryRun) {
    console.log('--- Extension planner system prompt ---\n');
    console.log(systemPrompt);
    console.log('\n--- Extension planner user prompt ---\n');
    console.log(userPrompt);
    throw new Error('Dry run complete (no LLM call).');
  }

  const model = resolveAgentModel(options.model);

  let lastError: Error | null = null;
  let rawResponse: unknown = null;

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const llm = new LLM_Model(model, systemPrompt, null, true);
    const prompt = attempt === 0
      ? userPrompt
      : `${userPrompt}\n\nPrevious response was invalid: ${lastError?.message}. ${INTERACTIVE_SPEC_RETRY_HINT} Return valid JSON only.`;
    rawResponse = await llm.generate(prompt, null, null, null, null, true, false);
    try {
      const parsed = normalizePlannerResponse(rawResponse);
      const patch = parseExtendPatch(parsed, plan, options, knownSourceSectionIds);
      const merged = mergeExtension(plan, patch, knownSourceSectionIds);
      if (plan.source) {
        merged.source = { slug: plan.source.slug, title: plan.source.title };
      }
      ensureCourseDir(merged.slug);
      writeCoursePlan(merged);

      let state;
      try {
        state = readCourseState(options.courseSlug);
        syncStateFromPlan(state, merged);
      } catch {
        state = initialCourseState(merged, 5);
      }
      writeCourseState(state);

      const added = flattenPlanLectures(merged).length - existingCount;
      console.log(`\nExtended course: ${merged.title} (${merged.slug})`);
      if (patch.placement?.action === 'append_to_module') {
        console.log(`Added ${added} lecture(s) to existing module: ${patch.placement.targetModuleTitle}`);
      } else {
        console.log(`Added ${added} lecture(s) in ${patch.modules.length} new module(s).`);
      }
      if (patch.placement?.reason) {
        console.log(`Placement: ${patch.placement.reason}`);
      }
      printPlanSummary(merged);
      console.log(`\nSaved: gens/courses/${merged.slug}/course-plan.json`);
      console.log(`Estimated cost (full course): ~$${estimateCourseCostUsd(merged).toFixed(2)}`);
      console.log('Run generation to build the new lectures.');
      return merged;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const debugPath = path.join(
    ensureCourseDir('invalid-planner-output'),
    `extend-raw-${options.courseSlug}-${Date.now()}.txt`
  );
  writeFileSync(debugPath, serializePlannerResponse(rawResponse), 'utf8');
  throw new Error(`${lastError?.message || 'Invalid extension output'} (saved raw response to ${debugPath})`);
}
