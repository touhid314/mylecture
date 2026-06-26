import fs from 'fs';
import path from 'path';
import { resolve_workspace_path, ROOT } from './utils/workspace.js';

export function tool_del(paths: string[]): string {
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
            const target = resolve_workspace_path(targetPath);
            if (path.resolve(target) === path.resolve(ROOT)) {
                return `ERROR: cannot delete the workspace root directory: ${targetPath}`;
            }
            resolvedTargets.push({ original: targetPath, resolved: target });
        }
    } catch (e: any) {
        return `ERROR: boundary validation failed: ${e.message || String(e)}`;
    }

    const results: string[] = [];

    for (const item of resolvedTargets) {
        try {
            if (!fs.existsSync(item.resolved)) {
                results.push(`path does not exist: ${item.original}`);
                continue;
            }
            fs.rmSync(item.resolved, { recursive: true, force: true });
            results.push(`deleted: ${item.original}`);
        } catch (e: any) {
            results.push(`failed to delete ${item.original}: ${e.message || String(e)}`);
        }
    }

    return `del processed ${paths.length} target(s):\n${results.map(r => `- ${r}`).join('\n')}`;
}
