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
    /** Path used for purify / naming (default interactive.html). */
    outputPath?: string;
};

export async function runIAGen(input: IAGenInput): Promise<string> {
    const reference = input.referenceMaterial?.trim()
        ? ['# Optional Reference Material', input.referenceMaterial.trim()]
        : ['# Optional Reference Material', 'None. Design the interaction directly from the user request.'];
    const attachmentNames = (input.attachments || [])
        .map(attachment => `- ${path.basename(attachment.path)} (${attachment.kind})`)
        .join('\n') || 'None.';
    const outputPath = input.outputPath || 'interactive.html';
    const userPrompt = [
        '# User Request',
        input.request,
        '',
        `Target aspect ratio: ${input.aspectRatio}`,
        `Output path: ${outputPath}`,
        '',
        '# Supplied Attachments',
        attachmentNames,
        '',
        ...reference,
        '',
        `Create the single standalone HTML document for ${outputPath} now.`
    ].join('\n');
    const response = await runLlm(
        input,
        'iagen',
        readPrompt(systemPromptPath),
        userPrompt,
        input.attachments
    );
    const [html] = purify_content_for_path(
        outputPath,
        parseSingleHtmlDocument(response, 'IAGen')
    );
    return html;
}
