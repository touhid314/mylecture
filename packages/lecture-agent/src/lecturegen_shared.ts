import fs from 'node:fs';
import path from 'node:path';

import { build_prompt } from './prompt_builder.js';
import { LLM_Model } from './utils/llm_model.js';

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

export async function runLlm(
    options: LectureGenLlmOptions,
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    attachments: LectureGenAttachment[] = []
): Promise<string> {
    const workspaceDir = options.promptWorkspaceDir || process.cwd();
    const llm = new LLM_Model(options.model, build_prompt(systemPrompt, workspaceDir));
    llm.token_tracker_session_id = options.tokenTrackerSessionId || null;
    llm.token_tracker_purpose = purpose;
    const response = await llm.generate(
        build_prompt(userPrompt, workspaceDir),
        null,
        null,
        null,
        attachments,
        false,
        false
    );
    return responseText(response, purpose);
}

/**
 * Retains complete request/response history so sequential calls have an exact,
 * cacheable prefix, matching the coding agent's within-turn behavior.
 */
export class LectureGenLlmSession {
    private readonly llm: LLM_Model;
    private attachmentsAdded = false;
    private readonly promptWorkspaceDir: string;

    constructor(options: LectureGenLlmOptions, systemPrompt: string) {
        this.promptWorkspaceDir = options.promptWorkspaceDir || process.cwd();
        this.llm = new LLM_Model(
            options.model,
            build_prompt(systemPrompt, this.promptWorkspaceDir)
        );
        this.llm.token_tracker_session_id = options.tokenTrackerSessionId || null;
    }

    async generate(
        purpose: string,
        userPrompt: string,
        attachments: LectureGenAttachment[] = []
    ): Promise<string> {
        this.llm.token_tracker_purpose = purpose;
        // Attach binary inputs once. They remain part of retained history; adding
        // them to every new user message would duplicate them and disrupt caching.
        const currentAttachments = this.attachmentsAdded ? [] : attachments;
        if (currentAttachments.length > 0) this.attachmentsAdded = true;
        const response = await this.llm.generate(
            build_prompt(userPrompt, this.promptWorkspaceDir),
            null,
            null,
            null,
            currentAttachments,
            false,
            true
        );
        return responseText(response, purpose);
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
