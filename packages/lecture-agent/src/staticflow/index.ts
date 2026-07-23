import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract_upload_attachments } from '../prompt_builder.js';
import { generateAnswer } from './answer_generator.js';
import { fetchAssets, formatAssetDescriptions, stripImageRequests, type AssetDescription } from './asset_fetcher.js';
import { AnimatorSession, animateScriptBlock, validateAndRepairHtml, type PreviousHtml } from './animator.js';
import { trimScriptByNarration } from './script_trimmer.js';
import { writeScript } from './script_writer.js';
import type { StaticFlowAttachment } from './shared.js';

export type StaticFlowAgentOptions = {
    model: string;
    workspaceDir: string;
    tokenTrackerSessionId?: string | null;
    onLog?: (text: string) => void;
};

type ParsedStaticRequest = {
    request: string;
    aspectRatio: string;
    generationLength: string;
    embedSubtitles: boolean;
    enableGetimg: boolean;
    theme: string;
    teachingStyle: string;
    attachments: StaticFlowAttachment[];
};

const SETTINGS_MARKER = 'if the user query is for video generation then follow this:';
const ATTACHMENT_DIRECTIVE = /\s*\[\(attachment:\s*[^\]]+\)\]/gi;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function valueAfter(label: string, text: string, fallback: string): string {
    const match = text.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\r\\n]+)`, 'i'));
    return match?.[1]?.trim() || fallback;
}

export function parseStaticFlowRequest(task: string, workspaceDir: string): ParsedStaticRequest {
    const attachments = extract_upload_attachments(task, workspaceDir) as StaticFlowAttachment[];
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

export class StaticFlowAgent {
    private readonly options: StaticFlowAgentOptions;

    constructor(options: StaticFlowAgentOptions) {
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
                const log = (message: string) => this.options.onLog?.(`[static-flow] ${message}\n`);
                const input = parseStaticFlowRequest(task, this.options.workspaceDir);
                if (!input.theme) {
                    input.theme = fs.readFileSync(path.resolve(moduleDir, '..', '..', '.agents', 'mylecture-themes', 'default.md'), 'utf8');
                }
                if (!input.teachingStyle) {
                    input.teachingStyle = fs.readFileSync(path.resolve(moduleDir, '..', '..', '.agents', 'mylecture-teaching-style', 'default.md'), 'utf8');
                }
                const common = {
                    model: this.options.model,
                    tokenTrackerSessionId: this.options.tokenTrackerSessionId
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

                const scriptBlocks = trimScriptByNarration(script, 75, 30);
                log(`Split the script into ${scriptBlocks.length} narration-based animation block(s), targeting 30–75 words each.`);
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
