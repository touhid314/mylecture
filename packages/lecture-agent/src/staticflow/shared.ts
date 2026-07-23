import fs from 'node:fs';
import path from 'node:path';

import { LLM_Model } from '../llm_model.js';

export type StaticFlowAttachment = {
    path: string;
    kind: 'image' | 'pdf' | 'video';
    mimeType?: string;
};

export type StaticFlowLlmOptions = {
    model: string;
    tokenTrackerSessionId?: string | null;
};

export function readPrompt(promptPath: string): string {
    if (!fs.existsSync(promptPath)) {
        throw new Error(`Static-flow prompt not found: ${promptPath}`);
    }
    return fs.readFileSync(promptPath, 'utf8');
}

function responseText(response: any, purpose: string): string {
    const value = (typeof response === 'string' ? response : response?.text || '').trim();
    if (!value) throw new Error(`${purpose} returned an empty response.`);
    return value;
}

export async function runLlm(
    options: StaticFlowLlmOptions,
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    attachments: StaticFlowAttachment[] = []
): Promise<string> {
    const llm = new LLM_Model(options.model, systemPrompt);
    llm.token_tracker_session_id = options.tokenTrackerSessionId || null;
    llm.token_tracker_purpose = purpose;
    const response = await llm.generate(
        userPrompt,
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
export class StaticFlowLlmSession {
    private readonly llm: LLM_Model;
    private attachmentsAdded = false;

    constructor(options: StaticFlowLlmOptions, systemPrompt: string) {
        this.llm = new LLM_Model(options.model, systemPrompt);
        this.llm.token_tracker_session_id = options.tokenTrackerSessionId || null;
    }

    async generate(
        purpose: string,
        userPrompt: string,
        attachments: StaticFlowAttachment[] = []
    ): Promise<string> {
        this.llm.token_tracker_purpose = purpose;
        // Attach binary inputs once. They remain part of retained history; adding
        // them to every new user message would duplicate them and disrupt caching.
        const currentAttachments = this.attachmentsAdded ? [] : attachments;
        if (currentAttachments.length > 0) this.attachmentsAdded = true;
        const response = await this.llm.generate(
            userPrompt,
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
        throw new Error(`Unsafe static-flow output path: ${value}`);
    }
    return normalized;
}
