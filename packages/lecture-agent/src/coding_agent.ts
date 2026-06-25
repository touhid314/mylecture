import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

import { LLM_Model } from './llm_model.js';
import { build_prompt } from './prompt_builder.js';
import {
    BASE_DIR,
    WORKSPACE_DIR,
    ROOT,
    TOOLS,
    TOOL_JSON_SCHEMA,
    archive_agent_workspace,
    build_function_response_payload,
    clear_agent_workspace,
    execute_tool,
    line_count,
} from './tools/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    dotenv.config({ quiet: true });
}
loadEnv();

const PROMPT_PATH = path.join(__dirname, 'prompts', 'system_prompt.md');
const SKILL_DIRS = [
    path.join(ROOT, '.agents', 'skills'),
    path.join(ROOT, '.agents', 'skill'),
    path.join(WORKSPACE_DIR, '.agents', 'skills'),
    path.join(WORKSPACE_DIR, '.agents', 'skill'),
    path.join(BASE_DIR, '.agents', 'skills'),
    path.join(BASE_DIR, '.agents', 'skill'),
];

const DEFAULT_MODEL = "gemini-3.5-flash";
const USE_COLOR = process.stderr.isTTY && !process.env.NO_COLOR;

class Color {
    static RESET = USE_COLOR ? "\x1b[0m" : "";
    static DIM = USE_COLOR ? "\x1b[2m" : "";
    static BOLD = USE_COLOR ? "\x1b[1m" : "";
    static BLUE = USE_COLOR ? "\x1b[34m" : "";
    static CYAN = USE_COLOR ? "\x1b[36m" : "";
    static GREEN = USE_COLOR ? "\x1b[32m" : "";
    static MAGENTA = USE_COLOR ? "\x1b[35m" : "";
    static RED = USE_COLOR ? "\x1b[31m" : "";
    static YELLOW = USE_COLOR ? "\x1b[33m" : "";
}

const DONE_JSON_SCHEMA = {
    note: "brief completion summary for the CLI",
    done: true,
    output: "final response to the user",
};

function load_system_prompt(): string {
    return fs.readFileSync(PROMPT_PATH, 'utf8');
}

export function available_skills(): string[] {
    const names: string[] = [];
    for (const skills_dir of SKILL_DIRS) {
        if (!fs.existsSync(skills_dir)) {
            continue;
        }
        const children = fs.readdirSync(skills_dir);
        for (const childName of children) {
            const childPath = path.join(skills_dir, childName);
            const isDir = fs.statSync(childPath).isDirectory();
            if (isDir && fs.existsSync(path.join(childPath, "SKILL.md"))) {
                names.push(childName);
            } else if (!isDir && childName.toLowerCase().endsWith(".md")) {
                names.push(path.basename(childName, ".md"));
            }
        }
    }
    return Array.from(new Set(names)).sort();
}

function resolve_skill_path(skill: string): string {
    const candidate = path.normalize(skill);
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
        return candidate;
    }

    if (!path.isAbsolute(candidate)) {
        const repo_candidate = path.resolve(BASE_DIR, candidate);
        if (fs.existsSync(repo_candidate) && fs.statSync(repo_candidate).isFile()) {
            return repo_candidate;
        }
        if (fs.existsSync(repo_candidate) && fs.statSync(repo_candidate).isDirectory() && fs.existsSync(path.join(repo_candidate, "SKILL.md"))) {
            return path.join(repo_candidate, "SKILL.md");
        }
    }

    for (const skills_dir of SKILL_DIRS) {
        const direct_dir = path.join(skills_dir, skill);
        const direct_file = path.join(skills_dir, `${skill}.md`);
        if (fs.existsSync(path.join(direct_dir, "SKILL.md"))) {
            return path.join(direct_dir, "SKILL.md");
        }
        if (fs.existsSync(direct_file)) {
            return direct_file;
        }
    }

    const known = available_skills().join(", ") || "none found";
    throw new Error(`skill not found: ${skill}. Available skills: ${known}`);
}

