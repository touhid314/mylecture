/**
 * tool_registry.ts
 *
 * Single source of truth for tool metadata, active exposure, execution, and
 * history compaction. A tool whose `active` flag is false is not included in
 * model schemas, prompt tool listings, or JSON fallback examples.
 */
import { tool_read, compact_read } from './read.js';
import { tool_write, compact_write } from './write.js';
import { tool_edits, compact_edits } from './edits.js';
import { tool_cmd, compact_cmd } from './cmd.js';
import { tool_mkdir, compact_mkdir } from './mkdir.js';
import { tool_list_dir, compact_list_dir } from './list_dir.js';
import { tool_del, compact_del } from './del.js';
import { should_validate_contract, validate_index_html_contract } from './utils/html_contract.js';
export { line_count } from './utils/text_stats.js';
import { DEFAULT_WORKSPACE_DIR } from '../workspace.js';

// Tool implementations stay in their own files. This registry is the only place
// that decides whether those implementations are visible to the model.
export type ToolCompaction = {
    compactedArgs: any;
    compactedResult: string;
};

// Every tool must have one entry here. The schema fields are used by Gemini
// native function calling, the JSON fallback prompt, and the generated
// "# Available tools:" section in the system prompt.
export type ToolRegistryEntry = {
    type: "function";
    name: string;
    description: string;
    // Set active to false to keep a tool implemented but completely hidden from
    // the agent. Inactive tools are excluded from schemas, prompt text, and
    // normal runtime dispatch.
    active: boolean;
    parameters: any;
    // Adapter from model arguments to the concrete tool function. Keep argument
    // reshaping here so adding a tool does not require a second dispatcher file.
    execute: (argumentsObj: any, workspaceDir: string) => string;
    // Compaction prevents large file contents, command output, or edit payloads
    // from being repeatedly kept in model history.
    compact: (argumentsObj: any, result: string) => ToolCompaction;
};

// Add new tools here. A registry entry should include:
// 1. The active flag.
// 2. The model-facing description.
// 3. The JSON schema for arguments.
// 4. The execute adapter.
// 5. The history compactor.
export const TOOL_REGISTRY: ToolRegistryEntry[] = [
    {
        type: "function",
        name: "read",
        active: true,
        description: "Read a UTF-8 text file from the workspace. The output contains line numbers prepended in the format `<line_number>: <line_content>` for reference. These line numbers are not present in the actual file.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative file path." }
            },
            required: ["path"],
            additionalProperties: false,
        },
        execute: (args, workspaceDir) => tool_read(args.path, workspaceDir),
        compact: compact_read,
    },
    {
        type: "function",
        name: "write",
        active: true,
        description: "Write a complete UTF-8 text file in the workspace. Use this only to create a file; after a file exists, use `edits` for updates.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative file path." },
                content: { type: "string", description: "Complete file content." },
            },
            required: ["path", "content"],
            additionalProperties: false,
        },
        execute: (args, workspaceDir) => tool_write(args.path, args.content, workspaceDir),
        compact: compact_write,
    },
    {
        type: "function",
        name: "edits",
        active: true,
        description: "Apply one or more line-based diff patches to an existing file atomically. Line numbers are 1-indexed and refer to the original file state before any edits are applied.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative file path." },
                edits: {
                    type: "array",
                    description: "List of edits to apply atomically to the file.",
                    items: {
                        type: "object",
                        properties: {
                            start_line: {
                                type: "integer",
                                description: "1-indexed starting line number of the edit in the original file.",
                                minimum: 1
                            },
                            remove_lines: {
                                type: "integer",
                                description: "Number of lines to remove from the original file starting from start_line.",
                                minimum: 0
                            },
                            new_text: {
                                type: "string",
                                description: "Text to insert at start_line. Use an empty string to delete without inserting."
                            },
                            old_text: {
                                type: "string",
                                description: "Optional safety check: exact text expected in the removed range before the edit is applied."
                            }
                        },
                        required: ["start_line", "remove_lines", "new_text"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["path", "edits"],
            additionalProperties: false,
        },
        execute: (args, workspaceDir) => tool_edits(args.path, args.edits, workspaceDir),
        compact: compact_edits,
    },
    {
        type: "function",
        name: "cmd",
        active: false,
        description: "Run a shell command. This tool is intentionally inactive for normal agent behavior.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Command to run." },
            },
            required: ["command"],
            additionalProperties: false,
        },
        execute: (args, workspaceDir) => tool_cmd(args.command, args.timeout_seconds, workspaceDir),
        compact: compact_cmd,
    },
    {
        type: "function",
        name: "mkdir",
        active: true,
        description: "Create a new directory in the workspace, recursively by default.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative directory path." }
            },
            required: ["path"],
            additionalProperties: false,
        },
        execute: (args, workspaceDir) => tool_mkdir(args.path, workspaceDir),
        compact: compact_mkdir,
    },
    {
        type: "function",
        name: "list_dir",
        active: true,
        description: "List the contents of a directory in the workspace, indicating files and folders.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative directory path. Defaults to root if omitted." }
            },
            required: [],
            additionalProperties: false,
        },
        execute: (args, workspaceDir) => tool_list_dir(args.path, workspaceDir),
        compact: compact_list_dir,
    },
    {
        type: "function",
        name: "del",
        active: true,
        description: "Delete one or more files or directories in the workspace. The workspace root cannot be deleted.",
        parameters: {
            type: "object",
            properties: {
                paths: {
                    type: "array",
                    description: "List of workspace-relative files or directories to delete.",
                    items: { type: "string" }
                }
            },
            required: ["paths"],
            additionalProperties: false,
        },
        execute: (args, workspaceDir) => tool_del(args.paths, workspaceDir),
        compact: compact_del,
    },
];

