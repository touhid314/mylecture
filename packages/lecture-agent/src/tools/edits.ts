import fs from 'fs';

import { resolve_workspace_path } from './utils/workspace.js';
import { purify_content_for_path } from './utils/html_contract.js';
import { text_stats } from './utils/text_stats.js';

function normalized_text_with_map(text: string): [string, number[]] {
    const normalized_chars: string[] = [];
    const original_indexes: number[] = [];
    let in_whitespace = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (/\s/.test(char)) {
            if (!in_whitespace) {
                normalized_chars.push(" ");
                original_indexes.push(index);
                in_whitespace = true;
            }
            continue;
        }

        normalized_chars.push(char);
        original_indexes.push(index);
        in_whitespace = false;
    }

    let start = 0;
    let end = normalized_chars.length;
    while (start < end && normalized_chars[start] === " ") {
        start++;
    }
    while (end > start && normalized_chars[end - 1] === " ") {
        end--;
    }

    return [
        normalized_chars.slice(start, end).join(""),
        original_indexes.slice(start, end)
    ];
}

function find_text_spans(content: string, old_text: string): [[number, number][], string] {
    const exact_spans: [number, number][] = [];
    let search_from = 0;
    while (true) {
        const start = content.indexOf(old_text, search_from);
        if (start === -1) {
            break;
        }
        exact_spans.push([start, start + old_text.length]);
        search_from = start + old_text.length;
    }

    if (exact_spans.length > 0) {
        return [exact_spans, "exact"];
    }

    const [normalized_content, content_map] = normalized_text_with_map(content);
    const [normalized_old] = normalized_text_with_map(old_text);
    if (!normalized_old) {
        return [[], "exact"];
    }

    const normalized_spans: [number, number][] = [];
    search_from = 0;
    while (true) {
        const normalized_start = normalized_content.indexOf(normalized_old, search_from);
        if (normalized_start === -1) {
            break;
        }
        const normalized_end = normalized_start + normalized_old.length - 1;
        const original_start = content_map[normalized_start];
        const original_end = content_map[normalized_end] + 1;
        normalized_spans.push([original_start, original_end]);
        search_from = normalized_start + normalized_old.length;
    }

    return [normalized_spans, "whitespace-normalized"];
}

export function tool_edits(filePath: string, edits: any[]): string {
    const target = resolve_workspace_path(filePath);
    let content = fs.readFileSync(target, 'utf8');

    if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error("edits must be a non-empty array");
    }

    const replacements: any[] = [];
    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        if (!edit || typeof edit !== 'object') {
            throw new Error(`edit ${index + 1} must be an object`);
        }

        const edit_old = edit.old_text;
        const edit_new = edit.new_text;
        const edit_expected = parseInt(edit.expected_replacements || "1", 10);

        if (typeof edit_old !== 'string' || typeof edit_new !== 'string') {
            throw new Error(`edit ${index + 1} must include string old_text and new_text`);
        }
        if (edit_old === "") {
            throw new Error(`edit ${index + 1} old_text must not be empty`);
        }
        if (isNaN(edit_expected) || edit_expected < 1) {
            throw new Error(`edit ${index + 1} expected_replacements must be at least 1`);
        }

        const [spans, match_type] = find_text_spans(content, edit_old);

        if (spans.length !== edit_expected) {
            throw new Error(`edit ${index + 1} expected ${edit_expected} replacement(s), found ${spans.length} using ${match_type} matching; edit not applied`);
        }

        for (const [start, end] of spans) {
            replacements.push({
                edit_index: index + 1,
                start,
                end,
                old_text: content.substring(start, end),
                new_text: edit_new,
                match_type
            });
        }
    }

    replacements.sort((a, b) => a.start - b.start);
    for (let i = 0; i < replacements.length - 1; i++) {
        const previous = replacements[i];
        const current = replacements[i + 1];
        if (current.start < previous.end) {
            throw new Error(`edits overlap in the original file; edit not applied (edit ${previous.edit_index} overlaps edit ${current.edit_index})`);
        }
    }

    const pieces: string[] = [];
    let cursor = 0;
    for (const replacement of replacements) {
        pieces.push(content.substring(cursor, replacement.start));
        pieces.push(replacement.new_text);
        cursor = replacement.end;
    }
    pieces.push(content.substring(cursor));
    let updated = pieces.join("");
    const [purifiedUpdated, purifiedCount] = purify_content_for_path(filePath, updated);
    updated = purifiedUpdated;

    fs.writeFileSync(target, updated, 'utf8');

    const old_chars = replacements.reduce((sum, r) => sum + r.old_text.length, 0);
    const new_chars = replacements.reduce((sum, r) => sum + r.new_text.length, 0);
    const delta = updated.length - content.length;
    const stats = text_stats(updated);
    const normalized_count = replacements.filter(r => r.match_type === "whitespace-normalized").length;

    const normalized_note = normalized_count ? `; used whitespace-normalized matching for ${normalized_count} replacement(s)` : "";
    const purified_note = purifiedCount ? `; purified ${purifiedCount} escaped quote(s) in HTML markup` : "";

    return `edits succeeded for ${filePath}; applied ${edits.length} edit operation(s), replaced ${old_chars} characters with ${new_chars} characters across ${replacements.length} replacement(s); net change ${delta >= 0 ? '+' : ''}${delta} characters${normalized_note}${purified_note}; file now contains ${stats.characters} characters, ${stats.words} words, and ${stats.lines} lines`;
}
