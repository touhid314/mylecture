import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLlm, readPrompt, type VideoMakerAttachment, type VideoMakerLlmOptions } from './video_maker_shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'ansgen_system.md');

export type AnswerGeneratorInput = VideoMakerLlmOptions & {
    request: string;
    generationLength: string;
    teachingStyle: string;
    attachments?: VideoMakerAttachment[];
};

export async function generateAnswer(input: AnswerGeneratorInput): Promise<string> {
    // Keep the existing answer-generator system prompt intact, adding the selected
    // teaching style as runtime context for this dedicated video-maker stage.
    const systemPrompt = `${readPrompt(systemPromptPath)}\n\n# Teaching Style\n${input.teachingStyle}`;
    const userPrompt = `Request Topic: ${input.request}\nRequested Length: ${input.generationLength}`;
    return runLlm(input, 'video_maker_answer_generator', systemPrompt, userPrompt, input.attachments);
}
