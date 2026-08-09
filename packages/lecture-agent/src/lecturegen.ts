/**
 * lecturegen.ts
 *
 * Complete static video-generation control unit. This one module contains:
 *
 * - `LectureGen`, which conditionally runs answer generation, script writing,
 *   optional image fetching, narration-aware trimming, sequential animation,
 *   interactive/game generation, HTML validation/repair, and metadata writing.
 * - `generateLecture()`, the programmatic API used by the IDE.
 * - workspace and attachment helpers used by API callers.
 * - `runLectureGenCli()`, the direct-run CLI control.
 *
 * The CLI creates a unique generation folder beneath `--workspace` and writes
 * `answer.md`, `script.md`, `metadata.json`, `index*.html`, copied attachments,
 * and downloaded assets there:
 *
 *   npm run lecturegen -- --workspace ".\generations" --length 2:00
 *     --aspect-ratio 16:9 "Explain binary search"
 *
 * Coursegen passes `--workspace-dir` to write into an exact lecture folder
 * (no nested unique generation folder).
 *
 * Pass `--interactive` and/or `--game` for standalone learning experiences.
 * Pass `--no-video` to skip video-only stages, or `--no-getimg` to prohibit
 * external image requests (bundled Natural Earth world basemap is still copied).
 * Optional `--script-model` / `--animator-model` (or SCRIPT_MODEL / ANIMATOR_MODEL)
 * split answer+script vs animator/iagen/gamegen. `--script-compare a,b` runs a
 * script-only A/B with one shared answer and per-model script folders.
 * `SCRIPT_TRIMMER_CHUNK_SIZE` is required for normal video generation. It sets the
 * maximum narration words per animator block; the minimum is half that value,
 * rounded up.
 *
 * Animator calls run sequentially in one retained LLM session by default so
 * prior validated generations remain in context and provider prompt caching can
 * apply. A shared creative-direction packet and per-scene intent briefs preserve
 * continuity without prescribing layouts. LECTUREGEN_PARALLEL_SCENES=true opts
 * into isolated, bounded scene generation/validation tasks; the default remains
 * the retained sequential path.
 *
 * Importing this module has no CLI side effects. The CLI runs only when this file
 * is executed directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { extract_upload_attachments, is_upload_supported_path } from './prompt_builder.js';
import { generateAnswer } from './answer_generator.js';
import { generateMetadata, resolveMetadataModel, type LectureMetadata } from './metadata_generator.js';
import { fetchAssets, formatAssetDescriptions, stripImageRequests, type AssetDescription } from './asset_fetcher.js';
import { AnimatorSession, animateScriptBlock, getAnimatorMaxPreviousHtmls, slicePreviousHtmls, validateAndRepairHtml, type PreviousHtml } from './animator.js';
import { runGameGen } from './gamegen.js';
import { runIAGen } from './iagen.js';
import { getScriptTrimmerChunkSizes, trimScriptByNarration, validateAudiovisualScript } from './script_trimmer.js';
import { writeScript } from './script_writer.js';
import type { LectureGenAttachment } from './lecturegen_shared.js';
import {
    buildSceneBriefs,
    checkDeterministicContinuity,
    createFallbackVisualDirection,
    formatSceneBrief,
    formatVisualDirection,
    generateCreativeDirection,
    getSceneOrchestrationConfig,
    runIndependentSceneTasks,
    writeImmutableJsonArtifact,
    type SceneBrief,
    type SceneTaskState
} from './scene_orchestration.js';
import {
    formatStageModelLog,
    isModelSlugContained,
    parseScriptCompareModels,
    resolveLectureGenStageModels,
    uniqueModelSlugs
} from './stage_models.js';
import { ensureWorldBasemapInWorkspace, formatWorldBasemapDescription } from './world_basemap.js';
import { DEFAULT_WORKSPACE_DIR } from './workspace.js';

export type LectureGenOptions = {
    model: string;
    scriptModel?: string;
    animatorModel?: string;
    workspaceDir: string;
    tokenTrackerSessionId?: string | null;
    onLog?: (text: string) => void;
    /** Package-local scene lifecycle hook; server callers may map this to their own persisted progress contract. */
    onSceneTaskState?: (state: SceneTaskState) => void;
};

export type ParsedLectureGenRequest = {
    request: string;
    aspectRatio: string;
    generationLength: string;
    enableGetimg: boolean;
    includeVideo: boolean;
    includeInteractive: boolean;
    includeGame: boolean;
    theme: string;
    teachingStyle: string;
    attachments: LectureGenAttachment[];
};

