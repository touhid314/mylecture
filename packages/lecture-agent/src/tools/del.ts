/**
 * del.ts
 *
 * Implements the del tool to safely delete files and directories within the active workspace.
 * Resolves paths and validates targets to prevent deleting the workspace root.
 */
import fs from 'fs';
import path from 'path';
import { resolve_workspace_path, DEFAULT_WORKSPACE_DIR } from '../workspace.js';

export function tool_del(paths: string[], workspaceDir: string = DEFAULT_WORKSPACE_DIR): string {
    if (!Array.isArray(paths)) {
        return "ERROR: paths must be an array of strings.";
    }

    const resolvedTargets: { original: string; resolved: string }[] = [];

    // Pre-validation to avoid partial deletions if there's a security/boundary escape
    try {
        for (const targetPath of paths) {
            if (typeof targetPath !== 'string') {
                return "ERROR: all paths must be strings.";
            }
            const target = resolve_workspace_path(targetPath, workspaceDir);
            if (path.resolve(target) === path.resolve(workspaceDir)) {
                return `ERROR: cannot delete the workspace root directory: ${targetPath}`;
            }
            resolvedTargets.push({ original: targetPath, resolved: target });
        }
    } catch (e: any) {
        return `ERROR: ${e.message || String(e)}`;
    }

    // Execute deletion
    const deletedList: string[] = [];
    try {
        for (const target of resolvedTargets) {
            if (fs.existsSync(target.resolved)) {
                const stat = fs.statSync(target.resolved);
                if (stat.isDirectory()) {
                    fs.rmSync(target.resolved, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(target.resolved);
                }
                deletedList.push(target.original);
            }
        }
        return `del succeeded: deleted ${deletedList.length} item(s): ${deletedList.join(', ') || 'none (files did not exist)'}`;
    } catch (e: any) {
        return `ERROR: ${e.message || String(e)}`;
    }
}

export function compact_del(args: { paths: string[] }, result: string): { compactedArgs: any; compactedResult: string } {
    return {
        compactedArgs: args,
        compactedResult: result
    };
}
