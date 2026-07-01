/**
 * edits.ts
 *
 * Implements the range-based edits tool to apply structured, line-based modifications to files.
 * Supports replacements with inclusive ranges [a, b], insertions after line [a], and insertion at top [0].
 * Validates input ranges, checks for overlap/index collisions, and applies changes.
 */
import fs from 'fs';
import path from 'path';

import { resolve_workspace_path } from '../workspace.js';
import { purify_content_for_path } from './utils/html_contract.js';
import { text_stats } from './utils/text_stats.js';

export interface RangeEdit {
    lines: [number, number?]; // [a, b] to replace/delete, [a] to insert after, [0] to insert at top
    new: string;
}

export function tool_edits(filePath: string, edits: RangeEdit[], workspaceDir?: string): string {
    const target = resolve_workspace_path(filePath, workspaceDir);
    const content = fs.readFileSync(target, 'utf8');

    if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error("edits must be a non-empty array");
    }

    const hasCRLF = content.includes('\r\n');
    const lines = content === '' ? [] : content.split(/\r?\n/);
    const totalLines = lines.length;

    // 1. Parameter Validation
    const processedEdits = edits.map((edit, index) => {
        if (!edit || typeof edit !== 'object') {
            throw new Error(`edit ${index + 1} must be an object`);
        }
        if (!Array.isArray(edit.lines) || edit.lines.length < 1 || edit.lines.length > 2) {
            throw new Error(`edit ${index + 1} must have a "lines" array of length 1 or 2`);
        }
        if (typeof edit.new !== 'string') {
            throw new Error(`edit ${index + 1} must have a string "new" content`);
        }

        const a = edit.lines[0];
        const b = edit.lines[1];

        if (typeof a !== 'number' || isNaN(a) || a < 0) {
            throw new Error(`edit ${index + 1} has invalid start line: ${a}. Must be a non-negative integer.`);
        }

        let startLine: number;
        let removeCount: number;
        let targetIndex: number;
        let isInsertion = false;

        if (edit.lines.length === 1) {
            // Insertion
            isInsertion = true;
            if (a === 0) {
                // Insert at the very top (before line 1)
                startLine = 1;
                targetIndex = 0;
            } else {
                // Insert after line a
                if (a > totalLines) {
                    throw new Error(`edit ${index + 1}: Cannot insert after line ${a} in a file with ${totalLines} lines.`);
                }
                startLine = a + 1;
                targetIndex = a;
            }
            removeCount = 0;
        } else {
            // Replacement/deletion range [a, b]
            if (a === 0) {
                throw new Error(`edit ${index + 1}: Cannot replace line 0. Use [0] to insert at the top.`);
            }
            if (b === undefined || typeof b !== 'number' || isNaN(b) || b < a) {
                throw new Error(`edit ${index + 1} has invalid range: [${a}, ${b}]`);
            }
            if (b > totalLines) {
                throw new Error(`edit ${index + 1}: Range end ${b} exceeds total file lines (${totalLines})`);
            }
            startLine = a;
            removeCount = b - a + 1;
            targetIndex = a - 1;
        }

        return {
            original: edit,
            startLine,
            removeCount,
            targetIndex,
            isInsertion,
            linesInput: edit.lines,
            newText: edit.new
        };
    });

    // 2. Collision and Overlap Checking
    const replacedLines = new Set<number>();
    const insertionPoints = new Set<number>();
    const targetIndexes = new Set<number>();

    for (let idx = 0; idx < processedEdits.length; idx++) {
        const edit = processedEdits[idx];
        const linesInput = edit.linesInput;

        if (targetIndexes.has(edit.targetIndex)) {
            throw new Error(`Collision error: Multiple edits target the same index (${edit.targetIndex}).`);
        }
        targetIndexes.add(edit.targetIndex);

        if (edit.isInsertion) {
            const point = linesInput[0]; // The line we insert after
            if (insertionPoints.has(point)) {
                throw new Error(`Collision error: Multiple insertions target the same location (after line ${point}).`);
            }
            insertionPoints.add(point);
        } else {
            const [a, b] = linesInput as [number, number];
            for (let line = a; line <= b; line++) {
                if (replacedLines.has(line)) {
                    throw new Error(`Collision error: Line ${line} is targeted by multiple replacements.`);
                }
                replacedLines.add(line);
            }
        }
    }

    // 3. Sort edits in descending order:
    // - Primary: targetIndex descending (highest index in file applied first)
    // - Secondary: original start line descending (forces replacements to apply before insertions at same target index)
    processedEdits.sort((e1, e2) => {
        if (e1.targetIndex !== e2.targetIndex) {
            return e2.targetIndex - e1.targetIndex;
        }
        return e2.startLine - e1.startLine;
    });

    // 4. Apply the splices
    let totalRemoved = 0;
    let totalAdded = 0;

    for (const edit of processedEdits) {
        const replacementLines = edit.newText === '' ? [] : edit.newText.split(/\r?\n/);
        lines.splice(edit.targetIndex, edit.removeCount, ...replacementLines);
        totalRemoved += edit.removeCount;
        totalAdded += replacementLines.length;
    }

    let updatedContent = lines.join(hasCRLF ? '\r\n' : '\n');
    const [purifiedUpdated, purifiedCount] = purify_content_for_path(filePath, updatedContent);
    updatedContent = purifiedUpdated;

    fs.writeFileSync(target, updatedContent, 'utf8');

    const stats = text_stats(updatedContent);
    const purified_note = purifiedCount ? `; purified ${purifiedCount} escaped quote(s) in HTML markup` : "";
    const lineDelta = totalAdded - totalRemoved;

    return `edits succeeded for ${filePath}; applied ${edits.length} edit operation(s), removed ${totalRemoved} line(s), added ${totalAdded} line(s) (net line change: ${lineDelta >= 0 ? '+' : ''}${lineDelta})${purified_note}; file now contains ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines`;
}

export function compact_edits(args: { path: string; edits: RangeEdit[] }, result: string): { compactedArgs: any; compactedResult: string } {
    const compactedEdits = (args.edits || []).map(edit => {
        const lineCount = edit.new.split(/\r?\n/).length;
        return {
            lines: edit.lines,
            new: `... [omitted ${lineCount} line(s)]`
        };
    });
    return {
        compactedArgs: {
            path: args.path,
            edits: compactedEdits
        },
        compactedResult: result
    };
}
