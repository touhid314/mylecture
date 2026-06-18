import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

import { LLM_Model } from './llm_model.js';
import { build_prompt } from './prompt_builder.js';

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

const BASE_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(process.env.AGENT_WORKSPACE || path.join(BASE_DIR, 'workspace'));
if (!fs.existsSync(ROOT)) {
    fs.mkdirSync(ROOT, { recursive: true });
}

const PROMPT_PATH = path.join(BASE_DIR, 'system_prompt.md');
const SKILL_DIRS = [
    path.join(ROOT, '.agents', 'skills'),
    path.join(ROOT, '.agents', 'skill'),
    path.join(BASE_DIR, '.agents', 'skills'),
    path.join(BASE_DIR, '.agents', 'skill'),
];

const CONTRACT_VALIDATOR_JS = path.join(__dirname, 'validate_contract.cjs');

const DEFAULT_MODEL = "gemini-3.5-flash";
const USE_COLOR = process.stderr.isTTY && !process.env.NO_COLOR;
const TRUNCATED_AUTO_READ = "truncated auto read result for context minimization, check the latest read";

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

const TOOLS: any[] = [
    {
        type: "function",
        name: "read",
        description: "Read a UTF-8 text file from the workspace.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative file path." }
            },
            required: ["path"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "write",
        description: "Write a complete UTF-8 text file in the workspace.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative file path." },
                content: { type: "string", description: "Complete file content." },
            },
            required: ["path", "content"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "edits",
        description: "Edit an existing file by applying one or more exact replacements atomically in one tool call. Use this for all changes to existing files, including single-location edits and multiple distant edits.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative file path." },
                edits: {
                    type: "array",
                    description: "Batch of independent exact replacements to apply atomically to the same file. Use this for edits at multiple distant locations, such as one change near line 5, another near line 60, and another near line 567.",
                    items: {
                        type: "object",
                        properties: {
                            old_text: {
                                type: "string",
                                description: "Exact text block to replace. Include enough surrounding context copied from the latest read or auto_read to make it unique. If exact matching fails, the tool can use a unique whitespace-normalized match as a fallback.",
                            },
                            new_text: {
                                type: "string",
                                description: "Replacement text block.",
                            },
                            expected_replacements: {
                                type: "integer",
                                description: "Expected number of replacements for this edit. Defaults to 1.",
                                minimum: 1,
                            },
                        },
                        required: ["old_text", "new_text"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["path", "edits"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "cmd",
        description: "Run a shell command in the workspace.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Command to run." },
                timeout_seconds: {
                    type: "integer",
                    description: "Timeout in seconds. Defaults to 30.",
                    minimum: 1,
                    maximum: 300,
                },
            },
            required: ["command"],
            additionalProperties: false,
        },
    },
];

const TOOL_JSON_SCHEMA = {
    note: "brief step summary for the CLI; do not include hidden chain-of-thought",
    tool: "read | write | edits | cmd",
    arguments: {
        path: "workspace-relative path for read/write/edits",
        content: "complete file content for write",
        edits: [
            {
                old_text: "exact block to replace for one edit",
                new_text: "replacement block for that edit",
                expected_replacements: "optional integer for this edit",
            }
        ],
        command: "shell command for cmd",
        timeout_seconds: "optional integer for cmd",
    },
};

const DONE_JSON_SCHEMA = {
    note: "brief completion summary for the CLI",
    done: true,
    output: "final response to the user",
};

function resolve_workspace_path(filePath: string): string {
    const target = path.resolve(ROOT, filePath);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        throw new Error(`path escapes workspace: ${filePath}`);
    }
    return target;
}

function tool_read(filePath: string): string {
    const target = resolve_workspace_path(filePath);
    return fs.readFileSync(target, 'utf8');
}

function text_stats(content: string) {
    return {
        characters: content.length,
        words: content.trim().split(/\s+/).filter(Boolean).length,
        lines: content.split('\n').length
    };
}

