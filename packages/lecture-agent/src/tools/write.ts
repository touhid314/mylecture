/**
 * write.ts
 *
 * Implements the write tool to write new files to the workspace. Creates parent directories
 * automatically, sanitizes quote escaping in HTML files, and outputs written file stats.
 */
import fs from 'fs';
import path from 'path';

import { resolve_workspace_path } from './utils/workspace.js';
import { purify_content_for_path } from './utils/html_contract.js';
import { text_stats } from './utils/text_stats.js';

export function tool_write(filePath: string, content: string): string {
    const target = resolve_workspace_path(filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const [purifiedContent, purifiedCount] = purify_content_for_path(filePath, content);
    fs.writeFileSync(target, purifiedContent, 'utf8');
    const stats = text_stats(purifiedContent);
    const purified_note = purifiedCount ? `; purified ${purifiedCount} escaped quote(s) in HTML markup` : "";
    return `write succeeded for ${filePath}; wrote ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines${purified_note}; file now contains ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines`;
}
