/**
 * cli.ts
 *
 * Command line interface runner for the lecture-agent. Parses arguments,
 * runs the interactive chat session, or resolves single tasks piped via stdin or CLI.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import {
    LectureAgent,
    reset_agent_session,
    run_agent,
    available_skills,
    Color,
    print_detail
} from './coding_agent.js';
import { DEFAULT_WORKSPACE_DIR } from './workspace.js';

function loadConfigEnableGetimgDefault(): boolean {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    while (dir && dir !== path.parse(dir).root) {
        const configPath = path.join(dir, 'config.yaml');
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            let section = "";
            for (const rawLine of content.split(/\r?\n/)) {
                const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
                if (!line.trim() || line.trimStart().startsWith('#')) continue;
                const sectionMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
                if (sectionMatch) {
                    section = sectionMatch[1];
                    continue;
                }
                const fieldMatch = line.match(/^\s+enableGetimgTool:\s*(.*?)\s*$/);
                if (section === "agent" && fieldMatch) {
                    return fieldMatch[1].trim().toLowerCase() === "true";
                }
            }
            return false;
        }
        dir = path.dirname(dir);
    }
    return false;
}

function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

function chat_prompt(): string {
    return `\n${Color.BOLD}${Color.GREEN}You>${Color.RESET} `;
}

async function run_chat(model: string, max_turns: number, skills: string[] | null = null, enableGetimgTool: boolean = false): Promise<void> {
    reset_agent_session();

    // In chat CLI mode, we use the default workspace directory
    const agent = new LectureAgent({
        model,
        workspaceDir: DEFAULT_WORKSPACE_DIR,
        skills,
        maxTurns: max_turns,
        enableGetimgTool
    });

    const session = agent.startChat();
    console.error("Chat mode. Type /exit or /quit to stop.");

    while (true) {
        try {
            const message = (await askQuestion(chat_prompt())).trim();
            if (!message) {
                continue;
            }
            if (message.toLowerCase() === "/exit" || message.toLowerCase() === "/quit") {
                break;
            }
            const response = await session.sendMessage(message);
            console.log(response);
        } catch {
            console.error("");
            break;
        }
    }
}

function parseCommandLineArgs() {
    const args = process.argv.slice(2);
    const defaultEnableGetimgTool = loadConfigEnableGetimgDefault();
    const result = {
        task: [] as string[],
        chat: false,
        skill: [] as string[],
        listSkills: false,
        model: process.env.AGENT_MODEL || "",
        maxTurns: 500,
        enableGetimgTool: defaultEnableGetimgTool,
        newSession: (process.env.AGENT_NEW_SESSION || "").replace(/['"]/g, "").trim().toLowerCase() === "true"
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--chat') {
            result.chat = true;
            i++;
        } else if (arg === '--new-session') {
            result.newSession = true;
            i++;
        } else if (arg === '--list-skills') {
            result.listSkills = true;
            i++;
        } else if (arg === '--getimg' || arg === '--enable-getimg') {
            result.enableGetimgTool = true;
            i++;
        } else if (arg === '--no-getimg' || arg === '--disable-getimg') {
            result.enableGetimgTool = false;
            i++;
        } else if (arg === '--skill') {
            if (i + 1 < args.length) {
                result.skill.push(args[i + 1]);
                i += 2;
            } else {
                throw new Error("Missing value for --skill");
            }
        } else if (arg === '--model') {
            if (i + 1 < args.length) {
                result.model = args[i + 1];
                i += 2;
            } else {
                throw new Error("Missing value for --model");
            }
        } else if (arg === '--max-turns') {
            if (i + 1 < args.length) {
                result.maxTurns = parseInt(args[i + 1], 10);
                i += 2;
            } else {
                throw new Error("Missing value for --max-turns");
            }
        } else if (arg.startsWith('--')) {
            throw new Error(`Unknown argument: ${arg}`);
        } else {
            result.task.push(arg);
            i++;
        }
    }

    if (!result.model && !result.listSkills) {
        throw new Error("AGENT_MODEL environment variable or --model flag must be specified.");
    }

    return result;
}

async function run() {
    let parsed;
    try {
        parsed = parseCommandLineArgs();
    } catch (e: any) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }

    if (parsed.listSkills) {
        for (const skill of available_skills()) {
            console.log(skill);
        }
        process.exit(0);
    }

    if (parsed.newSession) {
        reset_agent_session();
    }

    if (parsed.chat) {
        await run_chat(parsed.model, parsed.maxTurns, parsed.skill, parsed.enableGetimgTool);
        process.exit(0);
    }

    let task = parsed.task.join(" ").trim();
    if (!task) {
        // Read from stdin
        task = fs.readFileSync(0, 'utf8').trim();
        try {
            process.stdin.destroy();
        } catch { }
    }

    if (!task) {
        console.error("Error: provide a task argument or stdin");
        process.exit(1);
    }

    const result = await run_agent(task, parsed.model, parsed.maxTurns, parsed.skill, parsed.enableGetimgTool);
    process.stdout.write(result + '\n', () => {
        setTimeout(() => {
            process.exit(0);
        }, 100);
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const exitWithError = (reason: string, detail: any, exitCode: number) => {
        print_detail(reason, detail, Color.RED);
        process.exit(exitCode);
    };

    process.once('SIGINT', () => process.exit(130));
    process.once('SIGTERM', () => process.exit(143));
    process.once('uncaughtException', (error) => {
        exitWithError("uncaught exception", error?.message || error, 1);
    });
    process.once('unhandledRejection', (reason) => {
        exitWithError("unhandled rejection", reason, 1);
    });

    run();
}
