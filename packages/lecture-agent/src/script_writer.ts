import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLlm, readPrompt, type VideoMakerAttachment, type VideoMakerLlmOptions } from './video_maker_shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'scriptgen_system.md');

export type ScriptWriterInput = VideoMakerLlmOptions & {
    request: string;
    generationLength: string;
    answer: string;
    theme: string;
    teachingStyle: string;
    enableGetimg: boolean;
    attachments?: VideoMakerAttachment[];
};

export async function writeScript(input: ScriptWriterInput): Promise<string> {
    // The system prompt is the existing script-generator prompt, unchanged.
    const imagePolicy = input.enableGetimg
        ? ''
        : '\n\n# Image Asset Policy\nExternal image retrieval is disabled. Never output a getimg directive or request an external image. Design all visuals with HTML, CSS, SVG, Canvas, or user-supplied attachments.';
    const systemPrompt = `${readPrompt(systemPromptPath)}\n\n# Teaching Style\n${input.teachingStyle}\n\n# Visual Theme\n${input.theme}${imagePolicy}`;
    const imageInstructions = input.enableGetimg
        ? [
            'When an image is needed, give it a stable requested filename using exactly:',
            `[(getimg: 'short image description', out: 'assets/descriptive-name.png')]`,
            'Use a unique, safe filename for every distinct image.'
        ]
        : [
            'Do not request, download, or generate external images.',
            'Never output a [(getimg: ...)] directive.',
            'Plan every visual using HTML, CSS, SVG, Canvas, or user-supplied attachments.'
        ];
    const userPrompt = [
        `Request Topic: ${input.request}`,
        `Requested Length: ${input.generationLength}`,
        '',
        ...imageInstructions,
        '',
        'Here is the concept explanation (answer.md):',
        '',
        input.answer
    ].join('\n');
    return runLlm(input, 'video_maker_script_writer', systemPrompt, userPrompt, input.attachments);
}