function line_count(content: string): number {
    return content.split('\n').length;
}

function format_file_stats(prefix: string, filePath: string, content: string): string {
    const stats = text_stats(content);
    return `${prefix} for ${filePath}; file now contains ${stats.characters} characters exactly, ${stats.words} words exactly, and ${stats.lines} lines exactly`;
}

function build_auto_read(filePath: string): any {
    const content = tool_read(filePath);
    const stats = text_stats(content);
    return {
        path: filePath,
        characters: stats.characters,
        words: stats.words,
        lines: stats.lines,
        content: content,
    };
}

function tool_supports_auto_read(name: string, argumentsObj: any): boolean {
    return (
        ["write", "edits"].includes(name) &&
        argumentsObj &&
        typeof argumentsObj === 'object' &&
        typeof argumentsObj.path === 'string'
    );
}

function should_validate_contract(name: string, argumentsObj: any): boolean {
    if (!["write", "edits"].includes(name) || !argumentsObj || typeof argumentsObj !== 'object') {
        return false;
    }
    const filePath = argumentsObj.path;
    if (typeof filePath !== 'string') {
        return false;
    }

    const filename = path.basename(filePath).toLowerCase();
    if (!filename.startsWith("index") || !filename.endsWith(".html")) {
        return false;
    }

    const suffix = filename.substring(5, filename.length - 5); // index[1,2...].html
    return suffix === "" || /^\d+$/.test(suffix);
}

const PROTECTED_HTML_BLOCK_PATTERN = /(<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>)/gi;
const HTML_TAG_PATTERN = /<[^<>]*>/g;

function purify_html_markup_escapes(content: string): [string, number] {
    let replacement_count = 0;

    function purify_tag(tag: string): string {
        const matches = tag.match(/\\"/g);
        if (matches) {
            replacement_count += matches.length;
        }
        return tag.replace(/\\"/g, '"');
    }

    const parts = content.split(PROTECTED_HTML_BLOCK_PATTERN);
    const purified_parts: string[] = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i % 2 === 1) {
            purified_parts.push(part);
        } else {
            purified_parts.push(part.replace(HTML_TAG_PATTERN, purify_tag));
        }
    }

    return [purified_parts.join(""), replacement_count];
}

function purify_content_for_path(filePath: string, content: string): [string, number] {
    if (path.extname(filePath).toLowerCase() !== ".html") {
        return [content, 0];
    }
    return purify_html_markup_escapes(content);
}

function validate_index_html_contract(filePath: string): string {
    const target = resolve_workspace_path(filePath);
    if (!fs.existsSync(CONTRACT_VALIDATOR_JS)) {
        return `HTML contract validation skipped: validator not found at ${CONTRACT_VALIDATOR_JS}`;
    }

    let content: string;
    try {
        content = fs.readFileSync(target, 'utf8');
    } catch (exc: any) {
        return `HTML contract validation failed for ${filePath}: could not read file: ${exc.message || exc}`;
    }

    const [, escaped_markup_count] = purify_html_markup_escapes(content);
    if (escaped_markup_count > 0) {
        return `HTML contract validation failed for ${filePath}: found ${escaped_markup_count} literal escaped quote(s) in HTML markup. Use normal attributes like id="stage", not id=\\"stage\\".`;
    }

    try {
        const completed = spawnSync('node', [CONTRACT_VALIDATOR_JS, target], {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 10000
        });

        const stdout = (completed.stdout || "").trim();
        const stderr = (completed.stderr || "").trim();
        const combined = [stderr, stdout].filter(Boolean).join('\n').trim();

        if (completed.status === 0) {
            return `HTML contract validation passed for ${filePath}: ${stdout || 'OK'}`;
        }
        return `HTML contract validation failed for ${filePath} (exit ${completed.status}): ${combined || 'unknown validation error'}`;
    } catch (exc: any) {
        return `HTML contract validation skipped: ${exc.name || 'Error'}: ${exc.message || exc}`;
    }
}

