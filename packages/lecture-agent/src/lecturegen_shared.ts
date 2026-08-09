import fs from 'node:fs';
import path from 'node:path';

import { build_prompt } from './prompt_builder.js';
import { LLM_Model } from './utils/llm_model.js';
import {
    clampLlmRetryWaitMs,
    isLlmCapacityError,
    isLlmRateLimitError,
    parseRetryAfterMs,
    PRIMARY_RESTORE_FAILURE_PUSH_MS,
    primaryCooldownUntilMs,
    resolveLlmFallbackModel,
} from './utils/llm_rate_limit.js';

export type LectureGenAttachment = {
    path: string;
    kind: 'image' | 'pdf' | 'video';
    mimeType?: string;
};

export type LectureGenLlmOptions = {
    model: string;
    tokenTrackerSessionId?: string | null;
    promptWorkspaceDir?: string;
};

export function readPrompt(promptPath: string): string {
    if (!fs.existsSync(promptPath)) {
        throw new Error(`LectureGen prompt not found: ${promptPath}`);
    }
    return fs.readFileSync(promptPath, 'utf8');
}

function responseText(response: any, purpose: string): string {
    const value = (typeof response === 'string' ? response : response?.text || '').trim();
    if (!value) throw new Error(`${purpose} returned an empty response.`);
    return value;
}

function rateLimitBackoffMs(err: unknown, attempt: number): number {
    const delay = parseRetryAfterMs(err) ?? 2000 * attempt;
    return clampLlmRetryWaitMs(delay);
}

function shouldFallbackAcrossProviders(err: unknown): boolean {
    return isLlmRateLimitError(err) || isLlmCapacityError(err);
}

type LlmRetryHandle = {
    llm: LLM_Model;
    primaryModel: string;
    onFallback: boolean;
    primaryRetryAtMs: number | null;
    systemContent: string;
};

function switchLlmModel(
    handle: LlmRetryHandle,
    nextModel: string,
    { copyHistory }: { copyHistory: boolean }
): void {
    const history = copyHistory ? handle.llm.history.slice() : null;
    const sessionId = handle.llm.token_tracker_session_id;
    const trackerPurpose: string | null = handle.llm.token_tracker_purpose;
    const next = new LLM_Model(nextModel, handle.systemContent);
    if (history) next.history = history;
    next.token_tracker_session_id = sessionId;
    next.token_tracker_purpose = trackerPurpose;
    handle.llm = next;
}

function maybeRestorePrimary(
    handle: LlmRetryHandle,
    purpose: string,
    options?: { copyHistoryOnFallback?: boolean }
): void {
    if (
        !handle.onFallback ||
        handle.primaryRetryAtMs == null ||
        Date.now() < handle.primaryRetryAtMs
    ) {
        return;
    }

    try {
        switchLlmModel(handle, handle.primaryModel, {
            copyHistory: options?.copyHistoryOnFallback ?? false,
        });
        handle.onFallback = false;
        handle.primaryRetryAtMs = null;
        console.log(
            `[LectureGen LLM] ${purpose} cooldown elapsed; returning to ${handle.primaryModel}`
        );
    } catch (restoreErr: any) {
        console.warn(
            `[LectureGen LLM] ${purpose} restore to ${handle.primaryModel} failed: ${restoreErr?.message || restoreErr}`
        );
        // Stay on the fallback; push cooldown forward to avoid hammering.
        handle.primaryRetryAtMs = Date.now() + PRIMARY_RESTORE_FAILURE_PUSH_MS;
    }
}

/**
 * Shared LectureGen retry loop: temporary cross-provider fallback on rate-limit
 * or explicit provider-capacity failures.
 * Primary restore runs once per generate (start of this call), not mid-retry;
 * the next generate()/runLlm returns to the configured primary after cooldown.
 * Retry-after backoff when no fallback is available / construction fails,
 * or when already on the fallback provider.
 */
