/**
 * tool_registry.ts
 *
 * Single source of truth for tool metadata, active exposure, execution, and
 * history compaction. A tool whose `active` flag is false is not included in
 * model schemas, prompt tool listings, or JSON fallback examples.
 */
import { tool_read, compact_read } from './read.js';
import { tool_edits, compact_edits } from '../../utils/file_edits.js';
import { tool_cmd, compact_cmd } from './cmd.js';
import { tool_list_dir, compact_list_dir } from './list_dir.js';
import { should_validate_contract, validate_index_html_contract } from '../../utils/html_contract.js';
export { line_count } from '../../utils/text_stats.js';
import { DEFAULT_WORKSPACE_DIR } from '../../workspace.js';

export type ToolRuntimeOptions = Record<string, never>;

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
    execute: (argumentsObj: any, workspaceDir: string) => string | Promise<string>;
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
        description: "Read a text file and image file from the workspace. For text file: the output contains line numbers prepended in the format `<line_number>: <line_content>` for reference. These line numbers are not present in the actual file. For image file: the image is appended in your context, so you can understand the image. ALWAYS read an image before overlaying something on it, so that you know what is where in the image.",
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
        name: "edits",
        active: true,
        description: `Apply one or more range-based edits (replacements, insertions, deletions) to an existing file. 
        Just provide the line number(s) that needs to be changed and the new content to be changed with. 
        For even related content grouped together by {} or any other way, only give the line number(s) that need to be changed.
        Every line in range of 'lines' should be different from every line in 'new'.
        There cannot be any overlap between the old content and the new content.
        Example: 
            {
            "path": "example.md",
            
            "edits": [
                {
                "lines": [2, 3],
                "new": "<new content to replace>"
                },
                {
                "lines": [119],
                "new":"<contents to append after line 119>"
                }
            ]
            }
        
        **Very important:** If a file already exists and you need to change it, use the edits tool instead of the write tool.
        During edit you must maintain the html contract. 
        Never introduce any of these errors:
        - Missing window.__VIDEO_METADATA__
        - Missing window.__VIDEO_PLAN__
        - Missing window.__RENDER_SECTION__
                `,
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative file path." },
                edits: {
                    type: "array",
                    description: "List of range-based edits to apply atomically to the file.",
                    items: {
                        type: "object",
                        properties: {
                            lines: {
                                type: "array",
                                description: `Target range syntax (where 'a' and 'b' are 1-indexed line numbers): 
                                [a, b] to replace/delete lines a to b inclusive; 
                                [a, a] to replace/delete line a; 
                                [a] (1-element array) to insert after line a, without replacing line a; 
                                [0] (1-element array) to insert at the very top (before line 1).`,
                                items: { type: "integer" },
                                minItems: 1,
                                maxItems: 2
                            },
                            new: {
                                type: "string",
                                description: `The new content to replace the range or insert. 
                                Use an empty string to delete.`
                            }
                        },
                        required: ["lines", "new"],
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
        description: "Run a shell command.",
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
];

// Active tools are the only tools exposed to the model. Use this helper instead
// of filtering TOOL_REGISTRY at call sites so inactive behavior stays uniform.
function is_tool_enabled(tool: ToolRegistryEntry, options: ToolRuntimeOptions = {}): boolean {
    void options;
    if (!tool.active) return false;
    return true;
}

function isIndexHtmlPath(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
    return !normalized.includes('/') && /^index(?:\d+)?\.html$/i.test(normalized);
}

function enforceEditorMutationBoundary(name: string, argumentsObj: any, options: ToolRuntimeOptions): string | null {
    void options;
    if (name === 'edits') {
        return isIndexHtmlPath(argumentsObj.path)
            ? null
            : 'ERROR: Lecture editor may only edit workspace-root index.html/indexN.html files.';
    }
    return null;
}

export function active_tools(options: ToolRuntimeOptions = {}): ToolRegistryEntry[] {
    return TOOL_REGISTRY.filter(tool => is_tool_enabled(tool, options));
}

export function active_tool_names(options: ToolRuntimeOptions = {}): string[] {
    return active_tools(options).map(tool => tool.name);
}

export function get_active_tool(name: string, options: ToolRuntimeOptions = {}): ToolRegistryEntry | undefined {
    return active_tools(options).find(tool => tool.name === name);
}

// The system prompt keeps a marker for the tool section. coding_agent.ts replaces
// that marker with this generated block so prompt text and schemas cannot drift.
export function render_available_tools_section(options: ToolRuntimeOptions = {}): string {
    const lines = active_tools(options).map(tool => `- \`${tool.name}\`: ${tool.description}`);
    return ["# Available tools:", "", ...lines].join("\n");
}

// Gemini function declarations are built from this derived list. Do not add tools
// directly to the model config; change TOOL_REGISTRY instead.
export function tool_declarations(options: ToolRuntimeOptions = {}): any[] {
    return active_tools(options).map(tool => ({
        type: tool.type,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
    }));
}

// The JSON fallback path cannot use native function declarations, so it receives
// this compact shape in the prompt. The allowed tool names are generated from the
// same active registry entries.
export function tool_json_schema(options: ToolRuntimeOptions = {}): any {
    const argumentsSchema: any = {
        path: "workspace-relative path for read/edits/list_dir",
        edits: [
            {
                lines: [12, 14], // [a, b] to replace/delete inclusive; [a] to insert after; [0] to insert at top
                new: "replacement/insertion text",
            }
        ],
    };
    return {
        note: "brief step summary for the CLI; do not include hidden chain-of-thought",
        tool: active_tool_names(options).join(" | "),
        arguments: argumentsSchema,
    };
}

export const TOOLS: any[] = tool_declarations();
export const TOOL_JSON_SCHEMA = tool_json_schema();

// Public runtime entrypoint for tool execution. It normalizes bad argument
// payloads and converts implementation exceptions into model-readable errors.
export async function execute_tool(name: string, argumentsObj: any, workspaceDir: string = DEFAULT_WORKSPACE_DIR, options: ToolRuntimeOptions = {}): Promise<string> {
    if (!argumentsObj || typeof argumentsObj !== 'object') {
        argumentsObj = {};
    }

    try {
        const boundaryError = enforceEditorMutationBoundary(name, argumentsObj, options);
        if (boundaryError) return boundaryError;
        return await execute_registered_tool(name, argumentsObj, workspaceDir, options);
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
    } catch { }
    return { compactedArgs: args, compactedResult: result };
}

// Internal dispatch enforces active status. If a tool is inactive, the model
// cannot normally call it, and a forged/old call still receives "unknown tool".
async function execute_registered_tool(name: string, argumentsObj: any, workspaceDir: string = DEFAULT_WORKSPACE_DIR, options: ToolRuntimeOptions = {}): Promise<string> {
    const tool = get_active_tool(name, options);
    if (!tool) {
        return `ERROR: unknown tool ${name}`;
    }
    return await tool.execute(argumentsObj, workspaceDir);
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
