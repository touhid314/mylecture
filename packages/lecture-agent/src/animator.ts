import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { tool_edits, type RangeEdit } from './utils/file_edits.js';
import { validate_index_html_contract, purify_content_for_path } from './utils/html_contract.js';
import { LectureGenLlmSession, readPrompt, type LectureGenAttachment, type LectureGenLlmOptions } from './lecturegen_shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'animator_system.md');
const contractPath = path.resolve(moduleDir, '..', '.agents', 'mylecture-contracts', 'html-input-contract.md');

export type PreviousHtml = { path: string; content: string };

export type AnimatorInput = LectureGenLlmOptions & {
    request: string;
    aspectRatio: string;
    generationLength: string;
    scriptBlock: string;
    blockIndex: number;
    totalBlocks: number;
    outputPath: string;
    theme: string;
    teachingStyle: string;
    assetDescriptions: string;
    previousHtmls: PreviousHtml[];
    attachments?: LectureGenAttachment[];
};

export type AnimatorRepairInput = AnimatorInput & {
    currentHtml: string;
    validatorOutput: string;
};

export function animatorSystemPrompt(): string {
    return `${readPrompt(systemPromptPath)}\n\n# Canonical HTML Input Contract\n${readPrompt(contractPath)}`;
}

export class AnimatorSession {
    private readonly llm: LectureGenLlmSession;

    constructor(options: LectureGenLlmOptions) {
        this.llm = new LectureGenLlmSession(options, animatorSystemPrompt());
    }

    generate(purpose: string, prompt: string, attachments: LectureGenAttachment[] = []): Promise<string> {
        return this.llm.generate(purpose, prompt, attachments);
    }
}

export function getAnimatorMaxPreviousHtmls(
    configuredValue = process.env.ANIMATOR_MAX_PREVIOUS_HTMLS
): number {
    const raw = configuredValue?.replace(/['"]/g, '').trim();
    if (raw === undefined || raw === null || raw === '') {
        throw new Error('ANIMATOR_MAX_PREVIOUS_HTMLS environment variable is missing or empty. It must be a non-negative integer (e.g. 2, 0).');
    }
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0) {
        throw new Error('ANIMATOR_MAX_PREVIOUS_HTMLS must be a non-negative integer (e.g. 0, 1, 2).');
    }
    return num;
}

export function slicePreviousHtmls(
    previousHtmls: PreviousHtml[],
    maxCount = getAnimatorMaxPreviousHtmls()
): PreviousHtml[] {
    if (maxCount === 0) return [];
    return previousHtmls.slice(-maxCount);
}

function formatPreviousHtmlSummary(previousHtmls: PreviousHtml[]): string {
    const sliced = slicePreviousHtmls(previousHtmls);
    if (sliced.length === 0) return 'No previous HTML files. This is the first segment or previous HTML context is disabled.';
    return [
        `Validated files kept in context (${sliced.length}): ${sliced.map(file => file.path).join(', ')}`,
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
        `Create only ${input.outputPath}. Continue coherently from the previous HTML files while implementing only this script block.`,
        'Each index*.html file is loaded independently in the browser. Copy every draw*/render*/update* helper you call into this file — never reference functions that exist only in a previous index*.html.'
    ].join('\n');

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await session.generate(`lecturegen_animator_block_${input.blockIndex}`, userPrompt, input.attachments);
            const [html] = purify_content_for_path(input.outputPath, parseAnimatorHtml(response));
            return html;
        } catch (err: any) {
            lastError = err;
            console.warn(`[Animator] Block ${input.blockIndex} (${input.outputPath}) attempt ${attempt}/${maxAttempts} failed: ${err.message || err}`);
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
    }

    throw new Error(`Failed to generate ${input.outputPath} after ${maxAttempts} attempts: ${lastError?.message || lastError}`);
}

function lineNumbered(content: string): string {
    return content.split(/\r?\n/).map((line, index) => `${index + 1}: ${line}`).join('\n');
}

const INLINE_SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

export function revertToLastViable(target: string, lastViableHtml: string): string {
    fs.writeFileSync(target, lastViableHtml, 'utf8');
    return lastViableHtml;
}

