import fs from 'fs';
import { resolve_workspace_path } from './utils/workspace.js';

export function tool_list_dir(dirPath?: string): string {
    try {
        const target = resolve_workspace_path(dirPath || "");
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
        return `directory listing for ${dirPath || "(root)"}:\n${lines.join('\n')}`;
    } catch (e: any) {
        return `ERROR: ${e.message || String(e)}`;
    }
}
