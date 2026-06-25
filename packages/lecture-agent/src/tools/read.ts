import fs from 'fs';

import { resolve_workspace_path } from './utils/workspace.js';

export function tool_read(filePath: string): string {
    const target = resolve_workspace_path(filePath);
    return fs.readFileSync(target, 'utf8');
}