const SETTINGS_MARKER = 'if the user query is for lecture generation then follow this:';
const ATTACHMENT_DIRECTIVE = /\s*\[\(attachment:\s*[^\]]+\)\]/gi;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function lectureGenNowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function formatLectureGenDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function valueAfter(label: string, text: string, fallback: string): string {
    const match = text.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\r\\n]+)`, 'i'));
    return match?.[1]?.trim() || fallback;
}

export function parseLectureGenRequest(task: string, workspaceDir: string): ParsedLectureGenRequest {
    const attachments = extract_upload_attachments(task, workspaceDir) as LectureGenAttachment[];
    const markerIndex = task.indexOf(SETTINGS_MARKER);
    const rawRequest = (markerIndex >= 0 ? task.slice(0, markerIndex) : task)
        .replace(/\[Context:[\s\S]*?\]\s*/g, '')
        .replace(ATTACHMENT_DIRECTIVE, '')
        .trim();
    const settings = markerIndex >= 0 ? task.slice(markerIndex + SETTINGS_MARKER.length) : '';
    const themeStart = settings.search(/(?:^|\n)theme:\s*/i);
    const teachingStart = settings.search(/(?:^|\n)teaching style:\s*/i);
    const theme = themeStart >= 0
        ? settings.slice(settings.indexOf(':', themeStart) + 1, teachingStart >= 0 ? teachingStart : settings.length).replace(ATTACHMENT_DIRECTIVE, '').trim()
        : '';
    const teachingStyle = teachingStart >= 0
        ? settings.slice(settings.indexOf(':', teachingStart) + 1).replace(ATTACHMENT_DIRECTIVE, '').trim()
        : '';

    return {
        request: rawRequest || 'Create a lecture video using the attached material.',
        aspectRatio: valueAfter('aspect ratio', settings, '16:9'),
        generationLength: valueAfter('generation length', settings, '1:00'),
        enableGetimg: valueAfter('getimg enabled', settings, 'yes').toLowerCase() !== 'no',
        includeVideo: valueAfter('output video', settings, 'yes').toLowerCase() !== 'no',
        includeInteractive: valueAfter('output interactive', settings, 'no').toLowerCase() === 'yes',
        includeGame: valueAfter('output practice game', settings, 'no').toLowerCase() === 'yes',
        theme,
        teachingStyle,
        attachments
    };
}

export class LectureGen {
    private readonly options: LectureGenOptions;

    constructor(options: LectureGenOptions) {
        this.options = options;
    }

    startChat() {
        let used = false;
        let cancelled = false;
        return {
            cancelTurn: () => { cancelled = true; },
            sendMessage: async (task: string, _unused?: unknown, signal?: AbortSignal): Promise<string> => {
                if (used) {
                    throw new Error('Static generation currently supports one request per chat. Start a New Chat to generate another lesson.');
                }
                used = true;
                cancelled = false;
                const assertActive = () => {
                    if (cancelled || signal?.aborted) throw new Error('Static generation was stopped.');
                };
                const log = (message: string) => this.options.onLog?.(`[lecturegen] ${message}\n`);
                const generationStartedAt = lectureGenNowMs();
                const input = parseLectureGenRequest(task, this.options.workspaceDir);
                if (!input.includeVideo && !input.includeInteractive && !input.includeGame) {
                    throw new Error('Select at least one output: video, interactive, or practice game.');
                }
                if (!input.theme) {
                    input.theme = fs.readFileSync(path.resolve(moduleDir, '..', '.agents', 'mylecture-themes', 'default.md'), 'utf8');
                }
                if (!input.teachingStyle) {
                    input.teachingStyle = fs.readFileSync(path.resolve(moduleDir, '..', '.agents', 'mylecture-teaching-style', 'default.md'), 'utf8');
                }
                const stages = resolveLectureGenStageModels({
                    model: this.options.model,
                    scriptModel: this.options.scriptModel,
                    animatorModel: this.options.animatorModel
                });
                log(formatStageModelLog(stages));
                const shared = {
                    tokenTrackerSessionId: this.options.tokenTrackerSessionId,
                    promptWorkspaceDir: this.options.workspaceDir
                };
                const scriptCommon = { ...shared, model: stages.scriptModel };
                const animatorCommon = { ...shared, model: stages.animatorModel };
                fs.mkdirSync(this.options.workspaceDir, { recursive: true });

                type SupplementalGenerationResult = {
                    outputPath: 'interactive.html' | 'game.html';
                    html?: string;
                    error?: unknown;
                };
                const supplementalTasks: Array<Promise<SupplementalGenerationResult>> = [];
                const startSupplementalGeneration = (referenceMaterial?: string) => {
                    const source = referenceMaterial ? 'script.md' : 'the user request';
                    if (input.includeInteractive) {
                        log(`Starting IAGen from ${source}${input.includeVideo ? ' in parallel with the video pipeline' : ''}...`);
                        supplementalTasks.push(
                            runIAGen({
                                ...animatorCommon,
                                request: input.request,
                                aspectRatio: input.aspectRatio,
                                referenceMaterial,
                                attachments: input.attachments
                            })
                                .then(html => ({ outputPath: 'interactive.html' as const, html }))
                                .catch(error => ({ outputPath: 'interactive.html' as const, error }))
                        );
                    }
                    if (input.includeGame) {
                        log(`Starting GameGen from ${source}${input.includeVideo ? ' in parallel with the video pipeline' : ''}...`);
                        supplementalTasks.push(
                            runGameGen({
                                ...animatorCommon,
                                request: input.request,
                                aspectRatio: input.aspectRatio,
                                referenceMaterial,
                                attachments: input.attachments
                            })
                                .then(html => ({ outputPath: 'game.html' as const, html }))
                                .catch(error => ({ outputPath: 'game.html' as const, error }))
                        );
                    }
                };

                let script = '';
                let metadataPromise: Promise<LectureMetadata | null> | null = null;
                if (input.includeVideo) {
                    const chunkSizes = getScriptTrimmerChunkSizes();
                    getAnimatorMaxPreviousHtmls();
                    log(`Generating the concept answer with ${stages.scriptModel}...`);
                    const answer = await generateAnswer({
                        ...scriptCommon,
                        request: input.request,
                        generationLength: input.generationLength,
                        teachingStyle: input.teachingStyle,
                        attachments: input.attachments
                    });
                    assertActive();
                    fs.writeFileSync(path.join(this.options.workspaceDir, 'answer.md'), answer, 'utf8');

                    metadataPromise = (async () => {
                        const metadataModel = resolveMetadataModel();
                        log(`Generating metadata with ${metadataModel} in parallel with the rest of the pipeline...`);
                        return generateMetadata({
                            ...shared,
                            model: metadataModel,
                            request: input.request,
                            answer
                        });
                    })().catch(error => {
                        log(`Metadata generation failed; falling back to a default title/description: ${error instanceof Error ? error.message : error}`);
                        return null;
                    });

                    log(`Writing the audiovisual script with ${stages.scriptModel}...`);
                    script = await writeScript({
                        ...scriptCommon,
                        request: input.request,
                        generationLength: input.generationLength,
                        answer,
                        theme: input.theme,
                        teachingStyle: input.teachingStyle,
                        enableGetimg: input.enableGetimg,
                        attachments: input.attachments
                    });
                    assertActive();
                    if (!input.enableGetimg) script = stripImageRequests(script);
                    fs.writeFileSync(path.join(this.options.workspaceDir, 'script.md'), script, 'utf8');
                    validateAudiovisualScript(script);
                    startSupplementalGeneration(script);

                    const worldBasemapPath = ensureWorldBasemapInWorkspace(this.options.workspaceDir);

                    let assets: AssetDescription[] = [];
                    if (input.enableGetimg) {
                        log('Fetching requested image assets...');
                        assets = await fetchAssets(script, this.options.workspaceDir);
                    } else {
                        log('getimg disabled; skipping external image fetcher.');
                    }
                    assertActive();

                    const scriptBlocks = trimScriptByNarration(
                        script,
                        chunkSizes.maximumNarrationWords,
                        chunkSizes.minimumNarrationWords
                    );
                    log(
                        `Split the script into ${scriptBlocks.length} narration-based animation block(s), `
                        + `targeting ${chunkSizes.minimumNarrationWords}–${chunkSizes.maximumNarrationWords} words each.`
                    );
                    const uploadedAssets = input.attachments
                        .filter(attachment => attachment.kind === 'image')
                        .map(attachment => `- ${path.relative(this.options.workspaceDir, attachment.path).replaceAll('\\', '/')}: uploaded image supplied by the user`)
                        .join('\n');
                    const assetDescriptions = [
                        formatWorldBasemapDescription(worldBasemapPath),
                        formatAssetDescriptions(assets),
                        uploadedAssets
                    ].filter(Boolean).join('\n');
                    const orchestration = getSceneOrchestrationConfig();
                    const useCreativeDirection = orchestration.creativeDirectionEnabled || orchestration.parallelScenesEnabled;
                    let visualDirection = createFallbackVisualDirection({
                        request: input.request,
                        theme: input.theme,
                        teachingStyle: input.teachingStyle
                    });
                    if (useCreativeDirection) {
                        log('Creating a shared visual direction for the scene animators...');
                        try {
                            visualDirection = await generateCreativeDirection({
                                ...animatorCommon,
                                request: input.request,
                                script,
                                aspectRatio: input.aspectRatio,
                                theme: input.theme,
                                teachingStyle: input.teachingStyle
                            });
                        } catch (error) {
                            log(`Visual-direction generation failed; using deterministic request/theme guidance: ${error instanceof Error ? error.message : error}`);
                        }
                        assertActive();
                    }
                    const sceneBriefs = buildSceneBriefs(scriptBlocks, visualDirection);
                    if (useCreativeDirection) {
                        writeImmutableJsonArtifact(this.options.workspaceDir, 'visual-direction.json', visualDirection);
                        writeImmutableJsonArtifact(this.options.workspaceDir, 'scene-briefs.json', sceneBriefs);
                    }
                    const briefByIndex = new Map(sceneBriefs.map(brief => [brief.index, brief]));
                    const blockByIndex = new Map(scriptBlocks.map(block => [block.index, block]));
                    const buildAnimatorInput = (
                        brief: SceneBrief,
                        previousHtmls: PreviousHtml[]
                    ) => {
                        const block = blockByIndex.get(brief.index);
                        if (!block) throw new Error(`Missing script block for scene ${brief.index}.`);
                        return {
                            ...animatorCommon,
                            request: useCreativeDirection
                                ? `${input.request}\n\n# Shared Visual Direction\n${formatVisualDirection(visualDirection)}`
                                : input.request,
                            aspectRatio: input.aspectRatio,
                            generationLength: input.generationLength,
                            scriptBlock: useCreativeDirection
                                ? `${block.content}\n\n# Scene Intent Brief\n${formatSceneBrief(brief)}`
                                : block.content,
                            blockIndex: block.index,
                            totalBlocks: scriptBlocks.length,
                            outputPath: brief.outputPath,
                            theme: input.theme,
                            teachingStyle: input.teachingStyle,
                            assetDescriptions,
                            previousHtmls: slicePreviousHtmls(previousHtmls),
                            attachments: input.attachments
                        };
                    };

                    let completedHtmls: PreviousHtml[] = [];
                    if (!orchestration.parallelScenesEnabled) {
                        const animatorSession = new AnimatorSession(animatorCommon);
                        log(`Using one retained animator LLM session (${stages.animatorModel}) for sequential context and prompt caching.`);
                        for (const block of scriptBlocks) {
                            assertActive();
                            const brief = briefByIndex.get(block.index);
                            if (!brief) throw new Error(`Missing scene brief for script block ${block.index}.`);
                            this.options.onSceneTaskState?.(Object.freeze({
                                index: brief.index,
                                totalScenes: brief.totalScenes,
                                outputPath: brief.outputPath,
                                status: 'generating',
                                repairAttempt: 0,
                                maximumRepairs: 5
                            }));
                            log(`Animating ${brief.outputPath} from script block ${block.index}/${scriptBlocks.length} (${block.narrationWords} narration words)...`);
                            const animatorInput = buildAnimatorInput(brief, completedHtmls);
                            const generatedHtml = await animateScriptBlock(animatorInput, animatorSession);
                            assertActive();
                            let repairAttempt = 0;
                            const validHtml = await validateAndRepairHtml(
                                animatorInput,
                                animatorSession,
                                this.options.workspaceDir,
                                generatedHtml,
                                validation => {
                                    log(validation);
                                    const isMechanicalPreflight = validation.startsWith('Mechanical preflight:');
                                    if (!validation.includes('validation passed')
                                        && !validation.startsWith('Animator repair attempt failed')
                                        && !isMechanicalPreflight) {
                                        repairAttempt += 1;
                                    }
                                    this.options.onSceneTaskState?.(Object.freeze({
                                        index: brief.index,
                                        totalScenes: brief.totalScenes,
                                        outputPath: brief.outputPath,
                                        status: validation.includes('validation passed')
                                            ? 'validating'
                                            : isMechanicalPreflight ? 'preflight' : 'repairing',
                                        repairAttempt,
                                        maximumRepairs: 5,
                                        findings: Object.freeze([validation])
                                    }));
                                }
                            );
                            completedHtmls.push({ path: brief.outputPath, content: validHtml });
                            this.options.onSceneTaskState?.(Object.freeze({
                                index: brief.index,
                                totalScenes: brief.totalScenes,
                                outputPath: brief.outputPath,
                                status: 'complete',
                                repairAttempt,
                                maximumRepairs: 5
                            }));
                        }
                    } else {
                        log(
                            `Using isolated scene sessions with per-job concurrency ${orchestration.perJobSceneConcurrency}, `
                            + `global LLM concurrency ${orchestration.globalLlmConcurrency}, and browser-validation concurrency ${orchestration.globalBrowserValidationConcurrency}.`
                        );
                        const sessions = new Map<number, AnimatorSession>();
                        const animatorInputs = new Map<number, ReturnType<typeof buildAnimatorInput>>();
                        const results = await runIndependentSceneTasks({
                            tasks: sceneBriefs,
                            config: orchestration,
                            assertActive,
                            onTaskState: state => {
                                this.options.onSceneTaskState?.(state);
                                if (state.status === 'generating') log(`Creating scene ${state.index}/${sceneBriefs.length} (${state.outputPath})...`);
                                if (state.status === 'validating') log(`Checking scene ${state.index}/${sceneBriefs.length}...`);
                                if (state.status === 'repairing') log(`Repairing scene ${state.index}/${sceneBriefs.length}, attempt ${state.repairAttempt}/${state.maximumRepairs}...`);
                            },
                            generate: async (brief, schedulers) => {
                                const session = new AnimatorSession(animatorCommon, schedulers.runLlm);
                                const animatorInput = buildAnimatorInput(brief, []);
                                sessions.set(brief.index, session);
                                animatorInputs.set(brief.index, animatorInput);
                                return animateScriptBlock(animatorInput, session);
                            },
                            validate: async (brief, html, update, schedulers) => {
                                const session = sessions.get(brief.index);
                                const animatorInput = animatorInputs.get(brief.index);
                                if (!session || !animatorInput) throw new Error(`Scene ${brief.index} lost its isolated animator state.`);
                                let repairAttempt = 0;
                                update('validating');
                                return validateAndRepairHtml(
                                    animatorInput,
                                    session,
                                    this.options.workspaceDir,
                                    html,
                                    validation => {
                                        log(`[${brief.outputPath}] ${validation}`);
                                        if (validation.includes('validation passed')) {
                                            update('validating', repairAttempt);
                                        } else if (validation.startsWith('Mechanical preflight:')) {
                                            update('preflight', repairAttempt);
                                        } else if (validation.startsWith('Animator repair attempt failed')) {
                                            update('repairing', repairAttempt, [validation]);
                                        } else {
                                            repairAttempt += 1;
                                            update('repairing', repairAttempt, [validation]);
                                        }
                                    },
                                    5,
                                    {
                                        runValidation: schedulers.runBrowserValidation,
                                        runLlm: schedulers.runLlm
                                    }
                                );
                            }
                        });
                        completedHtmls = results.map(result => ({ path: result.state.outputPath, content: result.html }));
                    }

                    const continuity = checkDeterministicContinuity(completedHtmls, input.aspectRatio);
                    for (const finding of continuity.findings) {
                        log(`Continuity ${finding.severity}: ${finding.message}`);
                    }
                    if (!continuity.passed) {
                        const errors = continuity.findings.filter(finding => finding.severity === 'error').map(finding => finding.message);
                        throw new Error(`Generated scenes failed deterministic continuity checks:\n${errors.join('\n')}`);
                    }
                } else {
                    log('Video output disabled; skipping answer, script, assets, trimmer, and animator.');
                    startSupplementalGeneration();
                }

                const supplementalResults = await Promise.all(supplementalTasks);
                assertActive();
                for (const result of supplementalResults) {
                    if (result.error) {
                        const detail = result.error instanceof Error ? result.error.message : String(result.error);
                        throw new Error(`${result.outputPath} generation failed: ${detail}`);
                    }
                    if (!result.html) throw new Error(`${result.outputPath} generation returned no HTML.`);
                    fs.writeFileSync(path.join(this.options.workspaceDir, result.outputPath), result.html, 'utf8');
                    log(`Finished ${result.outputPath}.`);
                }

                const metadata = metadataPromise ? await metadataPromise : null;
                const fallbackTitle = input.request.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Lecture';
                const title = metadata?.title || fallbackTitle;
                const description = metadata?.description || `A learning experience about ${fallbackTitle.replace(/[.!?]+$/, '')}.`;
                fs.writeFileSync(path.join(this.options.workspaceDir, 'metadata.json'), JSON.stringify({
                    title,
                    description
                }, null, 2), 'utf8');
                log(
                    `Static lesson generation complete in ${formatLectureGenDuration(lectureGenNowMs() - generationStartedAt)}.`
                );
                return 'Done making the requested learning experience.';
            }
        };
    }
}

