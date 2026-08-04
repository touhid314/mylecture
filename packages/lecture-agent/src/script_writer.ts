import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLlm, readPrompt, type LectureGenAttachment, type LectureGenLlmOptions } from './lecturegen_shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'scriptgen_system.md');

export type ScriptWriterInput = LectureGenLlmOptions & {
    request: string;
    generationLength: string;
    answer: string;
    theme: string;
    teachingStyle: string;
    enableGetimg: boolean;
    attachments?: LectureGenAttachment[];
};

export async function writeScript(input: ScriptWriterInput): Promise<string> {
    const imagePolicy = input.enableGetimg
        ? ''
        : '\n\n# Image Asset Policy\nExternal image retrieval (getimg) is disabled. Never output a getimg directive. Design all visuals with HTML, CSS, SVG, Canvas, or user-supplied attachments. For geographic maps, use the bundled Natural Earth basemap at assets/world-basemap.svg (copied into the workspace) — never invent freehand continent polygons.';
    const vCueOutputBoundary = '\n\n# V Cue Output Boundary\n\n- V cues are semantic plans, not HTML/CSS/JS.\n- Do not include raw tags, inline styles, scripts, or code blocks in V cues.\n- Do not prescribe CSS values, pixel sizes, or implementation coordinates in V cues.\n- Preserve all technical labels, names, values, and table content as plain semantic text.';
    const systemPrompt = `${readPrompt(systemPromptPath)}\n\n# Teaching Style\n${input.teachingStyle}\n\n# Visual Theme\n${input.theme}${vCueOutputBoundary}${imagePolicy}`;
    const imageInstructions = input.enableGetimg
        ? [
            'When an image is needed, give it a stable requested filename using exactly:',
            `[(getimg: 'short image description', out: 'assets/descriptive-name.png')]`,
            'Use a unique, safe filename for every distinct image.',
            'For world/region supply-chain maps, use bundled assets/world-basemap.svg as background; overlay markers/arcs in SVG — do not use getimg for basemaps.'
        ]
        : [
            'Do not request, download, or generate external images.',
            'Never output a [(getimg: ...)] directive.',
            'For geographic maps, reference bundled assets/world-basemap.svg and overlay markers/arcs in SVG/HTML.',
            'Never invent freehand continent/coastline polygons.',
            'Plan every other visual using HTML, CSS, SVG, Canvas, or user-supplied attachments.'
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
    return runLlm(input, 'lecturegen_script_writer', systemPrompt, userPrompt, input.attachments);
}