function load_skill(skill: string): string {
    const skillPath = resolve_skill_path(skill);
    const content = fs.readFileSync(skillPath, 'utf8');
    const expanded = build_prompt(content, ROOT);
    const skillName = path.basename(skillPath) === "SKILL.md" ? path.basename(path.dirname(skillPath)) : path.basename(skillPath, ".md");
    return `# Skill: ${skillName}\n\n${expanded}`;
}

function build_skill_context(skills: string[] | null): string {
    if (!skills || skills.length === 0) {
        return "";
    }
    const loaded = skills.map(skill => load_skill(skill));
    return loaded.join("\n\n---\n\n");
}

function build_system_instructions(skills: string[] | null): string {
    const system_prompt = build_prompt(load_system_prompt(), ROOT);
    const skill_context = build_skill_context(skills);
    if (!skill_context) {
        return system_prompt;
    }
    return system_prompt ? (system_prompt + "\n\n# Active Skills\n\n" + skill_context) : ("\n\n# Active Skills\n\n" + skill_context);
}

function prepare_user_task(task: string): string {
    return build_prompt(task, ROOT);
}

function truncate(value: any, limit: number = 1200): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (text.length <= limit) {
        return text;
    }
    return text.substring(0, limit) + `\n... truncated ${text.length - limit} character(s)`;
}

function compact_tool_arguments(argumentsObj: any): any {
    if (!argumentsObj || typeof argumentsObj !== 'object') {
        return argumentsObj;
    }

    function compact_edit_value(value: any): any {
        if (typeof value === 'string') {
            const lines = value.split('\n');
            const first_line = lines.length > 0 ? lines[0] : "";
            return `${first_line.substring(0, 120)} ... [${value.length} characters, ${value.split(/\s+/).filter(Boolean).length} words, ${line_count(value)} lines]`;
        }
        return value;
    }

    const compacted: any = {};
    for (const [key, value] of Object.entries(argumentsObj)) {
        if (["content", "old_text", "new_text"].includes(key) && typeof value === 'string') {
            compacted[key] = compact_edit_value(value);
        } else if (key === "edits" && Array.isArray(value)) {
            compacted[key] = value.map(item => {
                if (item && typeof item === 'object') {
                    const compactedItem: any = {};
                    for (const [item_key, item_value] of Object.entries(item)) {
                        if (["old_text", "new_text"].includes(item_key)) {
                            compactedItem[item_key] = compact_edit_value(item_value);
                        } else {
                            compactedItem[item_key] = item_value;
                        }
                    }
                    return compactedItem;
                }
                return item;
            });
        } else {
            compacted[key] = value;
        }
    }
    return compacted;
}

function compact_tool_result(result: any): any {
    if (typeof result !== 'string') {
        return result;
    }
    if (!result.includes('\n') && result.length <= 240) {
        return result;
    }

    const lines = result.split('\n');
    const first_line = lines.length > 0 ? lines[0] : "";
    return `${first_line.substring(0, 160)} ... [${result.length} characters, ${result.split(/\s+/).filter(Boolean).length} words, ${line_count(result)} lines]`;
}

function print_step(step: number, message: string, color: string = Color.CYAN): void {
    process.stderr.write(`${color}${Color.BOLD}[step {step}]${Color.RESET} ${message}\n`.replace("{step}", String(step)));
}

function print_detail(label: string, value: any, color: string = Color.DIM, limit: number = 1200): void {
    const text = truncate(value, limit);
    process.stderr.write(`${color}${label}:${Color.RESET} ${text}\n`);
}

function chat_prompt(): string {
    return `\n${Color.BOLD}${Color.GREEN}You>${Color.RESET} `;
}

function build_agent_prompt(task: string, transcript: any[]): string {
    return [
        "User task:",
        task,
        "Conversation so far:",
        JSON.stringify(transcript, null, 2),
        "Choose exactly one next step.",
        "Include a short `note` field describing the next visible step.",
        "The `note` must be a concise summary, not hidden chain-of-thought.",
        "To use a tool, return only JSON shaped like:",
        JSON.stringify(TOOL_JSON_SCHEMA, null, 2),
        "When finished, return only JSON shaped like:",
        JSON.stringify(DONE_JSON_SCHEMA, null, 2),
        "Do not wrap the JSON in Markdown.",
    ].join("\n\n");
}