export type LectureGenerationOptions = {
    request: string;
    model: string;
    scriptModel?: string;
    animatorModel?: string;
    parentWorkspace?: string;
    workspaceDir?: string;
    generationLength?: string;
    aspectRatio?: string;
    theme?: string;
    teachingStyle?: string;
    attachments?: string[];
    enableGetimg?: boolean;
    includeVideo?: boolean;
    includeInteractive?: boolean;
    includeGame?: boolean;
    tokenTrackerSessionId?: string | null;
    onLog?: (text: string) => void;
    onSceneTaskState?: (state: SceneTaskState) => void;
    signal?: AbortSignal;
};

export type LectureGenerationResult = {
    id: string;
    workspaceDir: string;
    entryFile: string;
    htmlFiles: string[];
    videoFiles: string[];
    interactiveFile?: string;
    gameFile?: string;
    output: string;
};

export function createGenerationWorkspace(parentWorkspace: string, now = new Date()): { id: string; path: string } {
    const parent = path.resolve(parentWorkspace);
    fs.mkdirSync(parent, { recursive: true });
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestamp = [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
        pad(now.getDate()),
        pad(now.getMonth() + 1),
        now.getFullYear()
    ].join('-');

    for (let attempt = 0; attempt < 20; attempt++) {
        const suffix = randomBytes(4).toString('hex').slice(0, 6);
        const id = `${timestamp}-${suffix}`;
        const generationPath = path.join(parent, id);
        try {
            fs.mkdirSync(generationPath);
            return { id, path: generationPath };
        } catch (error: any) {
            if (error?.code !== 'EEXIST') throw error;
        }
    }
    throw new Error(`Could not allocate a unique generation folder inside ${parent}.`);
}

