import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tool_edits, type RangeEdit } from '../tools/edits.js';
import { validate_index_html_contract, purify_content_for_path } from '../tools/utils/html_contract.js';
import { StaticFlowLlmSession, readPrompt, type StaticFlowAttachment, type StaticFlowLlmOptions } from './shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'animator_system.md');
const contractPath = path.resolve(moduleDir, '..', '..', '.agents', 'mylecture-contracts', 'html-input-contract.md');

export type PreviousHtml = { path: string; content: string };

export type AnimatorInput = StaticFlowLlmOptions & {
    request: string;
    aspectRatio: string;
    generationLength: string;
    embedSubtitles: boolean;
    scriptBlock: string;
    blockIndex: number;
    totalBlocks: number;
    outputPath: string;
    theme: string;
    teachingStyle: string;
    assetDescriptions: string;
    previousHtmls: PreviousHtml[];
    attachments?: StaticFlowAttachment[];
};

export type AnimatorRepairInput = AnimatorInput & {
    currentHtml: string;
    validatorOutput: string;
};

function animatorSystemPrompt(): string {
    return `${readPrompt(systemPromptPath)}\n\n# Canonical HTML Input Contract\n${readPrompt(contractPath)}`;
}

export class AnimatorSession {
    private readonly llm: StaticFlowLlmSession;

    constructor(options: StaticFlowLlmOptions) {
        this.llm = new StaticFlowLlmSession(options, animatorSystemPrompt());
    }

    generate(purpose: string, prompt: string, attachments: StaticFlowAttachment[] = []): Promise<string> {
        return this.llm.generate(purpose, prompt, attachments);
    }
}

function formatPreviousHtmlSummary(previousHtmls: PreviousHtml[]): string {
    if (previousHtmls.length === 0) return 'No previous HTML files. This is the first segment.';
    return [
        `Validated files: ${previousHtmls.map(file => file.path).join(', ')}`,
        'Their complete generation and repair exchanges are retained earlier in this conversation. All requested edits were applied and each listed file passed the validator.'
    ].join('\n');
}

export function parseAnimatorHtml(response: string): string {
    let content = response.trim();
    content = content.replace(/^```html\s*/i, '').replace(/\s*```$/, '').trim();
    const openingTags = content.match(/<html\b/gi)?.length || 0;
    const closingTags = content.match(/<\/html\s*>/gi)?.length || 0;
    if (openingTags !== 1 || closingTags !== 1) {
        throw new Error('Animator must return exactly one complete HTML document.');
    }
    const start = content.search(/<!doctype\s+html|<html\b/i);
    const endMatch = /<\/html\s*>/gi;
    let end = -1;
    for (const match of content.matchAll(endMatch)) end = (match.index || 0) + match[0].length;
    if (start < 0 || end < 0 || end <= start) {
        throw new Error('Animator did not return one complete raw HTML document.');
    }
    return content.slice(start, end).trim();
}

export async function animateScriptBlock(input: AnimatorInput, session: AnimatorSession): Promise<string> {
    const userPrompt = [
        `Output filename: ${input.outputPath}`,
        `Segment: ${input.blockIndex} of ${input.totalBlocks}`,
        `Original video request: ${input.request}`,
        `Aspect ratio: ${input.aspectRatio}`,
        `Full requested generation length: ${input.generationLength}`,
        `Embed subtitles: ${input.embedSubtitles ? 'yes' : 'no'}`,
        '',
        '# Teaching Style', input.teachingStyle,
        '',
        '# Visual Theme', input.theme,
        '',
        '# Available Image Assets', input.assetDescriptions,
        '',
        '# Previous Validated HTML Context', formatPreviousHtmlSummary(input.previousHtmls),
        '',
        '# Current Script Block', input.scriptBlock,
        '',
        `Create only ${input.outputPath}. Continue coherently from the previous HTML files while implementing only this script block.`
    ].join('\n');
    const response = await session.generate(`staticflow_animator_block_${input.blockIndex}`, userPrompt, input.attachments);
    const [html] = purify_content_for_path(input.outputPath, parseAnimatorHtml(response));
    return html;
}

function lineNumbered(content: string): string {
    return content.split(/\r?\n/).map((line, index) => `${index + 1}: ${line}`).join('\n');
}

export function parseAnimatorEdits(response: string, expectedPath: string): RangeEdit[] {
    let content = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace < firstBrace) {
        throw new Error('Animator repair did not return a JSON edits object.');
    }
    if (firstBrace > 0 || lastBrace < content.length - 1) content = content.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(content);
    if (!parsed || parsed.path !== expectedPath || !Array.isArray(parsed.edits) || parsed.edits.length === 0) {
        throw new Error(`Animator repair must return {"path":"${expectedPath}","edits":[...]}.`);
    }
    return parsed.edits as RangeEdit[];
}

export async function requestAnimatorRepair(input: AnimatorRepairInput, session: AnimatorSession): Promise<RangeEdit[]> {
    const repairPrompt = [
        `The generated ${input.outputPath} failed the HTML contract validator.`,
        'Return only one JSON object in the existing edits tool format:',
        `{"path":"${input.outputPath}","edits":[{"lines":[1,2],"new":"replacement text"}]}`,
        'Line ranges are inclusive and refer to the line-numbered current file below. Use [a,b] to replace, [a] to insert after line a, and [0] to insert at the top.',
        'Make the smallest complete set of edits needed to resolve every validator error. Do not return the whole HTML file.',
        '',
        '# Validator Output', input.validatorOutput,
        '',
        '# Previous Validated HTML Context', formatPreviousHtmlSummary(input.previousHtmls),
        '',
        `# Current ${input.outputPath} With Line Numbers`, lineNumbered(input.currentHtml),
        '',
        '# Current Script Block', input.scriptBlock
    ].join('\n');
    const response = await session.generate(`staticflow_animator_repair_block_${input.blockIndex}`, repairPrompt, input.attachments);
    return parseAnimatorEdits(response, input.outputPath);
}

export async function validateAndRepairHtml(
    input: AnimatorInput,
    session: AnimatorSession,
    workspaceDir: string,
    initialHtml: string,
    onValidation?: (message: string) => void,
    maximumRepairs = 5
): Promise<string> {
    const target = path.resolve(workspaceDir, input.outputPath);
    let html = initialHtml;
    let previousRepairError = '';
    fs.writeFileSync(target, html, 'utf8');

    for (let attempt = 0; attempt <= maximumRepairs; attempt++) {
        const validation = validate_index_html_contract(input.outputPath, workspaceDir);
        onValidation?.(validation);
        if (validation.includes('validation passed')) return html;
        if (attempt === maximumRepairs) {
            throw new Error(`${input.outputPath} still failed validation after ${maximumRepairs} animator repair attempt(s):\n${validation}`);
        }
        let edits: RangeEdit[];
        try {
            edits = await requestAnimatorRepair({
                ...input,
                currentHtml: html,
                validatorOutput: [validation, previousRepairError].filter(Boolean).join('\n\nPrevious repair attempt error:\n')
            }, session);
            tool_edits(input.outputPath, edits, workspaceDir);
        } catch (error) {
            previousRepairError = error instanceof Error ? error.message : String(error);
            onValidation?.(`Animator repair attempt failed: ${previousRepairError}`);
            continue;
        }
        previousRepairError = '';
        html = fs.readFileSync(target, 'utf8');
    }
    throw new Error(`Unexpected validation loop exit for ${input.outputPath}.`);
}
