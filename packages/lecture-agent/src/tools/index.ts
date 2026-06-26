export { TOOLS, TOOL_JSON_SCHEMA } from './utils/schemas.js';
export { tool_read } from './read.js';
export { tool_write } from './write.js';
export { tool_edits } from './edits.js';
export { tool_cmd } from './cmd.js';
export { line_count } from './utils/text_stats.js';
export {
    BASE_DIR,
    WORKSPACE_DIR,
    ROOT,
    OUTPUTS_DIR,
    archive_agent_workspace,
    clear_agent_workspace,
    resolve_workspace_path,
} from './utils/workspace.js';

import { tool_read } from './read.js';
import { tool_write } from './write.js';
import { tool_edits } from './edits.js';
import { tool_cmd } from './cmd.js';
import { should_validate_contract, validate_index_html_contract } from './utils/html_contract.js';

export function execute_tool(name: string, argumentsObj: any): string {
    if (!argumentsObj || typeof argumentsObj !== 'object') {
        argumentsObj = {};
    }

    try {
        if (name === "read") {
            return tool_read(argumentsObj.path);
        }
        if (name === "write") {
            return tool_write(argumentsObj.path, argumentsObj.content);
        }
        if (name === "edits") {
            return tool_edits(argumentsObj.path, argumentsObj.edits);
        }
        if (name === "cmd") {
            return tool_cmd(argumentsObj.command, argumentsObj.timeout_seconds);
        }
        if (name === "prepare_user_response") {
            return "pre-user-response signal accepted";
        }
        return `ERROR: unknown tool ${name}`;
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
