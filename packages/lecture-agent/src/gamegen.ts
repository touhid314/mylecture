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
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'gamegen_system.md');

export type GameGenInput = LectureGenLlmOptions & {
    request: string;
    aspectRatio: string;
    referenceMaterial?: string;
    attachments?: LectureGenAttachment[];
    /** Path used for purify / naming (default game.html). */
    outputPath?: string;
};

export async function runGameGen(input: GameGenInput): Promise<string> {
    const reference = input.referenceMaterial?.trim()
        ? ['# Optional Reference Material', input.referenceMaterial.trim()]
        : ['# Optional Reference Material', 'None. Design the game directly from the user request.'];
    const attachmentNames = (input.attachments || [])
        .map(attachment => `- ${path.basename(attachment.path)} (${attachment.kind})`)
        .join('\n') || 'None.';
    const outputPath = input.outputPath || 'game.html';
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
        'gamegen',
        readPrompt(systemPromptPath),
        userPrompt,
        input.attachments
    );
    const [html] = purify_content_for_path(
        outputPath,
        parseSingleHtmlDocument(response, 'GameGen')
    );
    return html;
}
