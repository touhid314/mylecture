/**
 * index.ts
 *
 * Central export registry and tool execution dispatcher. Exports workspace paths,
 * parameters, schemas, and maps incoming tool invocation payloads to their respective
 * implementation functions.
 */
export { TOOLS, TOOL_JSON_SCHEMA } from './utils/schemas.js';
export { tool_read, compact_read } from './read.js';
export { tool_write, compact_write } from './write.js';
export { tool_edits, compact_edits } from './edits.js';
export { tool_cmd, compact_cmd } from './cmd.js';
export { tool_mkdir, compact_mkdir } from './mkdir.js';
export { tool_list_dir, compact_list_dir } from './list_dir.js';
export { tool_del, compact_del } from './del.js';
export { line_count } from './utils/text_stats.js';

import { tool_read, compact_read } from './read.js';
import { tool_write, compact_write } from './write.js';
import { tool_edits, compact_edits } from './edits.js';
import { tool_cmd, compact_cmd } from './cmd.js';
import { tool_mkdir, compact_mkdir } from './mkdir.js';
import { tool_list_dir, compact_list_dir } from './list_dir.js';
import { tool_del, compact_del } from './del.js';
import { should_validate_contract, validate_index_html_contract } from './utils/html_contract.js';
import { DEFAULT_WORKSPACE_DIR } from '../workspace.js';

export function execute_tool(name: string, argumentsObj: any, workspaceDir: string = DEFAULT_WORKSPACE_DIR): string {
    if (!argumentsObj || typeof argumentsObj !== 'object') {
        argumentsObj = {};
    }

    try {
        let result: string;
        if (name === "read") {
            result = tool_read(argumentsObj.path, workspaceDir);
        } else if (name === "write") {
            result = tool_write(argumentsObj.path, argumentsObj.content, workspaceDir);
        } else if (name === "edits") {
            result = tool_edits(argumentsObj.path, argumentsObj.edits, workspaceDir);
        } else if (name === "mkdir") {
            result = tool_mkdir(argumentsObj.path, workspaceDir);
        } else if (name === "list_dir") {
            result = tool_list_dir(argumentsObj.path, workspaceDir);
        } else if (name === "del") {
            result = tool_del(argumentsObj.paths, workspaceDir);
        } else {
            return `ERROR: unknown tool ${name}`;
        }

        return result;
    } catch (exc: any) {
        return `ERROR: ${exc.name || 'Error'}: ${exc.message || exc}`;
    }
}

export function build_function_response_payload(name: string, argumentsObj: any, result: string, workspaceDir: string = DEFAULT_WORKSPACE_DIR): any {
    const payload: any = { result };
    if (!result.startsWith("ERROR:") && should_validate_contract(name, argumentsObj)) {
        const validation = validate_index_html_contract(argumentsObj.path, workspaceDir);
        payload["contract_validation"] = validation;
        payload["result"] = `${payload["result"]}\n${validation}`;
    }

    return payload;
}

export function compact_tool_history(name: string, args: any, result: string): { compactedArgs: any; compactedResult: string } {
    if (!args || typeof args !== 'object') {
        args = {};
    }
    try {
        if (name === "read") {
            return compact_read(args, result);
        } else if (name === "write") {
            return compact_write(args, result);
        } else if (name === "edits") {
            return compact_edits(args, result);
        } else if (name === "cmd") {
            return compact_cmd(args, result);
        } else if (name === "mkdir") {
            return compact_mkdir(args, result);
        } else if (name === "list_dir") {
            return compact_list_dir(args, result);
        } else if (name === "del") {
            return compact_del(args, result);
        }
    } catch {}
    return { compactedArgs: args, compactedResult: result };
}
