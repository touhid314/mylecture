/**
 * Resolve per-stage LLM models for LectureGen.
 *
 * Answer + script writer prefer SCRIPT_MODEL / scriptModel.
 * Animator, IAGen, and GameGen prefer ANIMATOR_MODEL / animatorModel.
 * Everything falls back to options.model / AGENT_MODEL.
 */
import path from 'node:path';

export type LectureGenStageModelInput = {
    model: string;
    scriptModel?: string;
    animatorModel?: string;
};

export type LectureGenStageModels = {
    scriptModel: string;
    animatorModel: string;
    defaultModel: string;
};

/** Workspace-relative names that must not be used as compare model folders. */
const RESERVED_MODEL_SLUGS = new Set([
    'uploads',
    'assets',
    'answer.md',
    'script.md',
    'compare.json',
    'metadata.json',
    'interactive.html',
    'game.html'
]);

const WINDOWS_RESERVED = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

function trimModel(value: string | undefined | null): string {
    return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(...candidates: Array<string | undefined | null>): string {
    for (const candidate of candidates) {
        const trimmed = trimModel(candidate);
        if (trimmed) return trimmed;
    }
    return '';
}

/**
 * Resolve stage-specific models from explicit options and env fallbacks.
 * Does not read AGENT_MODEL; callers pass the already-resolved default as `model`.
 */
export function resolveLectureGenStageModels(
    input: LectureGenStageModelInput,
    env: NodeJS.ProcessEnv = process.env
): LectureGenStageModels {
    const defaultModel = trimModel(input.model);
    if (!defaultModel) {
        throw new Error('A default model is required for LectureGen stage resolution.');
    }
    const scriptModel = firstNonEmpty(input.scriptModel, env.SCRIPT_MODEL, defaultModel);
    const animatorModel = firstNonEmpty(input.animatorModel, env.ANIMATOR_MODEL, defaultModel);
    return {
        scriptModel,
        animatorModel,
        defaultModel
    };
}

function isUnsafeSlugCandidate(slug: string): boolean {
    if (!slug) return true;
    if (/^\.+$/.test(slug)) return true;
    const lower = slug.toLowerCase();
    if (RESERVED_MODEL_SLUGS.has(lower)) return true;
    if (WINDOWS_RESERVED.has(lower)) return true;
    return false;
}

/** Sanitize a model id for use as a directory name (never `.` / `..` / reserved). */
export function sanitizeModelSlug(model: string): string {
    const trimmed = trimModel(model);
    let slug = trimmed
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!slug || /^\.+$/.test(slug)) {
        return 'model';
    }
    if (isUnsafeSlugCandidate(slug)) {
        slug = `m-${slug}`;
    }
    if (isUnsafeSlugCandidate(slug) || /^\.+$/.test(slug)) {
        return 'model';
    }
    return slug;
}

/**
 * True when `slug` stays a single relative path segment inside `workspaceDir`
 * (no absolute paths, no `..` escape, no multi-segment paths).
 */
export function isModelSlugContained(workspaceDir: string, slug: string): boolean {
    if (!slug || slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') {
        return false;
    }
    if (/^\.+$/.test(slug)) return false;
    const workspace = path.resolve(workspaceDir);
    const target = path.resolve(workspace, slug);
    const relative = path.relative(workspace, target);
    if (!relative || path.isAbsolute(relative)) return false;
    if (relative === '..' || relative.startsWith(`..${path.sep}`)) return false;
    return true;
}

/**
 * Allocate unique folder slugs for a list of model names.
 * Duplicate sanitized names get a numeric suffix (-2, -3, ...).
 */
export function uniqueModelSlugs(models: string[]): string[] {
    const used = new Map<string, number>();
    return models.map(model => {
        const base = sanitizeModelSlug(model);
        const count = (used.get(base) || 0) + 1;
        used.set(base, count);
        return count === 1 ? base : `${base}-${count}`;
    });
}

/**
 * Parse `--script-compare modelA,modelB[,...]`.
 * Requires at least two distinct non-empty model names.
 */
export function parseScriptCompareModels(raw: string): string[] {
    const models = String(raw || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
    if (models.length < 2) {
        throw new Error(
            '--script-compare requires at least two comma-separated model names (e.g. --script-compare gpt-5.6-luna,gemini-3.5-flash).'
        );
    }
    const seen = new Set<string>();
    for (const model of models) {
        const key = model.toLowerCase();
        if (seen.has(key)) {
            throw new Error(`--script-compare models must be distinct; duplicate: ${model}`);
        }
        seen.add(key);
    }
    return models;
}

export function formatStageModelLog(stages: LectureGenStageModels): string {
    return [
        `answer/script model: ${stages.scriptModel}`,
        `animator/iagen/gamegen model: ${stages.animatorModel}`,
        stages.scriptModel === stages.defaultModel && stages.animatorModel === stages.defaultModel
            ? `(default: ${stages.defaultModel})`
            : `(fallback default: ${stages.defaultModel})`
    ].join('; ');
}