function isInside(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function copyAttachmentsToGeneration(attachments: string[], generationPath: string): string[] {
    if (attachments.length === 0) return [];
    const workspace = path.resolve(generationPath);
    const uploadsDir = path.join(workspace, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const occupied = new Set<string>();
    return attachments.map(input => {
        const source = path.resolve(input);
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
            throw new Error(`Attachment not found: ${source}`);
        }
        if (!is_upload_supported_path(source)) {
            throw new Error(`Unsupported attachment type: ${source}`);
        }
        if (isInside(workspace, source)) return source;

        const extension = path.extname(source);
        const originalStem = path.basename(source, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'attachment';
        let filename = `${originalStem}${extension.toLowerCase()}`;
        let suffix = 2;
        while (occupied.has(filename.toLowerCase()) || fs.existsSync(path.join(uploadsDir, filename))) {
            filename = `${originalStem}-${suffix++}${extension.toLowerCase()}`;
        }
        occupied.add(filename.toLowerCase());
        const destination = path.join(uploadsDir, filename);
        fs.copyFileSync(source, destination);
        return destination;
    });
}

export async function generateLecture(options: LectureGenerationOptions): Promise<LectureGenerationResult> {
    const request = options.request.trim();
    if (!request) throw new Error('A generation request is required.');
    if (!options.model.trim()) throw new Error('A model is required.');
    const includeVideo = options.includeVideo !== false;
    const includeInteractive = options.includeInteractive === true;
    const includeGame = options.includeGame === true;
    if (!includeVideo && !includeInteractive && !includeGame) {
        throw new Error('Select at least one output: video, interactive, or practice game.');
    }
    if (options.workspaceDir && options.parentWorkspace) {
        throw new Error('Pass either workspaceDir or parentWorkspace, not both.');
    }

    let generation: { id: string; path: string };
    if (options.workspaceDir) {
        const workspaceDir = path.resolve(options.workspaceDir);
        fs.mkdirSync(workspaceDir, { recursive: true });
        generation = { id: path.basename(workspaceDir), path: workspaceDir };
    } else {
        generation = createGenerationWorkspace(options.parentWorkspace || DEFAULT_WORKSPACE_DIR);
    }

    const copiedAttachments = copyAttachmentsToGeneration(options.attachments || [], generation.path);
    const settings = [
        'if the user query is for lecture generation then follow this:',
        `aspect ratio: ${options.aspectRatio || '16:9'}`,
        `generation length: ${options.generationLength || '1:00'}`,
        `getimg enabled: ${options.enableGetimg === false ? 'no' : 'yes'}`,
        `output video: ${includeVideo ? 'yes' : 'no'}`,
        `output interactive: ${includeInteractive ? 'yes' : 'no'}`,
        `output practice game: ${includeGame ? 'yes' : 'no'}`,
        options.theme ? `theme: ${options.theme}` : '',
        options.teachingStyle ? `teaching style: ${options.teachingStyle}` : ''
    ].filter(Boolean).join('\n');
    const directives = copiedAttachments.map(attachment => `[(attachment: ${attachment})]`).join('\n');
    const task = [request, settings, directives].filter(Boolean).join('\n\n');

    const lectureGen = new LectureGen({
        model: options.model,
        scriptModel: options.scriptModel,
        animatorModel: options.animatorModel,
        workspaceDir: generation.path,
        tokenTrackerSessionId: options.tokenTrackerSessionId || generation.id,
        onLog: options.onLog,
        onSceneTaskState: options.onSceneTaskState
    });
    const session = lectureGen.startChat();
    const relayAbort = () => session.cancelTurn();
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    try {
        const output = await session.sendMessage(task, undefined, options.signal);
        const videoFiles = fs.readdirSync(generation.path)
            .filter(file => /^index(?:\d+)?\.html$/i.test(file))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(file => path.join(generation.path, file));
        const interactiveFile = fs.existsSync(path.join(generation.path, 'interactive.html'))
            ? path.join(generation.path, 'interactive.html')
            : undefined;
        const gameFile = fs.existsSync(path.join(generation.path, 'game.html'))
            ? path.join(generation.path, 'game.html')
            : undefined;
        if (includeVideo && videoFiles.length === 0) {
            throw new Error('LectureGen completed without producing an index HTML file.');
        }
        if (includeInteractive && !interactiveFile) {
            throw new Error('IAGen completed without producing interactive.html.');
        }
        if (includeGame && !gameFile) {
            throw new Error('GameGen completed without producing game.html.');
        }
        const htmlFiles = [...videoFiles, ...(interactiveFile ? [interactiveFile] : []), ...(gameFile ? [gameFile] : [])];
        const entryFile = videoFiles[0] || interactiveFile || gameFile;
        if (!entryFile) throw new Error('Static generation completed without producing an HTML file.');
        return {
            id: generation.id,
            workspaceDir: generation.path,
            entryFile,
            htmlFiles,
            videoFiles,
            interactiveFile,
            gameFile,
            output
        };
    } finally {
        options.signal?.removeEventListener('abort', relayAbort);
    }
}

function printLectureGenHelp(): void {
    console.log(`Usage:
  npm run lecturegen -- [options] "lecture request"

Options:
  --model <name>              Default/fallback LLM model (defaults to AGENT_MODEL)
  --script-model <name>       Model for answer + script writer (defaults to SCRIPT_MODEL, then --model)
  --animator-model <name>     Model for animator / iagen / gamegen (defaults to ANIMATOR_MODEL, then --model)
  --script-compare <a,b,...>  Side-by-side script A/B: generate answer once (first model), then writeScript
                              for each listed model into <slug>/script.md. Skips assets, trimmer, animator,
                              iagen, and gamegen. Incompatible with --no-video / --interactive / --game.
  --workspace <directory>     Parent workspace for a unique generation folder
  --workspace-dir <directory> Exact generation folder (no nested unique folder; used by coursegen)
  --length <value>            Generation length, e.g. 90s, 2:00, 2m (default: 1:00)
  --aspect-ratio <ratio>      Output aspect ratio (default: 16:9)
  --theme <id-or-file>        Theme id from .agents/mylecture-themes or a Markdown file
  --teaching-style <id-or-file> Style id from .agents/mylecture-teaching-style or a Markdown file
  --attachment <file>         Image, PDF, or video input; may be repeated
  --interactive               Also create interactive.html
  --game                      Also create game.html
  --no-video                  Skip answer/script/index generation
  --no-getimg                 Forbid getimg image requests (bundled world basemap still provided)
  --help                      Show this help

Environment:
  AGENT_MODEL                 Default/fallback model (also used by the editor agent)
  SCRIPT_MODEL                Optional override for answer + script stages
  ANIMATOR_MODEL              Optional override for animator / iagen / gamegen
  LECTUREGEN_CREATIVE_DIRECTION
                              Shared visual-direction packet (default: false)
  LECTUREGEN_PARALLEL_SCENES  Isolated scene tasks instead of retained session (default: false)
  LECTUREGEN_SCENE_LLM_CONCURRENCY
                              Global scene LLM cap (default: 2)
  LECTUREGEN_BROWSER_VALIDATION_CONCURRENCY
                              Global browser-validation cap (default: 1)
  LECTUREGEN_SCENE_CONCURRENCY_PER_JOB
                              Per-generation scene cap (default: 2)

Example:
  npm run lecturegen -- --workspace ./gens --length 2:00 --aspect-ratio 16:9 "Explain binary search"
  npm run lecturegen -- --script-compare gpt-5.6-luna,gemini-3.5-flash "Explain binary search"`);
}

function loadResource(value: string, resourceFolder: string): string {
    const direct = path.resolve(value);
    const byId = path.resolve(moduleDir, '..', '.agents', resourceFolder, value.toLowerCase().endsWith('.md') ? value : `${value}.md`);
    const target = fs.existsSync(direct) ? direct : byId;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`Could not find ${resourceFolder} resource: ${value}`);
    }
    return fs.readFileSync(target, 'utf8').trim();
}