function tool_write(filePath: string, content: string): string {
    const target = resolve_workspace_path(filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const [purifiedContent, purifiedCount] = purify_content_for_path(filePath, content);
    fs.writeFileSync(target, purifiedContent, 'utf8');
    const stats = text_stats(purifiedContent);
    const purified_note = purifiedCount ? `; purified ${purifiedCount} escaped quote(s) in HTML markup` : "";
    return `write succeeded for ${filePath}; wrote ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines${purified_note}; file now contains ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines`;
}

function normalized_text_with_map(text: string): [string, number[]] {
    const normalized_chars: string[] = [];
    const original_indexes: number[] = [];
    let in_whitespace = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (/\s/.test(char)) {
            if (!in_whitespace) {
                normalized_chars.push(" ");
                original_indexes.push(index);
                in_whitespace = true;
            }
            continue;
        }

        normalized_chars.push(char);
        original_indexes.push(index);
        in_whitespace = false;
    }

    let start = 0;
    let end = normalized_chars.length;
    while (start < end && normalized_chars[start] === " ") {
        start++;
    }
    while (end > start && normalized_chars[end - 1] === " ") {
        end--;
    }

    return [
        normalized_chars.slice(start, end).join(""),
        original_indexes.slice(start, end)
    ];
}

function find_text_spans(content: string, old_text: string): [[number, number][], string] {
    const exact_spans: [number, number][] = [];
    let search_from = 0;
    while (true) {
        const start = content.indexOf(old_text, search_from);
        if (start === -1) {
            break;
        }
        exact_spans.push([start, start + old_text.length]);
        search_from = start + old_text.length;
    }

    if (exact_spans.length > 0) {
        return [exact_spans, "exact"];
    }

    const [normalized_content, content_map] = normalized_text_with_map(content);
    const [normalized_old] = normalized_text_with_map(old_text);
    if (!normalized_old) {
        return [[], "exact"];
    }

    const normalized_spans: [number, number][] = [];
    search_from = 0;
    while (true) {
        const normalized_start = normalized_content.indexOf(normalized_old, search_from);
        if (normalized_start === -1) {
            break;
        }
        const normalized_end = normalized_start + normalized_old.length - 1;
        const original_start = content_map[normalized_start];
        const original_end = content_map[normalized_end] + 1;
        normalized_spans.push([original_start, original_end]);
        search_from = normalized_start + normalized_old.length;
    }

    return [normalized_spans, "whitespace-normalized"];
}

