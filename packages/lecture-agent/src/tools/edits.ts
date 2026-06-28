/**
 * edits.ts
 *
 * Implements the edits tool to apply structured, line-based modifications to files.
 * Validates input ranges, compares expected old text (if provided) to actual content,
 * applies the changes, and logs statistics.
 */
import fs from 'fs';
import path from 'path';

import { resolve_workspace_path } from './utils/workspace.js';
import { purify_content_for_path } from './utils/html_contract.js';
import { text_stats } from './utils/text_stats.js';

interface LineEdit {
    start_line: number;
    remove_lines: number;
    new_text: string;
    old_text?: string;
}

function normalize_whitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
}

export function tool_edits(filePath: string, edits: LineEdit[]): string {
    const target = resolve_workspace_path(filePath);
    const content = fs.readFileSync(target, 'utf8');

    if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error("edits must be a non-empty array");
    }

    const hasCRLF = content.includes('\r\n');
    const lines = content.split(/\r?\n/);

    // 1. Parameter Validation
    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        if (!edit || typeof edit !== 'object') {
            throw new Error(`edit ${index + 1} must be an object`);
        }

        const { start_line, remove_lines, new_text, old_text } = edit;

        if (typeof start_line !== 'number' || isNaN(start_line) || start_line < 1) {
            throw new Error(`edit ${index + 1} must have a valid positive start_line`);
        }
        if (typeof remove_lines !== 'number' || isNaN(remove_lines) || remove_lines < 0) {
            throw new Error(`edit ${index + 1} must have a valid non-negative remove_lines`);
        }
        if (typeof new_text !== 'string') {
            throw new Error(`edit ${index + 1} must have a string new_text`);
        }
        if (old_text !== undefined && typeof old_text !== 'string') {
            throw new Error(`edit ${index + 1} old_text must be a string if provided`);
        }

        // Check if start_line is within boundaries
        // Allowing start_line to be lines.length + 1 to append at the end of the file
        if (start_line > lines.length + 1) {
            throw new Error(`edit ${index + 1} start_line (${start_line}) exceeds file line count (${lines.length})`);
        }

        // Check if start_line + remove_lines exceeds line boundaries
        if (start_line - 1 + remove_lines > lines.length) {
            throw new Error(`edit ${index + 1} remove range exceeds file boundaries (start: ${start_line}, remove: ${remove_lines}, file lines: ${lines.length})`);
        }
    }

    // 2. Overlap & Identity Collision Checking
    const sortedEdits = [...edits].sort((a, b) => a.start_line - b.start_line);
    for (let i = 0; i < sortedEdits.length - 1; i++) {
        const current = sortedEdits[i];
        const next = sortedEdits[i + 1];
        
        // The end line of the current edit (1-indexed, inclusive)
        const currentEndLine = current.start_line + current.remove_lines - 1;

        if (next.start_line <= currentEndLine || current.start_line === next.start_line) {
            throw new Error(`edits overlap or collide in the original file: edit at start_line ${next.start_line} collides with edit at start_line ${current.start_line}`);
        }
    }

    // 3. Safety Verification (old_text checks)
    let safetyCheckNotes = "";
    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        if (edit.old_text !== undefined) {
            const originalSlice = lines.slice(edit.start_line - 1, edit.start_line - 1 + edit.remove_lines).join(hasCRLF ? '\r\n' : '\n');
            
            if (originalSlice !== edit.old_text) {
                // Try whitespace-normalized matching
                if (normalize_whitespace(originalSlice) !== normalize_whitespace(edit.old_text)) {
                    throw new Error(`edit ${index + 1} safety check failed: original text at lines ${edit.start_line}-${edit.start_line - 1 + edit.remove_lines} did not match expected old_text`);
                }
                safetyCheckNotes += ` (verified edit ${index + 1} using whitespace-normalized matching)`;
            }
        }
    }

    // 4. Apply Edits in reverse order (bottom-to-top) to maintain original index alignment
    const reverseEdits = [...edits].sort((a, b) => b.start_line - a.start_line);
    let totalRemovedLines = 0;
    let totalAddedLines = 0;

    for (const edit of reverseEdits) {
        const replacementLines = edit.new_text === "" ? [] : edit.new_text.split(/\r?\n/);
        lines.splice(edit.start_line - 1, edit.remove_lines, ...replacementLines);
        
        totalRemovedLines += edit.remove_lines;
        totalAddedLines += replacementLines.length;
    }

    let updatedContent = lines.join(hasCRLF ? '\r\n' : '\n');
    const [purifiedUpdated, purifiedCount] = purify_content_for_path(filePath, updatedContent);
    updatedContent = purifiedUpdated;

    fs.writeFileSync(target, updatedContent, 'utf8');

    const stats = text_stats(updatedContent);
    const purified_note = purifiedCount ? `; purified ${purifiedCount} escaped quote(s) in HTML markup` : "";
    const lineDelta = totalAddedLines - totalRemovedLines;

    return `edits succeeded for ${filePath}; applied ${edits.length} edit operation(s), removed ${totalRemovedLines} line(s), added ${totalAddedLines} line(s) (net line change: ${lineDelta >= 0 ? '+' : ''}${lineDelta})${safetyCheckNotes}${purified_note}; file now contains ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines`;
}