export type ScriptCompareResult = {
    workspaceDir: string;
    answerPath: string;
    comparePath: string;
    scripts: Array<{ model: string; slug: string; path: string }>;
};

/**
 * Side-by-side script A/B: one shared answer, then writeScript per compare model.
 * Does not run asset fetcher, trimmer, animator, iagen, or gamegen.
 */
export async function runScriptCompare(options: {
    request: string;
    models: string[];
    model?: string;
    parentWorkspace?: string;
    workspaceDir?: string;
    generationLength?: string;
    theme?: string;
    teachingStyle?: string;
    attachments?: string[];
    enableGetimg?: boolean;
    tokenTrackerSessionId?: string | null;
    onLog?: (text: string) => void;
    signal?: AbortSignal;
}): Promise<ScriptCompareResult> {
    const request = options.request.trim();
    if (!request) throw new Error('A generation request is required.');
    const models = parseScriptCompareModels(options.models.join(','));
    if (options.workspaceDir && options.parentWorkspace) {
        throw new Error('Pass either workspaceDir or parentWorkspace, not both.');
    }

    let generation: { id: string; path: string };
    if (options.workspaceDir) {
        const workspaceDir = path.resolve(options.workspaceDir);
        fs.mkdirSync(workspaceDir, { recursive: true });
        generation = { id: path.basename(workspaceDir), path: workspaceDir };
    } else {
        generation = createGenerationWorkspace(options.parentWorkspace || DEFAULT_WORKSPACE_DIR);
    }

    const log = (message: string) => options.onLog?.(`[lecturegen] ${message}\n`);
    const answerModel = models[0];
    const theme = options.theme?.trim()
        || fs.readFileSync(path.resolve(moduleDir, '..', '.agents', 'mylecture-themes', 'default.md'), 'utf8');
    const teachingStyle = options.teachingStyle?.trim()
        || fs.readFileSync(path.resolve(moduleDir, '..', '.agents', 'mylecture-teaching-style', 'default.md'), 'utf8');
    const copiedAttachments = copyAttachmentsToGeneration(options.attachments || [], generation.path);
    const attachmentDescriptors = extract_upload_attachments(
        copiedAttachments.map(attachment => `[(attachment: ${attachment})]`).join('\n'),
        generation.path
    ) as LectureGenAttachment[];
    const enableGetimg = options.enableGetimg !== false;
    const generationLength = options.generationLength || '1:00';
    const tokenTrackerSessionId = options.tokenTrackerSessionId || generation.id;
    const assertActive = () => {
        if (options.signal?.aborted) throw new Error('Static generation was stopped.');
    };

    log(`Script compare mode: answer with ${answerModel}; scripts for ${models.join(', ')}.`);
    log('Generating the shared concept answer...');
    const answer = await generateAnswer({
        model: answerModel,
        tokenTrackerSessionId,
        promptWorkspaceDir: generation.path,
        request,
        generationLength,
        teachingStyle,
        attachments: attachmentDescriptors
    });
    assertActive();
    const answerPath = path.join(generation.path, 'answer.md');
    fs.writeFileSync(answerPath, answer, 'utf8');

    const slugs = uniqueModelSlugs(models);
    log(`Writing scripts in parallel for ${models.length} model(s)...`);
    const scripts = await Promise.all(models.map(async (model, index) => {
        assertActive();
        const slug = slugs[index];
        if (!isModelSlugContained(generation.path, slug)) {
            throw new Error(`Refusing unsafe compare model folder slug: ${slug}`);
        }
        const modelDir = path.join(generation.path, slug);
        fs.mkdirSync(modelDir, { recursive: true });
        let script = await writeScript({
            model,
            tokenTrackerSessionId,
            promptWorkspaceDir: generation.path,
            request,
            generationLength,
            answer,
            theme,
            teachingStyle,
            enableGetimg,
            attachments: attachmentDescriptors
        });
        assertActive();
        if (!enableGetimg) script = stripImageRequests(script);
        const scriptPath = path.join(modelDir, 'script.md');
        fs.writeFileSync(scriptPath, script, 'utf8');
        log(`Finished script for ${model} → ${path.join(slug, 'script.md')}`);
        return { model, slug, path: scriptPath };
    }));

    const comparePath = path.join(generation.path, 'compare.json');
    fs.writeFileSync(comparePath, JSON.stringify({
        request,
        answerModel,
        models,
        slugs: scripts.map(entry => ({ model: entry.model, slug: entry.slug })),
        generationLength,
        enableGetimg,
        generatedAt: new Date().toISOString(),
        fallbackModel: options.model || process.env.AGENT_MODEL || ''
    }, null, 2), 'utf8');

    return {
        workspaceDir: generation.path,
        answerPath,
        comparePath,
        scripts
    };
}