function normalize_model_response(response: any): any {
    if (typeof response === 'object') {
        if (Array.isArray(response) && response.length > 0) {
            return response[0];
        }
        return response;
    }
    if (typeof response === 'string') {
        return JSON.parse(response);
    }
    throw new Error(`unexpected model response type: ${typeof response}`);
}

function cleanSchema(value: any): any {
    if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
            return value.map(cleanSchema);
        }
        const cleaned: any = {};
        for (const [k, v] of Object.entries(value)) {
            if (k === 'additionalProperties') continue;
            if (k === 'type' && typeof v === 'string') {
                cleaned[k] = v.toUpperCase();
            } else {
                cleaned[k] = cleanSchema(v);
            }
        }
        return cleaned;
    }
    return value;
}

function gemini_function_declarations(): any[] {
    const declarations: any[] = [];
    for (const tool of TOOLS) {
        declarations.push({
            name: tool.name,
            description: tool.description,
            parameters: cleanSchema(tool.parameters)
        });
    }
    return declarations;
}

function extract_gemini_function_calls(response: any): any[] {
    if (response.functionCalls && response.functionCalls.length > 0) {
        return response.functionCalls;
    }
    const found: any[] = [];
    if (response.candidates && response.candidates.length > 0) {
        for (const candidate of response.candidates) {
            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    if (part.functionCall) {
                        found.push(part.functionCall);
                    }
                }
            }
        }
    }
    return found;
}

function extract_gemini_text(response: any): string {
    if (response.text) {
        return response.text.trim();
    }
    const chunks: string[] = [];
    if (response.candidates) {
        for (const candidate of response.candidates) {
            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    if (part.text) {
                        chunks.push(part.text);
                    }
                }
            }
        }
    }
    return chunks.join("\n").trim();
}

function numeric_token_count(value: any): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function format_token_totals(inputTokens: number, outputTokens: number): string {
    return `ip=${inputTokens} op=${outputTokens}`;
}

function gemini_output_token_count(usage: any): number | null {
    if (!usage) {
        return null;
    }

    const candidates = numeric_token_count(usage.candidatesTokenCount);
    const thoughts = numeric_token_count(usage.thoughtsTokenCount) || 0;
    if (candidates === null && thoughts === 0) {
        return null;
    }
    return (candidates || 0) + thoughts;
}

function gemini_input_token_count(usage: any): number | null {
    if (!usage) {
        return null;
    }

    const prompt = numeric_token_count(usage.promptTokenCount);
    const toolUsePrompt = numeric_token_count(usage.toolUsePromptTokenCount) || 0;
    if (prompt === null && toolUsePrompt === 0) {
        return null;
    }
    return (prompt || 0) + toolUsePrompt;
}

class GeminiAgentSession {
    private model: string;
    private client: GoogleGenAI;
    private config: any;
    private contents: any[];
    private totalInputTokens: number;
    private totalOutputTokens: number;

    constructor(model: string, skills: string[] | null = null) {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            throw new Error("GOOGLE_API_KEY is not set.");
        }