function tool_edits(filePath: string, edits: any[]): string {
    const target = resolve_workspace_path(filePath);
    let content = fs.readFileSync(target, 'utf8');

    if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error("edits must be a non-empty array");
    }

    const replacements: any[] = [];
    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        if (!edit || typeof edit !== 'object') {
            throw new Error(`edit ${index + 1} must be an object`);
        }

        const edit_old = edit.old_text;
        const edit_new = edit.new_text;
        const edit_expected = parseInt(edit.expected_replacements || "1", 10);

        if (typeof edit_old !== 'string' || typeof edit_new !== 'string') {
            throw new Error(`edit ${index + 1} must include string old_text and new_text`);
        }
        if (edit_old === "") {
            throw new Error(`edit ${index + 1} old_text must not be empty`);
        }
        if (isNaN(edit_expected) || edit_expected < 1) {
            throw new Error(`edit ${index + 1} expected_replacements must be at least 1`);
        }

        const [spans, match_type] = find_text_spans(content, edit_old);

        if (spans.length !== edit_expected) {
            throw new Error(`edit ${index + 1} expected ${edit_expected} replacement(s), found ${spans.length} using ${match_type} matching; edit not applied`);
        }

        for (const [start, end] of spans) {
            replacements.push({
                edit_index: index + 1,
                start,
                end,
                old_text: content.substring(start, end),
                new_text: edit_new,
                match_type
            });
        }
    }

    replacements.sort((a, b) => a.start - b.start);
    for (let i = 0; i < replacements.length - 1; i++) {
        const previous = replacements[i];
        const current = replacements[i + 1];
        if (current.start < previous.end) {
            throw new Error(`edits overlap in the original file; edit not applied (edit ${previous.edit_index} overlaps edit ${current.edit_index})`);
        }
    }

    const pieces: string[] = [];
    let cursor = 0;
    for (const replacement of replacements) {
        pieces.push(content.substring(cursor, replacement.start));
        pieces.push(replacement.new_text);
        cursor = replacement.end;
    }
    pieces.push(content.substring(cursor));
    let updated = pieces.join("");
    const [purifiedUpdated, purifiedCount] = purify_content_for_path(filePath, updated);
    updated = purifiedUpdated;

    fs.writeFileSync(target, updated, 'utf8');

    const old_chars = replacements.reduce((sum, r) => sum + r.old_text.length, 0);
    const new_chars = replacements.reduce((sum, r) => sum + r.new_text.length, 0);
    const delta = updated.length - content.length;
    const stats = text_stats(updated);
    const normalized_count = replacements.filter(r => r.match_type === "whitespace-normalized").length;

    const normalized_note = normalized_count ? `; used whitespace-normalized matching for ${normalized_count} replacement(s)` : "";
    const purified_note = purifiedCount ? `; purified ${purifiedCount} escaped quote(s) in HTML markup` : "";

    return `edits succeeded for ${filePath}; applied ${edits.length} edit operation(s), replaced ${old_chars} characters with ${new_chars} characters across ${replacements.length} replacement(s); net change ${delta >= 0 ? '+' : ''}${delta} characters${normalized_note}${purified_note}; file now contains ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines`;
}

function tool_cmd(command: string, timeout_seconds: number = 30): string {
    const lowered_command = command.toLowerCase().trim();
    const blocked_python_patterns = [
        "python -c",
        "python3 -c",
        "py -c",
    ];
    if (blocked_python_patterns.some(pattern => lowered_command.includes(pattern))) {
        return "ERROR: Python one-liners are blocked in cmd. Use the read tool for file inspection, write/edits for file changes, and cmd only for ordinary project commands such as tests, builds, installs, or running existing scripts.";
    }

    try {
        const completed = spawnSync(command, {
            cwd: ROOT,
            shell: true,
            encoding: 'utf8',
            timeout: timeout_seconds * 1000
        });
        return JSON.stringify({
            returncode: completed.status ?? -1,
            stdout: (completed.stdout || "").slice(-12000),
            stderr: (completed.stderr || "").slice(-12000),
        });
    } catch (e: any) {
        return JSON.stringify({
            returncode: -1,
            stdout: "",
            stderr: e.message || String(e)
        });
    }
}

const TOOL_HANDLERS: Record<string, Function> = {
    "read": tool_read,
    "write": tool_write,
    "edits": tool_edits,
    "cmd": tool_cmd,
};

function execute_tool(name: string, argumentsObj: any): string {
    if (!(name in TOOL_HANDLERS)) {
        return `ERROR: unknown tool ${name}`;
    }
    try {
        const cleanedArgs: any = {};
        const allowedParams = name === "read" ? ["path"] :
                            name === "write" ? ["path", "content"] :
                            name === "edits" ? ["path", "edits"] :
                            name === "cmd" ? ["command", "timeout_seconds"] : [];
        for (const k of allowedParams) {
            if (k in argumentsObj) {
                cleanedArgs[k] = argumentsObj[k];
            }
        }
        return TOOL_HANDLERS[name](cleanedArgs.path || cleanedArgs.command, cleanedArgs.content || cleanedArgs.edits || cleanedArgs.timeout_seconds);
    } catch (exc: any) {
        return `ERROR: ${exc.name || 'Error'}: ${exc.message || exc}`;
    }
}

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

