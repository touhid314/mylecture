import fs from 'node:fs';
import path from 'node:path';

import { runLlm, type LectureGenLlmOptions } from './lecturegen_shared.js';
import type { ScriptBlock } from './script_trimmer.js';

export type VisualDirection = Readonly<{
    concept: string;
    palette: readonly string[];
    typography: string;
    visualLanguage: string;
    recurringMotifs: readonly string[];
    motionCharacter: string;
    density: 'minimal' | 'balanced' | 'dense';
    continuityRules: readonly string[];
}>;

export type SceneBrief = Readonly<{
    index: number;
    totalScenes: number;
    outputPath: string;
    narrationFocus: string;
    visualPurpose: string;
    previousConcept?: string;
    nextConcept?: string;
    continuityNotes: readonly string[];
}>;

export type SceneTaskStatus =
    | 'queued'
    | 'generating'
    | 'preflight'
    | 'validating'
    | 'repairing'
    | 'complete'
    | 'failed';

export type SceneTaskState = Readonly<{
    index: number;
    totalScenes: number;
    outputPath: string;
    status: SceneTaskStatus;
    repairAttempt: number;
    maximumRepairs: number;
    findings?: readonly string[];
    error?: string;
}>;

export type SceneTaskResult = Readonly<{
    state: SceneTaskState;
    html: string;
}>;

export type SceneOrchestrationConfig = Readonly<{
    creativeDirectionEnabled: boolean;
    parallelScenesEnabled: boolean;
    optionalSceneHelpersEnabled: boolean;
    globalLlmConcurrency: number;
    globalBrowserValidationConcurrency: number;
    perJobSceneConcurrency: number;
}>;

export type ContinuityFinding = Readonly<{
    severity: 'error' | 'warning';
    category: 'standalone' | 'aspect-ratio' | 'duplicate-id' | 'typography' | 'theme-tokens';
    message: string;
    files: readonly string[];
}>;

export type ContinuityReport = Readonly<{
    passed: boolean;
    findings: readonly ContinuityFinding[];
}>;

type DirectionGenerationInput = LectureGenLlmOptions & {
    request: string;
    script: string;
    aspectRatio: string;
    theme: string;
    teachingStyle: string;
};

type IndependentSceneRunnerInput = {
    tasks: readonly SceneBrief[];
    config: SceneOrchestrationConfig;
    maximumRepairs?: number;
    assertActive?: () => void;
    onTaskState?: (state: SceneTaskState) => void;
    generate: (task: SceneBrief, schedulers: SceneTaskSchedulers) => Promise<string>;
    validate: (
        task: SceneBrief,
        html: string,
        update: (status: 'preflight' | 'validating' | 'repairing', repairAttempt?: number, findings?: readonly string[]) => void,
        schedulers: SceneTaskSchedulers
    ) => Promise<string>;
};

export type SceneTaskSchedulers = Readonly<{
    runLlm: <T>(operation: () => Promise<T>) => Promise<T>;
    runBrowserValidation: <T>(operation: () => Promise<T>) => Promise<T>;
}>;

