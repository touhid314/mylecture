/**
 * mkdir.ts
 *
 * Implements the mkdir tool to create directories recursively within the active workspace.
 * Prevents creation of directories outside workspace boundaries.
 */
import fs from 'fs';
import { resolve_workspace_path } from '../../workspace.js';

export function tool_mkdir(dirPath: string, workspaceDir?: string): string {
    try {
        const target = resolve_workspace_path(dirPath, workspaceDir);
        if (fs.existsSync(target)) {
            const stat = fs.statSync(target);
            if (stat.isDirectory()) {
                return `mkdir succeeded: directory already exists at ${dirPath}`;
            } else {
                return `ERROR: path exists and is not a directory at ${dirPath}`;
            }
        }
        fs.mkdirSync(target, { recursive: true });
        return `mkdir succeeded: directory created at ${dirPath}`;
    } catch (e: any) {
        return `ERROR: ${e.message || String(e)}`;
    }
}

export function compact_mkdir(args: { path: string }, result: string): { compactedArgs: any; compactedResult: string } {
    return {
        compactedArgs: args,
        compactedResult: result
    };
}
