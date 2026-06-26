export const TOOLS: any[] = [
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
                                description: "Exact text block to replace. Include enough surrounding context copied from the latest read to make it unique. If exact matching fails, the tool can use a unique whitespace-normalized match as a fallback.",
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
    {
        type: "function",
        name: "prepare_user_response",
        description: "Signal that all work is complete and the runtime must switch to sanitized final-response mode. Use this as the only way to finish a task; do not include any file contents or implementation details.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
        },
    },
];

export const TOOL_JSON_SCHEMA = {
    note: "brief step summary for the CLI; do not include hidden chain-of-thought",
    tool: "read | write | edits | mkdir | list_dir | del | prepare_user_response",
    arguments: {
        path: "workspace-relative path for read/write/edits/mkdir/list_dir",
        paths: "array of workspace-relative paths to delete for del",
        content: "complete file content for write",
        edits: [
            {
                old_text: "exact block to replace for one edit",
                new_text: "replacement block for that edit",
                expected_replacements: "optional integer for this edit",
            }
        ],
    },
};