const CREATIVE_DIRECTION_SYSTEM_PROMPT = `You are the visual director for a multi-scene educational video.
Create a concise, coherent visual direction that gives independent scene animators shared intent without prescribing layouts.
Preserve creative freedom: describe the visual character, recurring motifs, motion character, and continuity constraints, but never require cards, columns, panels, or a particular rendering medium.
Return only one JSON object with these exact keys:
concept (string), palette (string array), typography (string), visualLanguage (string), recurringMotifs (string array), motionCharacter (string), density (minimal|balanced|dense), continuityRules (string array).`;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function envBoolean(value: string | undefined, fallback: boolean): boolean {
    const normalized = value?.replace(/['"]/g, '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
    const normalized = value?.replace(/['"]/g, '').trim();
    const parsed = Number(normalized);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSceneOrchestrationConfig(env: NodeJS.ProcessEnv = process.env): SceneOrchestrationConfig {
    return Object.freeze({
        creativeDirectionEnabled: envBoolean(env.LECTUREGEN_CREATIVE_DIRECTION, false),
        parallelScenesEnabled: envBoolean(env.LECTUREGEN_PARALLEL_SCENES, false),
        optionalSceneHelpersEnabled: envBoolean(env.LECTUREGEN_SCENE_HELPERS, false),
        globalLlmConcurrency: positiveInteger(env.LECTUREGEN_SCENE_LLM_CONCURRENCY, 2),
        globalBrowserValidationConcurrency: positiveInteger(env.LECTUREGEN_BROWSER_VALIDATION_CONCURRENCY, 1),
        perJobSceneConcurrency: positiveInteger(env.LECTUREGEN_SCENE_CONCURRENCY_PER_JOB, 2)
    });
}

function asTrimmedString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown, fallback: readonly string[], maximum = 8): readonly string[] {
    const items = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
        : [];
    return Object.freeze((items.length > 0 ? items : [...fallback]).slice(0, maximum));
}

function freezeVisualDirection(value: {
    concept: string;
    palette: readonly string[];
    typography: string;
    visualLanguage: string;
    recurringMotifs: readonly string[];
    motionCharacter: string;
    density: 'minimal' | 'balanced' | 'dense';
    continuityRules: readonly string[];
}): VisualDirection {
    return Object.freeze({
        ...value,
        palette: Object.freeze([...value.palette]),
        recurringMotifs: Object.freeze([...value.recurringMotifs]),
        continuityRules: Object.freeze([...value.continuityRules])
    });
}

function compactText(value: string, maximum = 280): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function extractJsonObject(response: string): Record<string, unknown> {
    const normalized = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Visual direction response did not contain a JSON object.');
    const value = JSON.parse(normalized.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Visual direction response must be a JSON object.');
    }
    return value as Record<string, unknown>;
}

export function createFallbackVisualDirection(input: {
    request: string;
    theme: string;
    teachingStyle: string;
}): VisualDirection {
    const palette = [...new Set(input.theme.match(/#[\da-f]{3,8}\b/gi) || [])].slice(0, 6);
    return freezeVisualDirection({
        concept: compactText(input.request, 180),
        palette: palette.length > 0 ? palette : ['Follow the selected theme palette'],
        typography: 'Follow the selected theme typography while prioritizing legibility.',
        visualLanguage: 'Use a coherent visual language suited to the subject; choose DOM, SVG, Canvas, or mixed media scene by scene.',
        recurringMotifs: ['Reuse meaningful subject-specific forms when they strengthen continuity.'],
        motionCharacter: 'Use purposeful motion that explains change, causality, comparison, or emphasis.',
        density: /dense|detailed|technical/i.test(`${input.theme}\n${input.teachingStyle}`) ? 'dense' : 'balanced',
        continuityRules: [
            'Preserve the selected theme and teaching style across scenes.',
            'Keep recurring visual ideas recognizable without repeating a fixed composition.',
            'Let each scene choose the medium and layout that best communicate its content.'
        ]
    });
}

export async function generateCreativeDirection(input: DirectionGenerationInput): Promise<VisualDirection> {
    const response = await runLlm(
        input,
        'lecturegen_visual_direction',
        CREATIVE_DIRECTION_SYSTEM_PROMPT,
        [
            `Original request: ${input.request}`,
            `Aspect ratio: ${input.aspectRatio}`,
            '',
            '# Selected Theme', input.theme,
            '',
            '# Teaching Style', input.teachingStyle,
            '',
            '# Complete Audiovisual Script', input.script
        ].join('\n')
    );
    const value = extractJsonObject(response);
    const densityValue = asTrimmedString(value.density, 'balanced').toLowerCase();
    const density: VisualDirection['density'] = densityValue === 'minimal' || densityValue === 'dense'
        ? densityValue
        : 'balanced';
    return freezeVisualDirection({
        concept: asTrimmedString(value.concept, compactText(input.request, 180)),
        palette: asStringArray(value.palette, ['Follow the selected theme palette']),
        typography: asTrimmedString(value.typography, 'Follow the selected theme typography.'),
        visualLanguage: asTrimmedString(value.visualLanguage, 'Use a coherent subject-specific visual language.'),
        recurringMotifs: asStringArray(value.recurringMotifs, ['Use recurring subject-specific forms where natural.']),
        motionCharacter: asTrimmedString(value.motionCharacter, 'Use purposeful explanatory motion.'),
        density,
        continuityRules: asStringArray(value.continuityRules, [
            'Preserve visual continuity without repeating a fixed layout.',
            'Choose the best rendering medium independently for each scene.'
        ])
    });
}

function linesForPrefix(block: ScriptBlock, prefix: 'N' | 'V'): string[] {
    const matcher = new RegExp(`^\\s*${prefix}:\\s*(.+)$`, 'i');
    return block.content.split(/\r?\n/)
        .map(line => line.match(matcher)?.[1]?.trim() || '')
        .filter(Boolean);
}

function summarizeBlock(block: ScriptBlock | undefined): string | undefined {
    if (!block) return undefined;
    const narration = linesForPrefix(block, 'N');
    const visuals = linesForPrefix(block, 'V');
    const source = narration[0] || visuals[0] || block.content;
    return compactText(source, 180);
}

export function buildSceneBriefs(blocks: readonly ScriptBlock[], direction: VisualDirection): readonly SceneBrief[] {
    const totalScenes = blocks.length;
    return Object.freeze(blocks.map((block, position) => Object.freeze({
        index: block.index,
        totalScenes,
        outputPath: totalScenes === 1 ? 'index.html' : `index${block.index}.html`,
        narrationFocus: compactText(linesForPrefix(block, 'N').join(' '), 320),
        visualPurpose: compactText(linesForPrefix(block, 'V').join(' '), 320),
        previousConcept: summarizeBlock(blocks[position - 1]),
        nextConcept: summarizeBlock(blocks[position + 1]),
        continuityNotes: Object.freeze([
            ...direction.continuityRules.slice(0, 3),
            'Use shared motifs only where they clarify this scene; do not force a repeated composition.'
        ])
    })));
}

export function formatVisualDirection(direction: VisualDirection): string {
    return [
        `Concept: ${direction.concept}`,
        `Palette: ${direction.palette.join(' | ')}`,
        `Typography: ${direction.typography}`,
        `Visual language: ${direction.visualLanguage}`,
        `Recurring motifs: ${direction.recurringMotifs.join(' | ')}`,
        `Motion character: ${direction.motionCharacter}`,
        `Density: ${direction.density}`,
        'Continuity rules:',
        ...direction.continuityRules.map(rule => `- ${rule}`)
    ].join('\n');
}

export function formatSceneBrief(brief: SceneBrief): string {
    return [
        `Scene ${brief.index} of ${brief.totalScenes}`,
        `Narration focus: ${brief.narrationFocus || 'Follow the supplied narration faithfully.'}`,
        `Visual purpose: ${brief.visualPurpose || 'Choose a clear visual interpretation of the supplied cue.'}`,
        brief.previousConcept ? `Previous concept: ${brief.previousConcept}` : '',
        brief.nextConcept ? `Next concept: ${brief.nextConcept}` : '',
        'Continuity notes:',
        ...brief.continuityNotes.map(note => `- ${note}`),
        'The brief defines intent, not composition. Choose the most effective medium, layout, and motion for this scene.'
    ].filter(Boolean).join('\n');
}

export function writeImmutableJsonArtifact(workspaceDir: string, filename: string, value: unknown): string {
    const target = path.resolve(workspaceDir, filename);
    const relative = path.relative(path.resolve(workspaceDir), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Refusing to write scene artifact outside the generation workspace: ${filename}`);
    }
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (fs.existsSync(target)) {
        if (fs.readFileSync(target, 'utf8') === serialized) return target;
        throw new Error(`Refusing to overwrite immutable scene artifact: ${filename}`);
    }
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, serialized, 'utf8');
    fs.renameSync(temporary, target);
    return target;
}

class AsyncSemaphore {
    private active = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(private readonly capacity: number) {
        if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Semaphore capacity must be a positive integer.');
    }

    private async acquire(): Promise<void> {
        if (this.active < this.capacity) {
            this.active += 1;
            return;
        }
        await new Promise<void>(resolve => this.waiters.push(resolve));
    }

    private release(): void {
        const next = this.waiters.shift();
        if (next) {
            // Transfer this permit directly. Keeping active unchanged prevents a
            // newly arriving task from racing the queued waiter for the slot.
            next();
            return;
        }
        this.active -= 1;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }
}

type GlobalLimiters = { llm: AsyncSemaphore; browserValidation: AsyncSemaphore };
const globalLimiterPools = new Map<string, GlobalLimiters>();

function globalLimiters(config: SceneOrchestrationConfig): GlobalLimiters {
    const key = `${config.globalLlmConcurrency}:${config.globalBrowserValidationConcurrency}`;
    let limiters = globalLimiterPools.get(key);
    if (!limiters) {
        limiters = {
            llm: new AsyncSemaphore(config.globalLlmConcurrency),
            browserValidation: new AsyncSemaphore(config.globalBrowserValidationConcurrency)
        };
        globalLimiterPools.set(key, limiters);
    }
    return limiters;
}

function freezeTaskState(state: Omit<SceneTaskState, 'findings'> & { findings?: readonly string[] }): SceneTaskState {
    return Object.freeze({
        ...state,
        findings: state.findings ? Object.freeze([...state.findings]) : undefined
    });
}

/**
 * Runs isolated scene generation behind global LLM/browser limits and a per-job
 * limit. The two scheduler functions deliberately acquire independent permits:
 * callers use the LLM scheduler for generation/repair calls and the browser
 * scheduler only for validator executions.
 */
export async function runIndependentSceneTasks(input: IndependentSceneRunnerInput): Promise<readonly SceneTaskResult[]> {
    const maximumRepairs = input.maximumRepairs ?? 5;
    const perJob = new AsyncSemaphore(input.config.perJobSceneConcurrency);
    const global = globalLimiters(input.config);
    const schedulers: SceneTaskSchedulers = Object.freeze({
        runLlm: <T>(operation: () => Promise<T>) => global.llm.run(operation),
        runBrowserValidation: <T>(operation: () => Promise<T>) => global.browserValidation.run(operation)
    });
    const publish = (
        brief: SceneBrief,
        status: SceneTaskStatus,
        repairAttempt = 0,
        findings?: readonly string[],
        error?: string
    ): SceneTaskState => {
        const state = freezeTaskState({
            index: brief.index,
            totalScenes: brief.totalScenes,
            outputPath: brief.outputPath,
            status,
            repairAttempt,
            maximumRepairs,
            findings,
            error
        });
        input.onTaskState?.(state);
        return state;
    };

    for (const task of input.tasks) publish(task, 'queued');
    const settled = await Promise.allSettled(input.tasks.map(brief => perJob.run(async () => {
        input.assertActive?.();
        publish(brief, 'generating');
        try {
            input.assertActive?.();
            const generated = await input.generate(brief, schedulers);
            input.assertActive?.();
            publish(brief, 'preflight');
            const valid = await input.validate(brief, generated, (status, repairAttempt = 0, findings) => {
                publish(brief, status, repairAttempt, findings);
            }, schedulers);
            input.assertActive?.();
            const state = publish(brief, 'complete');
            return Object.freeze({ state, html: valid });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            publish(brief, 'failed', 0, undefined, message);
            throw error;
        }
    })));
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
    const results = settled.map(result => (result as PromiseFulfilledResult<SceneTaskResult>).value);
    return Object.freeze(results.sort((left, right) => left.state.index - right.state.index));
}

function metadataAspectRatio(html: string): string | null {
    const metadata = html.match(/(?:window\.)?__VIDEO_METADATA__\s*=\s*\{([\s\S]{0,5000}?)\}/i)?.[1] || '';
    return metadata.match(/["']?aspectRatio["']?\s*:\s*['"]([^'"]+)['"]/i)?.[1]?.trim() || null;
}

function planIds(html: string): string[] {
    const plan = html.match(/(?:window\.)?__VIDEO_PLAN__\s*=\s*\[([\s\S]*?)\]\s*;/i)?.[1] || '';
    return [...plan.matchAll(/(?:^|[,\{])\s*["']?id["']?\s*:\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function primaryFontFamilies(html: string): Set<string> {
    return new Set([...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)]
        .map(match => match[1].split(',')[0].replace(/['"]/g, '').trim().toLowerCase())
        .filter(Boolean));
}

function cssThemeTokens(html: string): Set<string> {
    return new Set([...html.matchAll(/--[a-z][\w-]*(?=\s*:)/gi)].map(match => match[0].toLowerCase()));
}

function intersects(left: Set<string>, right: Set<string>): boolean {
    for (const value of left) if (right.has(value)) return true;
    return false;
}

export function checkDeterministicContinuity(
    files: readonly Readonly<{ path: string; content: string }>[],
    expectedAspectRatio: string
): ContinuityReport {
    const findings: ContinuityFinding[] = [];
    const idOwners = new Map<string, string>();
    let baselineFonts: Set<string> | null = null;
    let baselineTokens: Set<string> | null = null;

    for (const file of files) {
        if (!/<html\b/i.test(file.content) || !/<\/html\s*>/i.test(file.content)) {
            findings.push(Object.freeze({
                severity: 'error', category: 'standalone', files: Object.freeze([file.path]),
                message: `${file.path} is not a complete standalone HTML document.`
            }));
        }
        const aspectRatio = metadataAspectRatio(file.content);
        if (aspectRatio && aspectRatio !== expectedAspectRatio) {
            findings.push(Object.freeze({
                severity: 'error', category: 'aspect-ratio', files: Object.freeze([file.path]),
                message: `${file.path} declares aspect ratio ${aspectRatio}; expected ${expectedAspectRatio}.`
            }));
        }
        for (const id of planIds(file.content)) {
            const owner = idOwners.get(id);
            if (owner) {
                findings.push(Object.freeze({
                    severity: 'error', category: 'duplicate-id', files: Object.freeze([owner, file.path]),
                    message: `Video-plan id ${id} is duplicated across ${owner} and ${file.path}.`
                }));
            } else {
                idOwners.set(id, file.path);
            }
        }
        const fonts = primaryFontFamilies(file.content);
        if (baselineFonts && fonts.size > 0 && baselineFonts.size > 0 && !intersects(baselineFonts, fonts)) {
            findings.push(Object.freeze({
                severity: 'warning', category: 'typography', files: Object.freeze([files[0]?.path || '', file.path].filter(Boolean)),
                message: `${file.path} does not share a primary font family with the first scene; review whether this is intentional.`
            }));
        } else if (!baselineFonts && fonts.size > 0) {
            baselineFonts = fonts;
        }
        const tokens = cssThemeTokens(file.content);
        if (baselineTokens && tokens.size >= 2 && baselineTokens.size >= 2 && !intersects(baselineTokens, tokens)) {
            findings.push(Object.freeze({
                severity: 'warning', category: 'theme-tokens', files: Object.freeze([files[0]?.path || '', file.path].filter(Boolean)),
                message: `${file.path} shares no CSS theme tokens with the first scene; review theme continuity.`
            }));
        } else if (!baselineTokens && tokens.size > 0) {
            baselineTokens = tokens;
        }
    }
    return Object.freeze({
        passed: findings.every(finding => finding.severity !== 'error'),
        findings: Object.freeze(findings)
    });
}
