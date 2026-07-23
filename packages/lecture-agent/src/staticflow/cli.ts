import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { is_upload_supported_path } from '../prompt_builder.js';
import { DEFAULT_WORKSPACE_DIR } from '../workspace.js';
import { StaticFlowAgent } from './index.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function printHelp(): void {
    console.log(`Usage:
  npm run static-flow -- [options] "video request"

Options:
  --model <name>              LLM model (defaults to AGENT_MODEL)
  --workspace <directory>     Parent workspace for a unique generation folder
  --length <value>            Generation length, e.g. 90s, 2:00, 2m (default: 1:00)
  --aspect-ratio <ratio>      Output aspect ratio (default: 16:9)
  --theme <id-or-file>        Theme id from .agents/mylecture-themes or a Markdown file
  --teaching-style <id-or-file> Style id from .agents/mylecture-teaching-style or a Markdown file
  --attachment <file>         Image, PDF, or video input; may be repeated
  --no-getimg                 Forbid image requests and skip the asset fetcher
  --embed-subtitles           Request embedded subtitles
  --help                      Show this help

Example:
  npm run static-flow -- --workspace ./gens --length 2:00 --aspect-ratio 16:9 "Explain binary search"`);
}

function loadResource(value: string, resourceFolder: string): string {
    const direct = path.resolve(value);
    const byId = path.resolve(moduleDir, '..', '..', '.agents', resourceFolder, value.toLowerCase().endsWith('.md') ? value : `${value}.md`);
    const target = fs.existsSync(direct) ? direct : byId;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`Could not find ${resourceFolder} resource: ${value}`);
    }
    return fs.readFileSync(target, 'utf8').trim();
}

export function createGenerationWorkspace(parentWorkspace: string, now = new Date()): { id: string; path: string } {
    const parent = path.resolve(parentWorkspace);
    fs.mkdirSync(parent, { recursive: true });
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestamp = [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
        pad(now.getDate()),
        pad(now.getMonth() + 1),
        now.getFullYear()
    ].join('-');

    for (let attempt = 0; attempt < 20; attempt++) {
        const suffix = randomBytes(4).toString('hex').slice(0, 6);
        const id = `${timestamp}-${suffix}`;
        const generationPath = path.join(parent, id);
        try {
            fs.mkdirSync(generationPath);
            return { id, path: generationPath };
        } catch (error: any) {
            if (error?.code !== 'EEXIST') throw error;
        }
    }
    throw new Error(`Could not allocate a unique generation folder inside ${parent}.`);
}

export function copyAttachmentsToGeneration(attachments: string[], generationPath: string): string[] {
    if (attachments.length === 0) return [];
    const uploadsDir = path.join(generationPath, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const occupied = new Set<string>();
    return attachments.map(source => {
        const extension = path.extname(source);
        const originalStem = path.basename(source, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'attachment';
        let filename = `${originalStem}${extension.toLowerCase()}`;
        let suffix = 2;
        while (occupied.has(filename.toLowerCase()) || fs.existsSync(path.join(uploadsDir, filename))) {
            filename = `${originalStem}-${suffix++}${extension.toLowerCase()}`;
        }
        occupied.add(filename.toLowerCase());
        const destination = path.join(uploadsDir, filename);
        fs.copyFileSync(source, destination);
        return destination;
    });
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    let model = process.env.AGENT_MODEL || '';
    let parentWorkspace = DEFAULT_WORKSPACE_DIR;
    let generationLength = '1:00';
    let aspectRatio = '16:9';
    let theme = '';
    let teachingStyle = '';
    let embedSubtitles = false;
    let enableGetimg = true;
    const attachments: string[] = [];
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
                printHelp();
                return;
            case '--model': model = nextValue(); break;
            case '--workspace': parentWorkspace = path.resolve(nextValue()); break;
            case '--length': generationLength = nextValue(); break;
            case '--aspect-ratio': aspectRatio = nextValue(); break;
            case '--theme': theme = loadResource(nextValue(), 'mylecture-themes'); break;
            case '--teaching-style': teachingStyle = loadResource(nextValue(), 'mylecture-teaching-style'); break;
            case '--attachment': attachments.push(path.resolve(nextValue())); break;
            case '--no-getimg':
            case '--disable-getimg': enableGetimg = false; break;
            case '--embed-subtitles': embedSubtitles = true; break;
            default:
                if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
                taskParts.push(argument);
        }
    }
    if (!model) throw new Error('AGENT_MODEL or --model is required.');
    const request = taskParts.join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
    if (!request) throw new Error('Provide a video request as an argument or through stdin.');
    for (const attachment of attachments) {
        if (!fs.existsSync(attachment) || !fs.statSync(attachment).isFile()) {
            throw new Error(`Attachment not found: ${attachment}`);
        }
        if (!is_upload_supported_path(attachment)) {
            throw new Error(`Unsupported attachment type: ${attachment}`);
        }
    }
    const generation = createGenerationWorkspace(parentWorkspace);
    const copiedAttachments = copyAttachmentsToGeneration(attachments, generation.path);
    const settings = [
        'if the user query is for video generation then follow this:',
        `aspect ratio: ${aspectRatio}`,
        `generation length: ${generationLength}`,
        `embed subtitle in video: ${embedSubtitles ? 'yes' : 'no'}`,
        `getimg enabled: ${enableGetimg ? 'yes' : 'no'}`,
        theme ? `theme: ${theme}` : '',
        teachingStyle ? `teaching style: ${teachingStyle}` : ''
    ].filter(Boolean).join('\n');
    const directives = copiedAttachments.map(attachment => `[(attachment: ${attachment})]`).join('\n');
    const task = [request, settings, directives].filter(Boolean).join('\n\n');

    const agent = new StaticFlowAgent({
        model,
        workspaceDir: generation.path,
        tokenTrackerSessionId: generation.id,
        onLog: text => process.stderr.write(text)
    });
    process.stderr.write(`[static-flow] Generation workspace: ${generation.path}\n`);
    const result = await agent.startChat().sendMessage(task);
    process.stdout.write(`${result}\nGeneration folder: ${generation.path}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
