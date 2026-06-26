import fs from 'fs';

import { resolve_workspace_path } from './utils/workspace.js';

export function tool_read(filePath: string): string {
    const target = resolve_workspace_path(filePath);
    const content = fs.readFileSync(target, 'utf8');
    const lines = content.split(/\r?\n/);
    return lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');
}
