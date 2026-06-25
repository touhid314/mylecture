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

export const TOOL_JSON_SCHEMA = {
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