        this.model = model;
        this.client = new GoogleGenAI({ apiKey });
        this.config = {
            systemInstruction: build_system_instructions(skills),
            tools: [{ functionDeclarations: gemini_function_declarations() }],
            automaticFunctionCalling: { disable: true },
            toolConfig: {
                functionCallingConfig: { mode: "AUTO" }
            }
        };
        this.contents = [];
        this.totalInputTokens = 0;
        this.totalOutputTokens = 0;
        print_detail("workspace", ROOT, Color.BLUE);
        print_detail("tool mode", "native Gemini function calling", Color.BLUE);
        if (skills && skills.length > 0) {
            print_detail("skills", skills, Color.BLUE);
        }
    }

    private record_token_usage(inputTokens: number | null, outputTokens: number | null): void {
        const parts: string[] = [];

        if (inputTokens !== null) {
            this.totalInputTokens += inputTokens;
            parts.push(`input=${inputTokens}`);
        } else {
            parts.push("input=unavailable");
        }

        if (outputTokens !== null) {
            this.totalOutputTokens += outputTokens;
            parts.push(`output=${outputTokens}`);
        } else {
            parts.push("output=unavailable");
        }

        print_detail("tokens", parts.join(" "), Color.DIM);
        print_detail("token totals", format_token_totals(this.totalInputTokens, this.totalOutputTokens), Color.DIM);
    }

    async run(task: string, max_turns: number): Promise<string> {
        const prepared_task = prepare_user_task(task);
        this.contents.push({ role: "user", parts: [{ text: prepared_task }] });

        for (let step = 1; step <= max_turns; step++) {
            print_step(step, "asking model for next action", Color.MAGENTA);
            const response = await this.client.models.generateContent({
                model: this.model,
                contents: this.contents,
                config: this.config
            });
            const usage = response.usageMetadata;
            const input_tokens = gemini_input_token_count(usage);
            const output_tokens = gemini_output_token_count(usage);
            this.record_token_usage(input_tokens, output_tokens);
            const function_calls = extract_gemini_function_calls(response);

            if (function_calls.length === 0) {
                const final_text = extract_gemini_text(response);
                if (response.candidates && response.candidates.length > 0) {
                    this.contents.push(response.candidates[0].content);
                }
                print_step(step, "done", Color.GREEN);
                return final_text || "Done.";
            }

            const model_content = response.candidates?.[0]?.content;
            if (!model_content) {
                print_step(step, "done", Color.GREEN);
                return "Done.";
            }
            this.contents.push(model_content);

            const response_parts: any[] = [];
            for (const call of function_calls) {
                const name = call.name;
                const argumentsObj = call.args || {};
                print_step(step, `running tool \`${name}\``, Color.BLUE);
                print_detail("arguments", compact_tool_arguments(argumentsObj), Color.DIM, 700);

                const result = execute_tool(name, argumentsObj);
                const result_color = result.startsWith("ERROR:") ? Color.RED : Color.GREEN;
                print_detail(`tool:${name} result`, compact_tool_result(result), result_color);

                const payload = build_function_response_payload(name, argumentsObj, result);
                if ("contract_validation" in payload) {
                    const validation_color = payload["contract_validation"].includes("validation passed") ? Color.GREEN : Color.RED;
                    print_detail("contract", payload["contract_validation"], validation_color, 1200);
                }

                response_parts.push({
                    functionResponse: {
                        id: call.id || undefined,
                        name: name,
                        response: payload
                    }
                });
            }

            this.contents.push({ role: "user", parts: response_parts });
        }

        return `Stopped after ${max_turns} tool loop(s). Ask me to continue if needed.`;
    }
}

class JsonFallbackAgentSession {
    private llm: LLM_Model;
    private transcript: any[];
    private model: string;

    constructor(model: string, skills: string[] | null = null) {
        this.model = model;
        this.llm = new LLM_Model(
            model,
            build_system_instructions(skills),
            null,
            true
        );
        this.transcript = [];
        print_detail("workspace", ROOT, Color.BLUE);
        print_detail("tool mode", "JSON fallback", Color.BLUE);
        if (skills && skills.length > 0) {
            print_detail("skills", skills, Color.BLUE);
        }
    }

