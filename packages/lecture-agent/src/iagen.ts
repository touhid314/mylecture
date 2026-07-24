import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { purify_content_for_path } from './utils/html_contract.js';
import {
    parseSingleHtmlDocument,
    readPrompt,
    runLlm,
    type LectureGenAttachment,
    type LectureGenLlmOptions
} from './lecturegen_shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'iagen_system.md');

export type IAGenInput = LectureGenLlmOptions & {
    request: string;
    aspectRatio: string;
    referenceMaterial?: string;
    attachments?: LectureGenAttachment[];
};

export async function runIAGen(input: IAGenInput): Promise<string> {
    const reference = input.referenceMaterial?.trim()
        ? ['# Optional Reference Material', input.referenceMaterial.trim()]
        : ['# Optional Reference Material', 'None. Design the interaction directly from the user request.'];
    const attachmentNames = (input.attachments || [])
        .map(attachment => `- ${path.basename(attachment.path)} (${attachment.kind})`)
        .join('\n') || 'None.';
    const userPrompt = [
        '# User Request',
        input.request,
        '',
        `Target aspect ratio: ${input.aspectRatio}`,
        '',
        '# Supplied Attachments',
        attachmentNames,
        '',
        ...reference,
        '',
        'Create the single standalone interactive.html document now.'
    ].join('\n');
    const response = await runLlm(
        input,
        'iagen',
        readPrompt(systemPromptPath),
        userPrompt,
        input.attachments
    );
    const [html] = purify_content_for_path(
        'interactive.html',
        parseSingleHtmlDocument(response, 'IAGen')
    );
    return html;
}
