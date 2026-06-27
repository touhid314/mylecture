export const TOOLS: any[] = [
    {
        type: "function",
        name: "read",
        description: "Read a UTF-8 text file from the workspace. The output contains line numbers prepended in the format '<line_number>: <line_content>' for reference. Note that these line numbers are NOT present in the actual file.",
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
        description: "Apply one or more line-based diff patches to a file. Line numbers refer to the original state of the file before any edits are applied.",
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
                                description: "The text to insert at start_line (use empty string to delete without inserting)."
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
    },
    {
        type: "function",
        name: "mkdir",
        description: "Create a new directory in the workspace (recursive by default).",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative directory path." }
            },
            required: ["path"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "list_dir",
        description: "List the contents of a directory in the workspace, indicating files and folders.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Workspace-relative directory path. Defaults to root if omitted." }
            },
            required: [],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "del",
        description: "Delete files or directories in the workspace.",
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
    },
];

export const TOOL_JSON_SCHEMA = {
    note: "brief step summary for the CLI; do not include hidden chain-of-thought",
    tool: "read | write | edits | mkdir | list_dir | del",
    arguments: {
        path: "workspace-relative path for read/write/edits/mkdir/list_dir",
        paths: "array of workspace-relative paths to delete for del",
        content: "complete file content for write",
        edits: [
            {
                start_line: "1-indexed starting line number of the edit in the original file",
                remove_lines: "number of lines to remove (0 for pure insertion)",
                new_text: "text to insert",
            }
        ],
    },
};
