import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLlm, readPrompt, type StaticFlowAttachment, type StaticFlowLlmOptions } from './shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, '..', 'prompts', 'ansgen_system.md');

export type AnswerGeneratorInput = StaticFlowLlmOptions & {
    request: string;
    generationLength: string;
    teachingStyle: string;
    attachments?: StaticFlowAttachment[];
};

export async function generateAnswer(input: AnswerGeneratorInput): Promise<string> {
    // Keep the existing answer-generator system prompt intact, adding the selected
    // teaching style as runtime context just as the current script subagent does.
    const systemPrompt = `${readPrompt(systemPromptPath)}\n\n# Teaching Style\n${input.teachingStyle}`;
    const userPrompt = `Request Topic: ${input.request}\nRequested Length: ${input.generationLength}`;
    return runLlm(input, 'staticflow_answer_generator', systemPrompt, userPrompt, input.attachments);
}