function compact_previous_auto_reads(contents: any[]): void {
    for (const content of contents) {
        if (content && content.parts) {
            for (const part of content.parts) {
                const function_response = part.functionResponse;
                const response = function_response?.response;
                if (response && typeof response === 'object' && "auto_read" in response) {
                    response["auto_read"] = TRUNCATED_AUTO_READ;
                }
            }
        }
    }
}

function build_function_response_payload(name: string, argumentsObj: any, result: string): any {
    const payload: any = { result };
    if (!result.startsWith("ERROR:") && should_validate_contract(name, argumentsObj)) {
        const validation = validate_index_html_contract(argumentsObj.path);
        payload["contract_validation"] = validation;
        payload["result"] = `${payload["result"]}\n${validation}`;
    }

    if (result.startsWith("ERROR:") || !tool_supports_auto_read(name, argumentsObj)) {
        return payload;
    }

    try {
        payload["auto_read"] = build_auto_read(argumentsObj.path);
    } catch (exc: any) {
        payload["auto_read"] = `auto read failed: ${exc.name || 'Error'}: ${exc.message || exc}`;
    }
    return payload;
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

class GeminiAgentSession {
    private model: string;
    private client: GoogleGenAI;
    private config: any;
    private contents: any[];

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
        print_detail("workspace", ROOT, Color.BLUE);
        print_detail("tool mode", "native Gemini function calling", Color.BLUE);
        if (skills && skills.length > 0) {
            print_detail("skills", skills, Color.BLUE);
        }
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
            const usage = response.usageMetadata ?? response.usage_metadata;
            if (usage) {
                const input = usage.promptTokenCount ?? usage.prompt_token_count;
                const output = usage.candidatesTokenCount ?? usage.candidates_token_count;
                const total = usage.totalTokenCount ?? usage.total_token_count;
                const parts: string[] = [];
                if (input !== undefined && input !== null) parts.push(`input=${input}`);
                if (output !== undefined && output !== null) parts.push(`output=${output}`);
                if (total !== undefined && total !== null) parts.push(`total=${total}`);
                if (parts.length > 0) {
                    print_detail("tokens", parts.join(" "), Color.DIM);
                }
            }
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
                if ("auto_read" in payload) {
                    compact_previous_auto_reads(this.contents);
                    const auto_read = payload["auto_read"];
                    if (auto_read && typeof auto_read === 'object') {
                        print_detail("auto-read", {
                            path: auto_read.path,
                            characters: auto_read.characters,
                            words: auto_read.words,
                            lines: auto_read.lines
                        }, Color.CYAN, 500);
                    }
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
            if ("auto_read" in payload) {
                for (const item of this.transcript) {
                    if (item && typeof item === 'object' && "auto_read" in item) {
                        item["auto_read"] = TRUNCATED_AUTO_READ;
                    }
                }
                const auto_read = payload["auto_read"];
                if (auto_read && typeof auto_read === 'object') {
                    print_detail("auto-read", {
                        path: auto_read.path,
                        characters: auto_read.characters,
                        words: auto_read.words,
                        lines: auto_read.lines
                    }, Color.CYAN, 500);
                }
            }

            this.transcript.push({
                tool: name,
                arguments: argumentsObj,
                result: payload.result,
                ...("auto_read" in payload ? { auto_read: payload.auto_read } : {})
            });
        }

        return `Stopped after ${max_turns} tool loop(s). Ask me to continue if needed.`;
    }
}

function create_agent_session(model: string, skills: string[] | null = null): any {
    if (model.toLowerCase().includes("gemini")) {
        return new GeminiAgentSession(model, skills);
    }
    return new JsonFallbackAgentSession(model, skills);
}

export async function run_agent(task: string, model: string, max_turns: number, skills: string[] | null = null): Promise<string> {
    const session = create_agent_session(model, skills);
    return await session.run(task, max_turns);
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
            console.log(await session.run(message, max_turns));
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
