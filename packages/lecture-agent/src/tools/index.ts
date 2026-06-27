export { TOOLS, TOOL_JSON_SCHEMA } from './utils/schemas.js';
export { tool_read } from './read.js';
export { tool_write } from './write.js';
export { tool_edits } from './edits.js';
export { tool_cmd } from './cmd.js';
export { tool_mkdir } from './mkdir.js';
export { tool_list_dir } from './list_dir.js';
export { tool_del } from './del.js';
export { line_count } from './utils/text_stats.js';
export {
    BASE_DIR,
    WORKSPACE_DIR,
    ROOT,
    create_new_session_workspace,
    resolve_workspace_path,
} from './utils/workspace.js';

import { tool_read } from './read.js';
import { tool_write } from './write.js';
import { tool_edits } from './edits.js';
import { tool_cmd } from './cmd.js';
import { tool_mkdir } from './mkdir.js';
import { tool_list_dir } from './list_dir.js';
import { tool_del } from './del.js';
import { should_validate_contract, validate_index_html_contract } from './utils/html_contract.js';

export function execute_tool(name: string, argumentsObj: any): string {
    if (!argumentsObj || typeof argumentsObj !== 'object') {
        argumentsObj = {};
    }

    try {
        let result: string;
        if (name === "read") {
            result = tool_read(argumentsObj.path);
        } else if (name === "write") {
            result = tool_write(argumentsObj.path, argumentsObj.content);
        } else if (name === "edits") {
            result = tool_edits(argumentsObj.path, argumentsObj.edits);
        } else if (name === "mkdir") {
            result = tool_mkdir(argumentsObj.path);
        } else if (name === "list_dir") {
            result = tool_list_dir(argumentsObj.path);
        } else if (name === "del") {
            result = tool_del(argumentsObj.paths);
        } else {
            return `ERROR: unknown tool ${name}`;
        }

        return result;
    } catch (exc: any) {
        return `ERROR: ${exc.name || 'Error'}: ${exc.message || exc}`;
    }
}

export function build_function_response_payload(name: string, argumentsObj: any, result: string): any {
    const payload: any = { result };
    if (!result.startsWith("ERROR:") && should_validate_contract(name, argumentsObj)) {
        const validation = validate_index_html_contract(argumentsObj.path);
        payload["contract_validation"] = validation;
        payload["result"] = `${payload["result"]}\n${validation}`;
    }

    return payload;
}