async function generateWithRateLimitFallback(
    handle: LlmRetryHandle,
    purpose: string,
    generateOnce: (llm: LLM_Model) => Promise<any>,
    options?: { copyHistoryOnFallback?: boolean }
): Promise<string> {
    maybeRestorePrimary(handle, purpose, options);

    const maxAttempts = 3;
    let lastError: any = null;
    let fallbackBudgetResetUsed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await generateOnce(handle.llm);
            return responseText(response, purpose);
        } catch (err: any) {
            lastError = err;
            console.warn(
                `[LectureGen LLM] ${purpose} attempt ${attempt}/${maxAttempts} failed: ${err.message || err}`
            );

            if (shouldFallbackAcrossProviders(err) && !handle.onFallback) {
                const fallback = resolveLlmFallbackModel(handle.primaryModel);
                if (fallback) {
                    console.warn(
                        `[LectureGen LLM] ${purpose} rate/capacity failure on ${handle.llm.model_name}; falling back to ${fallback}`
                    );
                    handle.primaryRetryAtMs = primaryCooldownUntilMs(err);
                    try {
                        switchLlmModel(handle, fallback, {
                            copyHistory: options?.copyHistoryOnFallback ?? false,
                        });
                        handle.onFallback = true;
                        // Fresh attempt budget on the fallback at most once per generate.
                        if (!fallbackBudgetResetUsed) {
                            fallbackBudgetResetUsed = true;
                            attempt = 0;
                            continue;
                        }
                        // Already reset once; keep burning remaining attempts.
                        continue;
                    } catch (constructErr: any) {
                        console.warn(
                            `[LectureGen LLM] ${purpose} fallback to ${fallback} failed: ${constructErr?.message || constructErr}`
                        );
                        // Do not set onFallback — fall through to primary retry-after backoff.
                        handle.primaryRetryAtMs = null;
                    }
                }
            }

            if (attempt < maxAttempts) {
                const delayMs = shouldFallbackAcrossProviders(err)
                    ? rateLimitBackoffMs(err, attempt)
                    : 2000 * attempt;
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw new Error(`${purpose} failed after ${maxAttempts} attempts: ${lastError?.message || lastError}`);
}

export async function runLlm(
    options: LectureGenLlmOptions,
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    attachments: LectureGenAttachment[] = []
): Promise<string> {
    const workspaceDir = options.promptWorkspaceDir || process.cwd();
    const systemContent = build_prompt(systemPrompt, workspaceDir);
    const handle: LlmRetryHandle = {
        llm: new LLM_Model(options.model, systemContent),
        primaryModel: options.model,
        onFallback: false,
        primaryRetryAtMs: null,
        systemContent,
    };
    handle.llm.token_tracker_session_id = options.tokenTrackerSessionId || null;
    handle.llm.token_tracker_purpose = purpose;

    return generateWithRateLimitFallback(handle, purpose, (llm) =>
        llm.generate(
            build_prompt(userPrompt, workspaceDir),
            null,
            null,
            null,
            attachments,
            false,
            false
        )
    );
}

/**
 * Retains complete request/response history so sequential calls have an exact,
 * cacheable prefix, matching the coding agent's within-turn behavior.
 */
export class LectureGenLlmSession {
    private readonly handle: LlmRetryHandle;
    private attachmentsAdded = false;
    private readonly promptWorkspaceDir: string;

    constructor(options: LectureGenLlmOptions, systemPrompt: string) {
        this.promptWorkspaceDir = options.promptWorkspaceDir || process.cwd();
        const systemContent = build_prompt(systemPrompt, this.promptWorkspaceDir);
        this.handle = {
            llm: new LLM_Model(options.model, systemContent),
            primaryModel: options.model,
            onFallback: false,
            primaryRetryAtMs: null,
            systemContent,
        };
        this.handle.llm.token_tracker_session_id = options.tokenTrackerSessionId || null;
    }

    async generate(
        purpose: string,
        userPrompt: string,
        attachments: LectureGenAttachment[] = []
    ): Promise<string> {
        this.handle.llm.token_tracker_purpose = purpose;
        // Attach binary inputs once. They remain part of retained history; adding
        // them to every new user message would duplicate them and disrupt caching.
        const currentAttachments = this.attachmentsAdded ? [] : attachments;

        const text = await generateWithRateLimitFallback(
            this.handle,
            purpose,
            (llm) =>
                llm.generate(
                    build_prompt(userPrompt, this.promptWorkspaceDir),
                    null,
                    null,
                    null,
                    currentAttachments,
                    false,
                    true
                ),
            { copyHistoryOnFallback: true }
        );
        if (currentAttachments.length > 0) this.attachmentsAdded = true;
        return text;
    }
}

export function safeRelativeFile(value: string): string {
    const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
        throw new Error(`Unsafe LectureGen output path: ${value}`);
    }
    return normalized;
}

export function parseSingleHtmlDocument(response: string, purpose: string): string {
    let content = response.trim();
    content = content.replace(/^```html\s*/i, '').replace(/\s*```$/, '').trim();
    const openingTags = content.match(/<html\b/gi)?.length || 0;
    const closingTags = content.match(/<\/html\s*>/gi)?.length || 0;
    if (openingTags !== 1 || closingTags !== 1) {
        throw new Error(`${purpose} must return exactly one complete HTML document.`);
    }
    const htmlStart = content.search(/<html\b/i);
    const doctypeStart = content.search(/<!doctype\s+html/i);
    const start = doctypeStart >= 0 && doctypeStart < htmlStart ? doctypeStart : htmlStart;
    const endMatches = [...content.matchAll(/<\/html\s*>/gi)];
    const finalEnd = endMatches.at(-1);
    const end = finalEnd ? (finalEnd.index || 0) + finalEnd[0].length : -1;
    if (start < 0 || end <= start) {
        throw new Error(`${purpose} must return one complete HTML document ending with </html>.`);
    }
    const prefix = content.slice(0, start).trim();
    const suffix = content.slice(end).trim();
    if (prefix || suffix) {
        throw new Error(`${purpose} returned text outside the HTML document.`);
    }
    return content.slice(start, end).trim();
}
