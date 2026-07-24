/**
 * video_maker.ts
 *
 * Complete static video-generation control unit. This one module contains:
 *
 * - `VideoMaker`, which runs answer generation, script writing, optional image
 *   asset fetching, narration-aware script trimming, sequential animation, HTML
 *   validation/repair, and metadata writing.
 * - `generateVideo()`, the programmatic API used by the IDE.
 * - workspace and attachment helpers used by API callers.
 * - `runVideoMakerCli()`, the direct-run CLI control.
 *
 * The CLI creates a unique generation folder beneath `--workspace` and writes
 * `answer.md`, `script.md`, `metadata.json`, `index*.html`, copied attachments,
 * and downloaded assets there:
 *
 *   npm run video-maker -- --workspace ".\generations" --length 2:00
 *     --aspect-ratio 16:9 "Explain binary search"
 *
 * Pass `--no-getimg` to prohibit image requests and skip asset fetching.
 * `SCRIPT_TRIMMER_CHUNK_SIZE` is required. It sets the maximum narration words
 * per animator block; the minimum is half that value, rounded up.
 *
 * Animator calls run sequentially in one retained LLM session so prior validated
 * generations remain in context and provider prompt caching can apply. Each
 * generated index file is validated and repaired before the next block begins.
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
import { fetchAssets, formatAssetDescriptions, stripImageRequests, type AssetDescription } from './asset_fetcher.js';
import { AnimatorSession, animateScriptBlock, validateAndRepairHtml, type PreviousHtml } from './animator.js';
import { getScriptTrimmerChunkSizes, trimScriptByNarration } from './script_trimmer.js';
import { writeScript } from './script_writer.js';
import type { VideoMakerAttachment } from './video_maker_shared.js';
import { DEFAULT_WORKSPACE_DIR } from './workspace.js';

export type VideoMakerOptions = {
    model: string;
    workspaceDir: string;
    tokenTrackerSessionId?: string | null;
    onLog?: (text: string) => void;
};

export type ParsedVideoMakerRequest = {
    request: string;
    aspectRatio: string;
    generationLength: string;
    embedSubtitles: boolean;
    enableGetimg: boolean;
    theme: string;
    teachingStyle: string;
    attachments: VideoMakerAttachment[];
};

const SETTINGS_MARKER = 'if the user query is for video generation then follow this:';
const ATTACHMENT_DIRECTIVE = /\s*\[\(attachment:\s*[^\]]+\)\]/gi;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function valueAfter(label: string, text: string, fallback: string): string {
    const match = text.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\r\\n]+)`, 'i'));
    return match?.[1]?.trim() || fallback;
}

export function parseVideoMakerRequest(task: string, workspaceDir: string): ParsedVideoMakerRequest {
    const attachments = extract_upload_attachments(task, workspaceDir) as VideoMakerAttachment[];
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
        embedSubtitles: valueAfter('embed subtitle in video', settings, 'no').toLowerCase() === 'yes',
        enableGetimg: valueAfter('getimg enabled', settings, 'yes').toLowerCase() !== 'no',
        theme,
        teachingStyle,
        attachments
    };
}

export class VideoMaker {
    private readonly options: VideoMakerOptions;

    constructor(options: VideoMakerOptions) {
        this.options = options;
    }

    startChat() {
        let used = false;
        let cancelled = false;
        return {
            cancelTurn: () => { cancelled = true; },
            sendMessage: async (task: string, _unused?: unknown, signal?: AbortSignal): Promise<string> => {
                if (used) {
                    throw new Error('Static video generation currently supports one request per chat. Start a New Chat to generate another video.');
                }
                used = true;
                cancelled = false;
                const assertActive = () => {
                    if (cancelled || signal?.aborted) throw new Error('Static video generation was stopped.');
                };
                const log = (message: string) => this.options.onLog?.(`[video-maker] ${message}\n`);
                const chunkSizes = getScriptTrimmerChunkSizes();
                const input = parseVideoMakerRequest(task, this.options.workspaceDir);
                if (!input.theme) {
                    input.theme = fs.readFileSync(path.resolve(moduleDir, '..', '.agents', 'mylecture-themes', 'default.md'), 'utf8');
                }
                if (!input.teachingStyle) {
                    input.teachingStyle = fs.readFileSync(path.resolve(moduleDir, '..', '.agents', 'mylecture-teaching-style', 'default.md'), 'utf8');
                }
                const common = {
                    model: this.options.model,
                    tokenTrackerSessionId: this.options.tokenTrackerSessionId,
                    promptWorkspaceDir: this.options.workspaceDir
                };
                fs.mkdirSync(this.options.workspaceDir, { recursive: true });

                log('Generating the concept answer...');
                const answer = await generateAnswer({
                    ...common,
                    request: input.request,
                    generationLength: input.generationLength,
                    teachingStyle: input.teachingStyle,
                    attachments: input.attachments
                });
                assertActive();
                fs.writeFileSync(path.join(this.options.workspaceDir, 'answer.md'), answer, 'utf8');

                log('Writing the audiovisual script...');
                let script = await writeScript({
                    ...common,
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

                let assets: AssetDescription[] = [];
                if (input.enableGetimg) {
                    log('Fetching requested image assets...');
                    assets = await fetchAssets(script, this.options.workspaceDir);
                } else {
                    log('getimg disabled; skipping the asset fetcher.');
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
                const assetDescriptions = [formatAssetDescriptions(assets), uploadedAssets].filter(Boolean).join('\n');
                const previousHtmls: PreviousHtml[] = [];
                const animatorSession = new AnimatorSession(common);
                log('Using one retained animator LLM session for sequential context and prompt caching.');
                for (const block of scriptBlocks) {
                    assertActive();
                    const outputPath = scriptBlocks.length === 1 ? 'index.html' : `index${block.index}.html`;
                    log(`Animating ${outputPath} from script block ${block.index}/${scriptBlocks.length} (${block.narrationWords} narration words)...`);
                    const animatorInput = {
                        ...common,
                        request: input.request,
                        aspectRatio: input.aspectRatio,
                        generationLength: input.generationLength,
                        embedSubtitles: input.embedSubtitles,
                        scriptBlock: block.content,
                        blockIndex: block.index,
                        totalBlocks: scriptBlocks.length,
                        outputPath,
                        theme: input.theme,
                        teachingStyle: input.teachingStyle,
                        assetDescriptions,
                        previousHtmls: [...previousHtmls],
                        attachments: input.attachments
                    };
                    const generatedHtml = await animateScriptBlock(animatorInput, animatorSession);
                    assertActive();
                    const validHtml = await validateAndRepairHtml(
                        animatorInput,
                        animatorSession,
                        this.options.workspaceDir,
                        generatedHtml,
                        validation => log(validation)
                    );
                    previousHtmls.push({ path: outputPath, content: validHtml });
                }

                const title = input.request.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Lecture';
                fs.writeFileSync(path.join(this.options.workspaceDir, 'metadata.json'), JSON.stringify({
                    title,
                    description: `An animated lecture about ${title.replace(/[.!?]+$/, '')}.`
                }, null, 2), 'utf8');
                log('Static video generation complete.');
                return 'Done making the video.';
            }
        };
    }
}

export type VideoGenerationOptions = {
    request: string;
    model: string;
    parentWorkspace?: string;
    workspaceDir?: string;
    generationLength?: string;
    aspectRatio?: string;
    theme?: string;
    teachingStyle?: string;
    attachments?: string[];
    embedSubtitles?: boolean;
    enableGetimg?: boolean;
    tokenTrackerSessionId?: string | null;
    onLog?: (text: string) => void;
    signal?: AbortSignal;
};

export type VideoGenerationResult = {
    id: string;
    workspaceDir: string;
    entryFile: string;
    htmlFiles: string[];
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

export async function generateVideo(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const request = options.request.trim();
    if (!request) throw new Error('A video request is required.');
    if (!options.model.trim()) throw new Error('A model is required.');
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
        'if the user query is for video generation then follow this:',
        `aspect ratio: ${options.aspectRatio || '16:9'}`,
        `generation length: ${options.generationLength || '1:00'}`,
        `embed subtitle in video: ${options.embedSubtitles ? 'yes' : 'no'}`,
        `getimg enabled: ${options.enableGetimg === false ? 'no' : 'yes'}`,
        options.theme ? `theme: ${options.theme}` : '',
        options.teachingStyle ? `teaching style: ${options.teachingStyle}` : ''
    ].filter(Boolean).join('\n');
    const directives = copiedAttachments.map(attachment => `[(attachment: ${attachment})]`).join('\n');
    const task = [request, settings, directives].filter(Boolean).join('\n\n');

    const videoMaker = new VideoMaker({
        model: options.model,
        workspaceDir: generation.path,
        tokenTrackerSessionId: options.tokenTrackerSessionId || generation.id,
        onLog: options.onLog
    });
    const session = videoMaker.startChat();
    const relayAbort = () => session.cancelTurn();
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    try {
        const output = await session.sendMessage(task, undefined, options.signal);
        const htmlFiles = fs.readdirSync(generation.path)
            .filter(file => /^index(?:\d+)?\.html$/i.test(file))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(file => path.join(generation.path, file));
        if (htmlFiles.length === 0) throw new Error('Video maker completed without producing an index HTML file.');
        return {
            id: generation.id,
            workspaceDir: generation.path,
            entryFile: htmlFiles[0],
            htmlFiles,
            output
        };
    } finally {
        options.signal?.removeEventListener('abort', relayAbort);
    }
}

function printVideoMakerHelp(): void {
    console.log(`Usage:
  npm run video-maker -- [options] "video request"

Options:
  --model <name>              LLM model (defaults to AGENT_MODEL)
  --workspace <directory>     Parent workspace for a unique generation folder
  --length <value>            Generation length, e.g. 90s, 2:00, 2m (default: 1:00)
  --aspect-ratio <ratio>      Output aspect ratio (default: 16:9)
  --theme <id-or-file>        Theme id from .agents/mylecture-themes or a Markdown file
  --teaching-style <id-or-file> Style id from .agents/mylecture-teaching-style or a Markdown file
  --attachment <file>         Image, PDF, or video input; may be repeated
  --no-getimg                 Forbid image requests and skip the asset fetcher
  --embed-subtitles           Request embedded subtitles
  --help                      Show this help

Example:
  npm run video-maker -- --workspace ./gens --length 2:00 --aspect-ratio 16:9 "Explain binary search"`);
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

export async function runVideoMakerCli(args = process.argv.slice(2)): Promise<void> {
    let model = process.env.AGENT_MODEL || '';
    let parentWorkspace = DEFAULT_WORKSPACE_DIR;
    let generationLength = '1:00';
    let aspectRatio = '16:9';
    let theme = '';
    let teachingStyle = '';
    let embedSubtitles = false;
    let enableGetimg = true;
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
                printVideoMakerHelp();
                return;
            case '--model': model = nextValue(); break;
            case '--workspace': parentWorkspace = path.resolve(nextValue()); break;
            case '--length': generationLength = nextValue(); break;
            case '--aspect-ratio': aspectRatio = nextValue(); break;
            case '--theme': theme = loadResource(nextValue(), 'mylecture-themes'); break;
            case '--teaching-style': teachingStyle = loadResource(nextValue(), 'mylecture-teaching-style'); break;
            case '--attachment': attachments.push(path.resolve(nextValue())); break;
            case '--no-getimg':
            case '--disable-getimg': enableGetimg = false; break;
            case '--embed-subtitles': embedSubtitles = true; break;
            default:
                if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
                taskParts.push(argument);
        }
    }
    if (!model) throw new Error('AGENT_MODEL or --model is required.');
    const request = taskParts.join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
    if (!request) throw new Error('Provide a video request as an argument or through stdin.');
    const result = await generateVideo({
        request,
        model,
        parentWorkspace,
        generationLength,
        aspectRatio,
        theme,
        teachingStyle,
        attachments,
        embedSubtitles,
        enableGetimg,
        onLog: text => process.stderr.write(text)
    });
    process.stdout.write(`${result.output}\nGeneration folder: ${result.workspaceDir}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runVideoMakerCli().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
