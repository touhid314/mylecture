import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLlm, readPrompt, type LectureGenAttachment, type LectureGenLlmOptions } from './lecturegen_shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'ansgen_system.md');

export type AnswerGeneratorInput = LectureGenLlmOptions & {
    request: string;
    generationLength: string;
    teachingStyle: string;
    attachments?: LectureGenAttachment[];
};

export async function generateAnswer(input: AnswerGeneratorInput): Promise<string> {
    // Keep the existing answer-generator system prompt intact, adding the selected
    // teaching style as runtime context for this dedicated LectureGen stage.
    const systemPrompt = `${readPrompt(systemPromptPath)}\n\n# Teaching Style\n${input.teachingStyle}`;
    const userPrompt = `Request Topic: ${input.request}\nRequested Length: ${input.generationLength}`;
    return runLlm(input, 'lecturegen_answer_generator', systemPrompt, userPrompt, input.attachments);
}
