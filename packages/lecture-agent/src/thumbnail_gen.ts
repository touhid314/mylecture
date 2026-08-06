/**
 * thumbnail_gen.ts
 *
 * Standalone thumbnail generator: script -> [image-gen LLM] -> thumbnail image.
 * Not wired into the main LectureGen pipeline; run it directly via CLI.
 *
 * CLI usage:
 *   npx tsx packages/lecture-agent/src/thumbnail_gen.ts --script path/to/script.md [options]
 *   npx tsx packages/lecture-agent/src/thumbnail_gen.ts --text "raw script text" [options]
 *   npx tsx packages/lecture-agent/src/thumbnail_gen.ts --prompt "direct image prompt" [options]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { LLM_Model } from './utils/llm_model.js';
import { stripImageRequests } from './asset_fetcher.js';
import { readPrompt } from './lecturegen_shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const systemPromptPath = path.resolve(__dirname, 'prompts', 'thumbnailgen_system.md');

function loadEnv() {
    let dir = __dirname;
    while (dir && dir !== path.parse(dir).root) {
        const envPath = path.join(dir, '.env');
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, quiet: true });
            return;
        }
        dir = path.dirname(dir);
    }
}
loadEnv();

type ThumbnailGenModel = 'gemini-flash-lite' | 'gemini-flash' | 'gemini-pro';

const MODEL_NAME_BY_ALIAS: Record<ThumbnailGenModel, string> = {
    'gemini-flash-lite': 'gemini-3.1-flash-lite-image',
    'gemini-flash': 'gemini-3.1-flash-image',
    'gemini-pro': 'gemini-3-pro-image',
};

export interface ThumbnailGenOptions {
    /** Path to a lecture script file to base the thumbnail on. */
    script?: string;
    /** Raw script text to base the thumbnail on (alternative to `script`). */
    text?: string;
    /** A direct image-generation prompt, used as-is instead of a script. */
    prompt?: string;
    /** Output image file path. */
    out: string;
    /** Which Gemini image model to use. Defaults to 'gemini-pro'. */
    model?: ThumbnailGenModel;
    /** Aspect ratio for the generated image. Defaults to '16:9'. */
    aspect?: string;
    /** Optional resolution tier. */
    resolution?: '0.5K' | '512' | '1K' | '2K' | '4K';
}

function buildThumbnailUserPrompt(scriptContent: string): string {
    return [
        'Generate a thumbnail image for the lecture with the following script.',
        '',
        'Lecture script (for context on the topic; do not render this text verbatim):',
        '---',
        stripImageRequests(scriptContent).trim(),
        '---',
    ].join('\n');
}

/**
 * Generates a thumbnail image via Gemini image generation and saves it to `options.out`.
 */