// Active tools are the only tools exposed to the model. Use this helper instead
// of filtering TOOL_REGISTRY at call sites so inactive behavior stays uniform.
export function active_tools(): ToolRegistryEntry[] {
    return TOOL_REGISTRY.filter(tool => tool.active);
}

export function active_tool_names(): string[] {
    return active_tools().map(tool => tool.name);
}

export function get_active_tool(name: string): ToolRegistryEntry | undefined {
    return active_tools().find(tool => tool.name === name);
}

// The system prompt keeps a marker for the tool section. coding_agent.ts replaces
// that marker with this generated block so prompt text and schemas cannot drift.
export function render_available_tools_section(): string {
    const lines = active_tools().map(tool => `- \`${tool.name}\`: ${tool.description}`);
    return ["# Available tools:", "", ...lines].join("\n");
}

// Gemini function declarations are built from this derived list. Do not add tools
// directly to the model config; change TOOL_REGISTRY instead.
export const TOOLS: any[] = active_tools().map(tool => ({
    type: tool.type,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
}));

// The JSON fallback path cannot use native function declarations, so it receives
// this compact shape in the prompt. The allowed tool names are generated from the
// same active registry entries.
export const TOOL_JSON_SCHEMA = {
    note: "brief step summary for the CLI; do not include hidden chain-of-thought",
    tool: active_tool_names().join(" | "),
    arguments: {
        path: "workspace-relative path for read/write/edits/mkdir/list_dir",
        paths: "array of workspace-relative paths to delete for del",
        content: "complete file content for write",
        edits: [
            {
                start_line: "1-indexed starting line number of the edit in the original file",
                remove_lines: "number of lines to remove (0 for pure insertion)",
                new_text: "text to insert",
                old_text: "optional exact text expected in the removed range before applying the edit",
            }
        ],
    },
};

// Public runtime entrypoint for tool execution. It normalizes bad argument
// payloads and converts implementation exceptions into model-readable errors.
export function execute_tool(name: string, argumentsObj: any, workspaceDir: string = DEFAULT_WORKSPACE_DIR): string {
    if (!argumentsObj || typeof argumentsObj !== 'object') {
        argumentsObj = {};
    }

    try {
        return execute_registered_tool(name, argumentsObj, workspaceDir);
    } catch (exc: any) {
        return `ERROR: ${exc.name || 'Error'}: ${exc.message || exc}`;
    }
}

// Write/edit operations for index*.html run through the lecture HTML contract
// validator after the tool succeeds. Keeping this here makes validation part of
// the tool runtime instead of a concern for the agent loop.
export function build_function_response_payload(name: string, argumentsObj: any, result: string, workspaceDir: string = DEFAULT_WORKSPACE_DIR): any {
    const payload: any = { result };
    if (!result.startsWith("ERROR:") && should_validate_contract(name, argumentsObj)) {
        const validation = validate_index_html_contract(argumentsObj.path, workspaceDir);
        payload["contract_validation"] = validation;
        payload["result"] = `${payload["result"]}\n${validation}`;
    }

    return payload;
}

// Public compaction entrypoint used after each turn. Unknown tools fall back to
// leaving their arguments/results unchanged, which keeps older history readable.
export function compact_tool_history(name: string, args: any, result: string): ToolCompaction {
    if (!args || typeof args !== 'object') {
        args = {};
    }

    try {
        return compact_registered_tool_history(name, args, result);
    } catch {}
    return { compactedArgs: args, compactedResult: result };
}

// Internal dispatch enforces active status. If a tool is inactive, the model
// cannot normally call it, and a forged/old call still receives "unknown tool".
function execute_registered_tool(name: string, argumentsObj: any, workspaceDir: string = DEFAULT_WORKSPACE_DIR): string {
    const tool = get_active_tool(name);
    if (!tool) {
        return `ERROR: unknown tool ${name}`;
    }
    return tool.execute(argumentsObj, workspaceDir);
}

// Compaction can still handle inactive tools so old saved history remains
// compactable after a tool is disabled.
function compact_registered_tool_history(name: string, args: any, result: string): ToolCompaction {
    const tool = get_active_tool(name) || TOOL_REGISTRY.find(candidate => candidate.name === name);
    if (!tool) {
        return { compactedArgs: args, compactedResult: result };
    }
    return tool.compact(args, result);
}