export function findInlineScriptSyntaxError(html: string): string | null {
    let scriptIndex = 0;
    for (const match of html.matchAll(INLINE_SCRIPT_TAG_RE)) {
        const attrs = match[1] ?? '';
        const body = match[2] ?? '';
        if (/\bsrc\s*=/i.test(attrs)) continue;
        if (/\btype\s*=\s*(["']?)module\1/i.test(attrs)) continue;
        scriptIndex += 1;
        try {
            new vm.Script(body);
        } catch (err) {
            const name = err instanceof SyntaxError ? 'SyntaxError' : (err instanceof Error ? err.name : 'Error');
            const message = err instanceof Error ? err.message : String(err);
            return `inline script ${scriptIndex}: ${name}: ${message}`;
        }
    }
    return null;
}

/** Advance the syntax-clean disk-revert anchor when html compiles; scriptBroken does not block this. */
export function nextSyntaxCleanAnchor(
    html: string,
    currentAnchor: string,
    htmlSyntaxError: string | null | undefined = undefined,
): { anchor: string; isSyntaxClean: boolean } {
    const error = htmlSyntaxError === undefined ? findInlineScriptSyntaxError(html) : htmlSyntaxError;
    if (error === null) {
        return { anchor: html, isSyntaxClean: true };
    }
    return {
        anchor: currentAnchor,
        isSyntaxClean: findInlineScriptSyntaxError(currentAnchor) === null,
    };
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

const TEMPORAL_LAYOUT_MARKER = 'Temporal layout check failed:';
const SCRIPT_BEFORE_GLOBALS_MARKER = 'Browser script error before contract globals:';
/** Rewrite immediately when this many layout errors are reported (skip first JSON edit). */
const IMMEDIATE_LAYOUT_REWRITE_ERROR_THRESHOLD = 6;
/** After this many repair attempts, rewrite when several layout errors remain. */
const JSON_EDIT_ATTEMPTS_BEFORE_BULK_REWRITE = 1;
/** Minimum remaining layout errors to prefer rewrite over more JSON edits. */
const BULK_LAYOUT_REWRITE_MIN_ERRORS = 3;
/** Failed JSON/syntax repairs before forcing layout rewrite. */
const FAILED_REPAIR_REWRITE_THRESHOLD = 2;
/** Applied edits that did not reduce layout errors before forcing rewrite. */
const UNIMPROVED_REPAIR_REWRITE_THRESHOLD = 2;

export type LayoutRewriteDecisionInput = {
    attempt: number;
    maximumRepairs: number;
    validation: string;
    consecutiveFailedRepairs?: number;
    consecutiveUnimprovedRepairs?: number;
    priorLayoutRewrite?: boolean;
};

export function countTemporalLayoutErrors(validation: string): number {
    return validation
        .split(/\r?\n/)
        .filter(line => line.trim().startsWith('- ') && line.includes(TEMPORAL_LAYOUT_MARKER))
        .length;
}

export function isTemporalLayoutValidation(validation: string): boolean {
    if (!validation.includes(TEMPORAL_LAYOUT_MARKER)) return false;
    if (validation.includes(SCRIPT_BEFORE_GLOBALS_MARKER)) return false;

    const errorLines = validation
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('- '));

    if (errorLines.length === 0) return false;

    return errorLines.every(line => line.includes(TEMPORAL_LAYOUT_MARKER));
}

export function shouldRequestLayoutRewrite(input: LayoutRewriteDecisionInput): boolean;
export function shouldRequestLayoutRewrite(
    attempt: number,
    maximumRepairs: number,
    validation: string
): boolean;
export function shouldRequestLayoutRewrite(
    attemptOrInput: number | LayoutRewriteDecisionInput,
    maximumRepairs?: number,
    validation?: string
): boolean {
    const input: LayoutRewriteDecisionInput = typeof attemptOrInput === 'number'
        ? {
            attempt: attemptOrInput,
            maximumRepairs: maximumRepairs ?? 5,
            validation: validation ?? '',
        }
        : attemptOrInput;

    if (!isTemporalLayoutValidation(input.validation)) return false;

    const layoutErrorCount = countTemporalLayoutErrors(input.validation);
    if (layoutErrorCount === 0) return false;

    const failedRepairs = input.consecutiveFailedRepairs ?? 0;
    const unimprovedRepairs = input.consecutiveUnimprovedRepairs ?? 0;

    // Last repair slot: always rewrite layout-only failures.
    if (input.attempt >= input.maximumRepairs - 1) return true;

    // JSON/syntax repair never applied — escalate quickly.
    if (failedRepairs >= FAILED_REPAIR_REWRITE_THRESHOLD) return true;

    // JSON edits applied but layout error count did not improve.
    if (unimprovedRepairs >= UNIMPROVED_REPAIR_REWRITE_THRESHOLD) return true;

    // After a prior rewrite, prefer another rewrite over brittle line edits.
    if (input.priorLayoutRewrite && input.attempt >= 1) return true;

    // Many layout issues on first repair: skip JSON line-edits entirely.
    if (input.attempt === 0 && layoutErrorCount >= IMMEDIATE_LAYOUT_REWRITE_ERROR_THRESHOLD) return true;

    // One JSON edit try, then rewrite when many layout issues remain.
    if (input.attempt >= 1 && layoutErrorCount >= IMMEDIATE_LAYOUT_REWRITE_ERROR_THRESHOLD) return true;

    // After one JSON edit, rewrite when several layout issues remain.
    if (input.attempt >= JSON_EDIT_ATTEMPTS_BEFORE_BULK_REWRITE && layoutErrorCount >= BULK_LAYOUT_REWRITE_MIN_ERRORS) {
        return true;
    }

    return false;
}

export async function requestAnimatorRepair(input: AnimatorRepairInput, session: AnimatorSession): Promise<RangeEdit[]> {
    const repairPrompt = [
        `The generated ${input.outputPath} failed the HTML contract validator.`,
        'Return only one JSON object in the existing edits tool format:',
        `{"path":"${input.outputPath}","edits":[{"lines":[1,2],"new":"replacement text"}]}`,
        'Line ranges are inclusive and refer to the line-numbered current file below. Use [a,b] to replace, [a] to insert after line a, and [0] to insert at the top.',
        'Make the smallest complete set of edits needed to resolve every validator error. Do not return the whole HTML file.',
        'If the error lists missing render helpers (draw*/render*/update*), copy their full function definitions from the previous validated HTML into this file.',
        'Every inline <script> block (without src=) must remain syntactically valid as a classic browser script after your edits.',
        'Never use a top-level return outside a function — that is illegal in browser scripts.',
        'Prefer coordinate, size, and CSS fixes for layout errors; do not rewrite large script regions unless the validator requires it.',
        'For canvas overlap errors, replace the existing fillText/strokeText line — do not add a second copy of the same label.',
        'Match exact line ranges carefully so replacements do not splice mid-statement or mid-expression.',
        'Return exactly one JSON object and nothing else after it.',
        '',
        '# Validator Output', input.validatorOutput,
        '',
        '# Previous Validated HTML Context', formatPreviousHtmlSummary(input.previousHtmls),
        '',
        `# Current ${input.outputPath} With Line Numbers`, lineNumbered(input.currentHtml),
        '',
        '# Current Script Block', input.scriptBlock
    ].join('\n');
    const response = await session.generate(`lecturegen_animator_repair_block_${input.blockIndex}`, repairPrompt, input.attachments);
    return parseAnimatorEdits(response, input.outputPath);
}

export async function requestAnimatorLayoutRewrite(input: AnimatorRepairInput, session: AnimatorSession): Promise<string> {
    const rewritePrompt = [
        `The generated ${input.outputPath} failed the HTML contract validator with temporal layout errors (overlaps, padding shortfalls).`,
        `Return one complete raw HTML document for ${input.outputPath} only. Begin with <!doctype html> and end with </html>. Do not return Markdown fences, JSON edits, or explanations.`,
        'Fix every layout error listed below by adjusting coordinates, font sizes, panel geometry, and padding.',
        'One label string = one fillText/strokeText call per draw pass.',
        'Keep window.__VIDEO_METADATA__, window.__VIDEO_PLAN__, and window.__RENDER_SECTION__ complete and valid.',
        'Every inline <script> block (without src=) must remain syntactically valid as a classic browser script.',
        'Never use a top-level return outside a function — that is illegal in browser scripts.',
        'Each index*.html file is standalone — copy every draw*/render*/update* helper you call into this file.',
        '',
        '# Validator Output', input.validatorOutput,
        '',
        '# Previous Validated HTML Context', formatPreviousHtmlSummary(input.previousHtmls),
        '',
        `# Current ${input.outputPath} (rewrite from this, fixing layout)`, input.currentHtml,
        '',
        '# Current Script Block', input.scriptBlock
    ].join('\n');
    const response = await session.generate(`lecturegen_animator_layout_rewrite_block_${input.blockIndex}`, rewritePrompt, input.attachments);
    const [html] = purify_content_for_path(input.outputPath, parseAnimatorHtml(response));
    return html;
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
    let lastSyntaxCleanHtml = initialHtml;
    let previousRepairError = '';
    let consecutiveFailedRepairs = 0;
    let consecutiveUnimprovedRepairs = 0;
    let priorLayoutRewrite = false;
    let previousLayoutErrorCount: number | null = null;
    let hadRepairSinceLastValidation = false;
    fs.writeFileSync(target, html, 'utf8');

    for (let attempt = 0; attempt <= maximumRepairs; attempt++) {
        const validation = validate_index_html_contract(input.outputPath, workspaceDir);
        onValidation?.(validation);
        if (validation.includes('validation passed')) return html;
        if (attempt === maximumRepairs) {
            throw new Error(`${input.outputPath} still failed validation after ${maximumRepairs} animator repair attempt(s):\n${validation}`);
        }

        const currentLayoutErrorCount = isTemporalLayoutValidation(validation)
            ? countTemporalLayoutErrors(validation)
            : null;
        if (
            hadRepairSinceLastValidation &&
            previousLayoutErrorCount != null &&
            currentLayoutErrorCount != null
        ) {
            if (currentLayoutErrorCount >= previousLayoutErrorCount) {
                consecutiveUnimprovedRepairs += 1;
            } else {
                consecutiveUnimprovedRepairs = 0;
            }
        }
        hadRepairSinceLastValidation = false;
        previousLayoutErrorCount = currentLayoutErrorCount;

        ({ anchor: lastSyntaxCleanHtml } = nextSyntaxCleanAnchor(html, lastSyntaxCleanHtml));

        const repairInput: AnimatorRepairInput = {
            ...input,
            currentHtml: html,
            validatorOutput: [
                validation,
                previousRepairError ? `Previous repair attempt error:\n${previousRepairError}` : ''
            ].filter(Boolean).join('\n\n')
        };

        const useLayoutRewrite = shouldRequestLayoutRewrite({
            attempt,
            maximumRepairs,
            validation,
            consecutiveFailedRepairs,
            consecutiveUnimprovedRepairs,
            priorLayoutRewrite,
        });

        try {
            if (useLayoutRewrite) {
                const rewriteSession = new AnimatorSession({
                    model: input.model,
                    tokenTrackerSessionId: input.tokenTrackerSessionId,
                    promptWorkspaceDir: input.promptWorkspaceDir,
                });
                html = await requestAnimatorLayoutRewrite(repairInput, rewriteSession);
                fs.writeFileSync(target, html, 'utf8');
                priorLayoutRewrite = true;
            } else {
                const edits = await requestAnimatorRepair(repairInput, session);
                tool_edits(input.outputPath, edits, workspaceDir);
                html = fs.readFileSync(target, 'utf8');
            }
        } catch (error) {
            previousRepairError = error instanceof Error ? error.message : String(error);
            consecutiveFailedRepairs += 1;
            onValidation?.(`Animator repair attempt failed: ${previousRepairError}`);
            continue;
        }

        const postEditSyntaxError = findInlineScriptSyntaxError(html);
        if (postEditSyntaxError) {
            html = revertToLastViable(target, lastSyntaxCleanHtml);
            previousRepairError = `Repair edits introduced a JavaScript syntax error (${postEditSyntaxError}). Edits were reverted to the last viable file.`;
            consecutiveFailedRepairs += 1;
            onValidation?.(previousRepairError);
            continue;
        }

        consecutiveFailedRepairs = 0;
        previousRepairError = '';
        hadRepairSinceLastValidation = true;
    }
    throw new Error(`Unexpected validation loop exit for ${input.outputPath}.`);
}