    async run(task: string, max_turns: number): Promise<string> {
        const prepared_task = prepare_user_task(task);
        this.transcript.push({ role: "user", content: prepared_task });

        for (let step = 1; step <= max_turns; step++) {
            print_step(step, "asking model for next action", Color.MAGENTA);
            const response = await this.llm.generate(
                build_agent_prompt(prepared_task, this.transcript),
                null,
                null,
                null,
                null,
                true,
                false
            );

            if (response === null) {
                print_step(step, "LLM call failed", Color.RED);
                return "The LLM call failed. Check the logs and API key settings.";
            }

            let action: any;
            try {
                action = normalize_model_response(response);
            } catch (exc: any) {
                print_step(step, "model returned invalid JSON; retrying", Color.YELLOW);
                print_detail("raw response", response, Color.YELLOW);
                print_detail("parse error", exc.message || exc, Color.YELLOW);
                this.transcript.push({ model_response: response, error: String(exc) });
                continue;
            }

            this.transcript.push({ model_response: action });
            const note = (action.note || "").trim();
            if (note) {
                print_detail("note", note, Color.CYAN, 500);
            }

            if (action.done === true) {
                print_step(step, "done", Color.GREEN);
                const output = (action.output || "").trim();
                this.transcript.push({ role: "assistant", content: output });
                return output;
            }

            const name = action.tool;
            const argumentsObj = action.arguments || {};
            print_step(step, `running tool \`${name}\``, Color.BLUE);
            print_detail("arguments", compact_tool_arguments(argumentsObj), Color.DIM, 700);

            const result = execute_tool(name, argumentsObj);
            const result_color = result.startsWith("ERROR:") ? Color.RED : Color.GREEN;
            print_detail(`tool:${name} result`, compact_tool_result(result), result_color);

            const payload = build_function_response_payload(name, argumentsObj, result);
            if ("contract_validation" in payload) {
                const validation_color = payload["contract_validation"].includes("validation passed") ? Color.GREEN : Color.RED;
                print_detail("contract", payload["contract_validation"], validation_color, 1200);
            }

            this.transcript.push({
                tool: name,
                arguments: argumentsObj,
                result: payload.result
            });
        }

        return `Stopped after ${max_turns} tool loop(s). Ask me to continue if needed.`;
    }
}

function create_agent_session(model: string, skills: string[] | null = null): any {
    clear_agent_workspace();
    print_detail("workspace cleanup", `cleared ${ROOT}`, Color.DIM);
    if (model.toLowerCase().includes("gemini")) {
        return new GeminiAgentSession(model, skills);
    }
    return new JsonFallbackAgentSession(model, skills);
}

function now_ms(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function format_duration(ms: number): string {
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
}

async function run_session_with_timing(session: any, task: string, max_turns: number): Promise<string> {
    const started_at = now_ms();
    try {
        const result = await session.run(task, max_turns);
        const archivePath = archive_agent_workspace();
        if (archivePath) {
            print_detail("archived workspace", archivePath, Color.GREEN);
        } else {
            print_detail("archived workspace", "skipped; workspace is empty", Color.DIM);
        }
        return result;
    } finally {
        print_detail("run time", format_duration(now_ms() - started_at), Color.DIM);
    }
}

export async function run_agent(task: string, model: string, max_turns: number, skills: string[] | null = null): Promise<string> {
    const session = create_agent_session(model, skills);
    return await run_session_with_timing(session, task, max_turns);
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

async function run_chat(model: string, max_turns: number, skills: string[] | null = null): Promise<void> {
    const session = create_agent_session(model, skills);
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
            console.log(await run_session_with_timing(session, message, max_turns));
        } catch {
            console.error("");
            break;
        }
    }
}

function parseCommandLineArgs() {
    const args = process.argv.slice(2);
    const result = {
        task: [] as string[],
        chat: false,
        skill: [] as string[],
        listSkills: false,
        model: process.env.AGENT_MODEL || "",
        maxTurns: 500
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--chat') {
            result.chat = true;
            i++;
        } else if (arg === '--list-skills') {
            result.listSkills = true;
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

    if (parsed.chat) {
        await run_chat(parsed.model, parsed.maxTurns, parsed.skill);
        process.exit(0);
    }

    let task = parsed.task.join(" ").trim();
    if (!task) {
        // Read from stdin
        task = fs.readFileSync(0, 'utf8').trim();
        try {
            process.stdin.destroy();
        } catch {}
    }

    if (!task) {
        console.error("Error: provide a task argument or stdin");
        process.exit(1);
    }

    const result = await run_agent(task, parsed.model, parsed.maxTurns, parsed.skill);
    process.stdout.write(result + '\n', () => {
        setTimeout(() => {
            process.exit(0);
        }, 100);
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run();
}
