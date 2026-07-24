import fs from 'node:fs';
import path from 'node:path';

import { build_prompt } from './prompt_builder.js';
import { LLM_Model } from './utils/llm_model.js';

export type VideoMakerAttachment = {
    path: string;
    kind: 'image' | 'pdf' | 'video';
    mimeType?: string;
};

export type VideoMakerLlmOptions = {
    model: string;
    tokenTrackerSessionId?: string | null;
    promptWorkspaceDir?: string;
};

export function readPrompt(promptPath: string): string {
    if (!fs.existsSync(promptPath)) {
        throw new Error(`Video-maker prompt not found: ${promptPath}`);
    }
    return fs.readFileSync(promptPath, 'utf8');
}

function responseText(response: any, purpose: string): string {
    const value = (typeof response === 'string' ? response : response?.text || '').trim();
    if (!value) throw new Error(`${purpose} returned an empty response.`);
    return value;
}

export async function runLlm(
    options: VideoMakerLlmOptions,
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    attachments: VideoMakerAttachment[] = []
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
export class VideoMakerLlmSession {
    private readonly llm: LLM_Model;
    private attachmentsAdded = false;
    private readonly promptWorkspaceDir: string;

    constructor(options: VideoMakerLlmOptions, systemPrompt: string) {
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
        attachments: VideoMakerAttachment[] = []
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
        throw new Error(`Unsafe video-maker output path: ${value}`);
    }
    return normalized;
}
