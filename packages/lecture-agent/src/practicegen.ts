/**
 * practicegen.ts
 *
 * Coursegen / batch practice creation via the static IAGen / GameGen pipelines.
 * Writes to activities/interactive/index.html or activities/game/index.html.
 * EditorAgent remains index-root edit-only and is not used for practice creation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGameGen } from './gamegen.js';
import { runIAGen } from './iagen.js';
import { resolveLectureGenStageModels } from './stage_models.js';


export type PracticeKind = 'interactive' | 'game';

export const DEFAULT_INTERACTIVE_REL = 'activities/interactive/index.html';
export const DEFAULT_GAME_REL = 'activities/game/index.html';

export type PracticeGenOptions = {
    kind: PracticeKind;
    request: string;
    model: string;
    /** Override for IAGen/GameGen; defaults to ANIMATOR_MODEL then `model`. */
    animatorModel?: string;
    workspaceDir: string;
    outputRelPath?: string;
    aspectRatio?: string;
    referenceMaterial?: string;
    tokenTrackerSessionId?: string | null;
    skipValidation?: boolean;
    onLog?: (text: string) => void;
};

export type PracticeGenResult = {
    kind: PracticeKind;
    outputRelPath: string;
    outputPath: string;
    html: string;
    validation?: string;
};

export function defaultPracticeRelPath(kind: PracticeKind): string {
    return kind === 'game' ? DEFAULT_GAME_REL : DEFAULT_INTERACTIVE_REL;
}

export async function generatePracticePage(options: PracticeGenOptions): Promise<PracticeGenResult> {
    const request = options.request.trim();
    if (!request) throw new Error('A practice generation request is required.');
    if (!options.model.trim()) throw new Error('A model is required.');

    const workspaceDir = path.resolve(options.workspaceDir);
    const outputRelPath = (options.outputRelPath || defaultPracticeRelPath(options.kind))
        .replaceAll('\\', '/')
        .replace(/^\.\//, '');
    if (outputRelPath.includes('..') || path.isAbsolute(outputRelPath)) {
        throw new Error(`Unsafe practice output path: ${outputRelPath}`);
    }

    const aspectRatio = options.aspectRatio || '16:9';
    const log = (message: string) => options.onLog?.(`[practicegen] ${message}\n`);
    const stages = resolveLectureGenStageModels({
        model: options.model,
        animatorModel: options.animatorModel
    });
    log(`Using model ${stages.animatorModel} for ${options.kind} (fallback default: ${stages.defaultModel}).`);
    const common = {
        model: stages.animatorModel,
        tokenTrackerSessionId: options.tokenTrackerSessionId,
        promptWorkspaceDir: workspaceDir,
        outputPath: outputRelPath
    };

    log(`Generating ${options.kind} → ${outputRelPath}...`);
    const html = options.kind === 'game'
        ? await runGameGen({
            ...common,
            request,
            aspectRatio,
            referenceMaterial: options.referenceMaterial
        })
        : await runIAGen({
            ...common,
            request,
            aspectRatio,
            referenceMaterial: options.referenceMaterial
        });

    const outputPath = path.join(workspaceDir, outputRelPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf8');
    log(`Wrote ${outputRelPath} (${html.length} chars).`);

    let validation: string | undefined;

    return {
        kind: options.kind,
        outputRelPath,
        outputPath,
        html,
        validation
    };
}

function printPracticeGenHelp(): void {
    console.log(`Usage:
  npm run practicegen -- --kind interactive|game --workspace-dir <dir> [options]

Options:
  --kind <interactive|game>   Practice kind (required)
  --model <name>              Default/fallback LLM model (defaults to AGENT_MODEL)
  --animator-model <name>     Model for IAGen/GameGen (defaults to ANIMATOR_MODEL, then --model)
  --workspace-dir <directory> Exact lecture workspace folder (required)
  --output <rel-path>         Output path under workspace (default activities/.../index.html)
  --aspect-ratio <ratio>      Aspect ratio hint (default: 16:9)
  --reference <file>          Optional reference material file
  --skip-validation           Skip practice page readability validation
  --help                      Show this help

Request text is read from stdin (or trailing argv).`);
}

export async function runPracticeGenCli(args = process.argv.slice(2)): Promise<void> {
    let kind: PracticeKind | '' = '';
    let model = process.env.AGENT_MODEL || '';
    let animatorModel = '';
    let workspaceDir = '';
    let outputRelPath = '';
    let aspectRatio = '16:9';
    let referencePath = '';
    let skipValidation = false;
    const taskParts: string[] = [];

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const nextValue = () => {
            const value = args[++index];
            if (!value) throw new Error(`Missing value for ${argument}.`);
            return value;
        };
        switch (argument) {
            case '--help':
            case '-h':
                printPracticeGenHelp();
                return;
            case '--kind': {
                const value = nextValue();
                if (value !== 'interactive' && value !== 'game') {
                    throw new Error('--kind must be interactive or game.');
                }
                kind = value;
                break;
            }
            case '--model': model = nextValue(); break;
            case '--animator-model': animatorModel = nextValue(); break;
            case '--workspace-dir': workspaceDir = path.resolve(nextValue()); break;
            case '--output': outputRelPath = nextValue(); break;
            case '--aspect-ratio': aspectRatio = nextValue(); break;
            case '--reference': referencePath = path.resolve(nextValue()); break;
            case '--skip-validation': skipValidation = true; break;
            default:
                if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
                taskParts.push(argument);
        }
    }

    if (!kind) throw new Error('--kind interactive|game is required.');
    if (!model) throw new Error('AGENT_MODEL or --model is required.');
    if (!workspaceDir) throw new Error('--workspace-dir is required.');

    const request = taskParts.join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
    if (!request) throw new Error('Provide a practice request as an argument or through stdin.');

    let referenceMaterial: string | undefined;
    if (referencePath) {
        referenceMaterial = fs.readFileSync(referencePath, 'utf8');
    }

    const result = await generatePracticePage({
        kind,
        request,
        model,
        animatorModel: animatorModel || undefined,
        workspaceDir,
        outputRelPath: outputRelPath || undefined,
        aspectRatio,
        referenceMaterial,
        skipValidation,
        onLog: text => process.stderr.write(text)
    });
    process.stdout.write(`Practice written: ${result.outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runPracticeGenCli().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