export async function runLectureGenCli(args = process.argv.slice(2)): Promise<void> {
    let model = process.env.AGENT_MODEL || '';
    let scriptModel = process.env.SCRIPT_MODEL || '';
    let animatorModel = process.env.ANIMATOR_MODEL || '';
    let scriptCompareRaw = '';
    let parentWorkspace = DEFAULT_WORKSPACE_DIR;
    let workspaceDir = '';
    let parentWorkspaceSet = false;
    let generationLength = '1:00';
    let aspectRatio = '16:9';
    let theme = '';
    let teachingStyle = '';
    let enableGetimg = true;
    let includeVideo = true;
    let includeInteractive = false;
    let includeGame = false;
    const attachments: string[] = [];
    const taskParts: string[] = [];
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const nextValue = () => {
            const value = args[++index];
            if (!value) throw new Error(`Missing value for ${argument}.`);
            return value;
        };
        switch (argument) {
            case '--help':
            case '-h':
                printLectureGenHelp();
                return;
            case '--model': model = nextValue(); break;
            case '--script-model': scriptModel = nextValue(); break;
            case '--animator-model': animatorModel = nextValue(); break;
            case '--script-compare': scriptCompareRaw = nextValue(); break;
            case '--workspace':
                parentWorkspace = path.resolve(nextValue());
                parentWorkspaceSet = true;
                break;
            case '--workspace-dir': workspaceDir = path.resolve(nextValue()); break;
            case '--length': generationLength = nextValue(); break;
            case '--aspect-ratio': aspectRatio = nextValue(); break;
            case '--theme': theme = loadResource(nextValue(), 'mylecture-themes'); break;
            case '--teaching-style': teachingStyle = loadResource(nextValue(), 'mylecture-teaching-style'); break;
            case '--attachment': attachments.push(path.resolve(nextValue())); break;
            case '--interactive': includeInteractive = true; break;
            case '--game': includeGame = true; break;
            case '--no-video': includeVideo = false; break;
            case '--no-getimg':
            case '--disable-getimg': enableGetimg = false; break;
            default:
                if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
                taskParts.push(argument);
        }
    }
    if (!model) throw new Error('AGENT_MODEL or --model is required.');
    if (workspaceDir && parentWorkspaceSet) {
        throw new Error('Pass either --workspace-dir or --workspace, not both.');
    }
    const request = taskParts.join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
    if (!request) throw new Error('Provide a video request as an argument or through stdin.');

    if (scriptCompareRaw) {
        if (!includeVideo) {
            throw new Error('--script-compare cannot be combined with --no-video (compare is script-only).');
        }
        if (includeInteractive || includeGame) {
            throw new Error('--script-compare cannot be combined with --interactive or --game.');
        }
        if (scriptModel.trim()) {
            process.stderr.write(
                '[lecturegen] Ignoring --script-model / SCRIPT_MODEL during --script-compare; '
                + 'answer uses the first compare model.\n'
            );
        }
        const compareModels = parseScriptCompareModels(scriptCompareRaw);
        const result = await runScriptCompare({
            request,
            models: compareModels,
            model,
            ...(workspaceDir ? { workspaceDir } : { parentWorkspace }),
            generationLength,
            theme,
            teachingStyle,
            attachments,
            enableGetimg,
            onLog: text => process.stderr.write(text)
        });
        const scriptLines = result.scripts
            .map(entry => `  ${entry.model}: ${entry.path}`)
            .join('\n');
        process.stdout.write(
            `Script compare complete.\nGeneration folder: ${result.workspaceDir}\nScripts:\n${scriptLines}\n`
        );
        return;
    }

    const result = await generateLecture({
        request,
        model,
        scriptModel: scriptModel || undefined,
        animatorModel: animatorModel || undefined,
        ...(workspaceDir ? { workspaceDir } : { parentWorkspace }),
        generationLength,
        aspectRatio,
        theme,
        teachingStyle,
        attachments,
        enableGetimg,
        includeVideo,
        includeInteractive,
        includeGame,
        onLog: text => process.stderr.write(text)
    });
    process.stdout.write(`${result.output}\nGeneration folder: ${result.workspaceDir}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runLectureGenCli().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
