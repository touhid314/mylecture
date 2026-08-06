/**
 * metadata_generator.ts
 *
 * Wired into the main LectureGen pipeline (see lecturegen.ts), and also runnable
 * standalone via CLI for testing:
 *
 *   npx tsx packages/lecture-agent/src/metadata_generator.ts --answer path/to/answer.md [options]
 *   npx tsx packages/lecture-agent/src/metadata_generator.ts --text "raw answer text" [options]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLlm, readPrompt, type LectureGenLlmOptions } from './lecturegen_shared.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(moduleDir, 'prompts', 'metadatagen_system.md');

/** METADATA_MODEL (see .env) is the sole source of the metadata generation model; no code-level fallback. */
export function resolveMetadataModel(): string {
    const model = (process.env.METADATA_MODEL || '').trim();
    if (!model) {
        throw new Error('METADATA_MODEL environment variable is required for metadata generation.');
    }
    return model;
}

export type MetadataGeneratorInput = LectureGenLlmOptions & {
    request: string;
    answer: string;
};

export type LectureMetadata = {
    title: string;
    description: string;
};

function parseMetadataResponse(response: string): LectureMetadata {
    const text = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`metadata generator returned invalid JSON: ${response}`);
    }
    const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
    const description = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
    if (!title || !description) {
        throw new Error(`metadata generator response missing title/description: ${response}`);
    }
    return { title, description };
}

export async function generateMetadata(input: MetadataGeneratorInput): Promise<LectureMetadata> {
    const systemPrompt = readPrompt(systemPromptPath);
    const userPrompt = [
        `Request Topic: ${input.request}`,
        '',
        'Here is the concept explanation (answer.md) for this lecture:',
        '',
        input.answer
    ].join('\n');
    const response = await runLlm(input, 'lecturegen_metadata_generator', systemPrompt, userPrompt);
    return parseMetadataResponse(response);
}

function printHelp() {
    console.log(`
Usage:
  npx tsx packages/lecture-agent/src/metadata_generator.ts [options]

Input (choose exactly one):
  -a, --answer <path>          Path to an answer.md file; its content informs the metadata.
  -t, --text <string>          Raw answer text; its content informs the metadata.

Options:
  -r, --request <string>       Original request/topic for extra context. (Default: empty)
  -o, --out <path>             Output JSON path. (Default: ./metadata.json)
  --model <string>             LLM model to use. (Default: METADATA_MODEL env var; required if not set)
  --help                       Show this message.
`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        printHelp();
        process.exit(0);
    }

    let answerPath: string | undefined;
    let text: string | undefined;
    let request = '';
    let out = './metadata.json';
    let modelOverride: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--answer' || args[i] === '-a') && i + 1 < args.length) {
            answerPath = args[++i];
        } else if ((args[i] === '--text' || args[i] === '-t') && i + 1 < args.length) {
            text = args[++i];
        } else if ((args[i] === '--request' || args[i] === '-r') && i + 1 < args.length) {
            request = args[++i];
        } else if ((args[i] === '--out' || args[i] === '-o') && i + 1 < args.length) {
            out = args[++i];
        } else if (args[i] === '--model' && i + 1 < args.length) {
            modelOverride = args[++i];
        }
    }

    const inputsProvided = [answerPath, text].filter(v => v !== undefined).length;
    if (inputsProvided === 0) {
        console.error('Error: one of --answer or --text is required.');
        printHelp();
        process.exit(1);
    }
    if (inputsProvided > 1) {
        console.error('Error: provide only one of --answer or --text.');
        process.exit(1);
    }

    let model: string;
    try {
        model = modelOverride || resolveMetadataModel();
    } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : e}`);
        process.exit(1);
    }

    let answer: string;
    if (text) {
        answer = text;
    } else {
        const resolvedAnswerPath = path.resolve(answerPath!);
        if (!fs.existsSync(resolvedAnswerPath)) {
            console.error(`Error: answer file not found: ${resolvedAnswerPath}`);
            process.exit(1);
        }
        answer = fs.readFileSync(resolvedAnswerPath, 'utf8');
    }

    try {
        console.log(`[Metadata Gen] Generating metadata via ${model}...`);
        const metadata = await generateMetadata({ model, request, answer });
        const dir = path.dirname(out);
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(out, JSON.stringify(metadata, null, 2), 'utf8');
        console.log(`[Metadata Gen] Successfully saved metadata to ${out}`);
        console.log(JSON.stringify(metadata, null, 2));
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