export async function generateThumbnail(options: ThumbnailGenOptions): Promise<void> {
    const alias = options.model || 'gemini-pro';
    const modelName = MODEL_NAME_BY_ALIAS[alias];
    if (!modelName) {
        throw new Error(`Unsupported model alias: ${alias}. Supported: ${Object.keys(MODEL_NAME_BY_ALIAS).join(', ')}.`);
    }

    let finalPrompt: string;
    if (options.prompt) {
        finalPrompt = options.prompt;
    } else if (options.text) {
        finalPrompt = buildThumbnailUserPrompt(options.text);
    } else if (options.script) {
        if (!fs.existsSync(options.script)) {
            throw new Error(`Script file not found: ${options.script}`);
        }
        finalPrompt = buildThumbnailUserPrompt(fs.readFileSync(options.script, 'utf8'));
    } else {
        throw new Error('One of --script, --text, or --prompt is required.');
    }

    const systemPrompt = readPrompt(systemPromptPath);

    console.log(`[Thumbnail Gen] Generating thumbnail via ${modelName}...`);
    const modelInstance = new LLM_Model(modelName, systemPrompt);
    modelInstance.token_tracker_session_id = process.env.TOKEN_TRACKER_SESSION_ID || null;
    modelInstance.token_tracker_purpose = 'thumbnail_generation';

    const response = await modelInstance.generateImage({
        prompt: finalPrompt,
        aspect: options.aspect || '16:9',
        resolution: options.resolution,
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!parts || parts.length === 0) {
        if (candidate?.finishReason) {
            throw new Error(`No content parts returned by Gemini image generation. Finish reason: ${candidate.finishReason}.`);
        }
        throw new Error('No content parts returned by Gemini image generation.');
    }

    let buffer: Buffer | null = null;
    for (const part of parts) {
        if (part.inlineData?.data) {
            buffer = Buffer.from(part.inlineData.data, 'base64');
            break;
        }
    }
    if (!buffer) {
        throw new Error('No inline image data found in response parts.');
    }

    const dir = path.dirname(options.out);
    if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(options.out, buffer);
    console.log(`[Thumbnail Gen] Successfully saved thumbnail to ${options.out} (${buffer.length} bytes)`);
}

function printHelp() {
    console.log(`
Usage:
  npx tsx packages/lecture-agent/src/thumbnail_gen.ts [options]

Input (choose exactly one):
  -s, --script <path>          Path to a lecture script file; its content informs the thumbnail.
  -t, --text <string>          Raw script text; its content informs the thumbnail.
  -p, --prompt <string>        A direct image-generation prompt, used as-is.

Options:
  -o, --out <path>             Output image path. (Default: ./thumbnail.png)
  --model <string>             Gemini image model alias:
                                - gemini-flash-lite: Gemini 3.1 Flash Lite Image.
                                - gemini-flash: Gemini 3.1 Flash Image.
                                - gemini-pro: Gemini 3 Pro Image (Default).
  -a, --aspect <string>        Aspect ratio for the generated image. (Default: 16:9)
  -r, --res, --resolution      Resolution tier ("0.5K", "512", "1K", "2K", "4K").
  --help                       Show this message.

Requires GOOGLE_API_KEY in the environment (or a .env file in an ancestor directory).
`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        printHelp();
        process.exit(0);
    }

    let script: string | undefined;
    let text: string | undefined;
    let prompt: string | undefined;
    let out = './thumbnail.png';
    let model: ThumbnailGenModel | undefined;
    let aspect: string | undefined;
    let resolution: ThumbnailGenOptions['resolution'];

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--script' || args[i] === '-s') && i + 1 < args.length) {
            script = args[++i];
        } else if ((args[i] === '--text' || args[i] === '-t') && i + 1 < args.length) {
            text = args[++i];
        } else if ((args[i] === '--prompt' || args[i] === '-p') && i + 1 < args.length) {
            prompt = args[++i];
        } else if ((args[i] === '--out' || args[i] === '-o') && i + 1 < args.length) {
            out = args[++i];
        } else if (args[i] === '--model' && i + 1 < args.length) {
            const m = args[++i].toLowerCase();
            if (m === 'gemini-flash-lite' || m === 'gemini-flash' || m === 'gemini-pro') {
                model = m as ThumbnailGenModel;
            } else {
                console.error(`Error: Invalid model "${m}". Supported models: gemini-flash-lite, gemini-flash, gemini-pro.`);
                process.exit(1);
            }
        } else if ((args[i] === '--aspect' || args[i] === '-a') && i + 1 < args.length) {
            aspect = args[++i];
        } else if ((args[i] === '--res' || args[i] === '--resolution' || args[i] === '-r') && i + 1 < args.length) {
            const r = args[++i].toUpperCase();
            if (r === '0.5K' || r === '512' || r === '1K' || r === '2K' || r === '4K') {
                resolution = r as ThumbnailGenOptions['resolution'];
            } else {
                console.error(`Error: Invalid resolution "${r}". Supported resolutions: 0.5K, 512, 1K, 2K, 4K.`);
                process.exit(1);
            }
        }
    }

    const inputsProvided = [script, text, prompt].filter(v => v !== undefined).length;
    if (inputsProvided === 0) {
        console.error('Error: one of --script, --text, or --prompt is required.');
        printHelp();
        process.exit(1);
    }
    if (inputsProvided > 1) {
        console.error('Error: provide only one of --script, --text, or --prompt.');
        process.exit(1);
    }

    try {
        await generateThumbnail({ script, text, prompt, out, model, aspect, resolution });
        console.log('Completed successfully!');
    } catch (e) {
        console.error('Execution failed:', e instanceof Error ? e.message : e);
        process.exit(1);
    }
}

const modulePath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isMain = !!argvPath && fs.existsSync(argvPath) && fs.realpathSync(argvPath) === fs.realpathSync(modulePath);
if (isMain) {
    main();
}
