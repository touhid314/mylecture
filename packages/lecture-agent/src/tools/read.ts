/**
 * read.ts
 *
 * Implements the read tool to read the contents of a file in the workspace.
 * Resolves paths safely and returns the content with prepended 1-based line numbers.
 */
import fs from 'fs';
import path from 'path';

import { resolve_workspace_path } from '../workspace.js';

export interface ReadOptions {
    start_line?: number;
    limit?: number;
}

function is_range_request(options?: ReadOptions): boolean {
    if (!options) {
        return false;
    }
    return options.start_line !== undefined || options.limit !== undefined;
}

export function tool_read(filePath: string, workspaceDir?: string, options?: ReadOptions): string {
    const target = resolve_workspace_path(filePath, workspaceDir);
    const content = fs.readFileSync(target, 'utf8');
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    if (!is_range_request(options)) {
        return lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');
    }

    const startLine = options?.start_line ?? 1;
    const limit = options?.limit;

    if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
        throw new Error('start_line must be a positive integer');
    }
    if (limit !== undefined) {
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
            throw new Error('limit must be a positive integer');
        }
    }
    if (startLine > totalLines) {
        throw new Error(`start_line (${startLine}) exceeds file length (${totalLines})`);
    }

    const endLine = limit === undefined
        ? totalLines
        : Math.min(startLine + limit - 1, totalLines);
    const slice = lines.slice(startLine - 1, endLine);
    const numbered = slice.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');
    const fileName = path.basename(filePath);
    const header = `[Read lines ${startLine}-${endLine} of ${totalLines} from ${fileName}]`;
    return numbered ? `${header}\n${numbered}` : header;
}

export function compact_read(
    args: { path: string; start_line?: number; limit?: number },
    result: string
): { compactedArgs: any; compactedResult: string } {
    const lineCount = result.split('\n').length;
    const charCount = result.length;
    const compactedArgs: { path: string; start_line?: number; limit?: number } = { path: args.path };
    if (args.start_line !== undefined) {
        compactedArgs.start_line = args.start_line;
    }
    if (args.limit !== undefined) {
        compactedArgs.limit = args.limit;
    }
    return {
        compactedArgs,
        compactedResult: `[Read successful: ${lineCount} lines (${charCount} characters) omitted from history]`
    };
}
