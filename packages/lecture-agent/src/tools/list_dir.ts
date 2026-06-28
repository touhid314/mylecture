/**
 * list_dir.ts
 *
 * Implements the list_dir tool to list contents of directories safely within the workspace.
 * Resolves paths and formats output with entry types (FILE, DIR, OTHER).
 */
import fs from 'fs';
import { resolve_workspace_path } from '../workspace.js';

export function tool_list_dir(dirPath?: string, workspaceDir?: string): string {
    try {
        const target = resolve_workspace_path(dirPath || "", workspaceDir);
        if (!fs.existsSync(target)) {
            return `ERROR: path does not exist: ${dirPath || ""}`;
        }
        const stat = fs.statSync(target);
        if (!stat.isDirectory()) {
            return `ERROR: path is not a directory: ${dirPath || ""}`;
        }
        const entries = fs.readdirSync(target, { withFileTypes: true });
        if (entries.length === 0) {
            return `directory ${dirPath || "(root)"} is empty`;
        }
        const lines = entries.map(entry => {
            const type = entry.isDirectory() ? 'DIR' : entry.isFile() ? 'FILE' : 'OTHER';
            return `- [${type}] ${entry.name}`;
        });
        return lines.join('\n');
    } catch (e: any) {
        return `ERROR: ${e.message || String(e)}`;
    }
}

export function compact_list_dir(args: { path?: string }, result: string): { compactedArgs: any; compactedResult: string } {
    if (result.startsWith("ERROR:")) {
        return { compactedArgs: args, compactedResult: result };
    }
    const lines = result.split('\n');
    return {
        compactedArgs: args,
        compactedResult: `[List directory successful: found ${lines.length} item(s) in ${args.path || '(root)'}]`
    };
}
