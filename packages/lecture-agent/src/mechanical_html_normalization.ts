/**
 * Tiny, semantics-preserving normalizations for generated lecture HTML.
 *
 * These are intentionally narrower than the validator. If source structure is
 * ambiguous, it is left untouched and the normal repair loop handles it.
 */

export type MechanicalNormalizationResult = {
    html: string;
    changes: string[];
};

const INLINE_SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const IDENTIFIER_RE_SOURCE = '[A-Za-z_$][\\w$]*';

type ScanState = {
    quote: '"' | "'" | '`' | null;
    escaped: boolean;
    lineComment: boolean;
    blockComment: boolean;
};

function advanceScanState(text: string, index: number, state: ScanState): number {
    const char = text[index];
    const next = text[index + 1];
    if (state.lineComment) {
        if (char === '\n') state.lineComment = false;
        return index;
    }
    if (state.blockComment) {
        if (char === '*' && next === '/') {
            state.blockComment = false;
            return index + 1;
        }
        return index;
    }
    if (state.quote) {
        if (state.escaped) state.escaped = false;
        else if (char === '\\') state.escaped = true;
        else if (char === state.quote) state.quote = null;
        return index;
    }
    if (char === '/' && next === '/') {
        state.lineComment = true;
        return index + 1;
    }
    if (char === '/' && next === '*') {
        state.blockComment = true;
        return index + 1;
    }
    if (char === '"' || char === "'" || char === '`') state.quote = char;
    return index;
}

function findMatchingDelimiter(text: string, openIndex: number, open: string, close: string): number {
    let depth = 0;
    const state: ScanState = { quote: null, escaped: false, lineComment: false, blockComment: false };
    for (let index = openIndex; index < text.length; index += 1) {
        const before = { ...state };
        index = advanceScanState(text, index, state);
        if (before.quote || before.lineComment || before.blockComment || state.quote || state.lineComment || state.blockComment) continue;
        if (text[index] === open) depth += 1;
        else if (text[index] === close) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
}

function countTopLevelArguments(text: string, openParen: number): number | null {
    const closeParen = findMatchingDelimiter(text, openParen, '(', ')');
    if (closeParen < 0) return null;
    const body = text.slice(openParen + 1, closeParen);
    if (!body.trim()) return 0;
    let count = 1;
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    const state: ScanState = { quote: null, escaped: false, lineComment: false, blockComment: false };
    for (let index = 0; index < body.length; index += 1) {
        const before = { ...state };
        index = advanceScanState(body, index, state);
        if (before.quote || before.lineComment || before.blockComment || state.quote || state.lineComment || state.blockComment) continue;
        const char = body[index];
        if (char === '(') paren += 1;
        else if (char === ')') paren -= 1;
        else if (char === '[') bracket += 1;
        else if (char === ']') bracket -= 1;
        else if (char === '{') brace += 1;
        else if (char === '}') brace -= 1;
        else if (char === ',' && paren === 0 && bracket === 0 && brace === 0) count += 1;
    }
    return count;
}

function executableCodeMask(text: string): string {
    const chars = [...text];
    const state: ScanState = { quote: null, escaped: false, lineComment: false, blockComment: false };
    for (let index = 0; index < text.length; index += 1) {
        const before = { ...state };
        const advancedIndex = advanceScanState(text, index, state);
        const isCode = !before.quote
            && !before.lineComment
            && !before.blockComment
            && !state.quote
            && !state.lineComment
            && !state.blockComment;
        if (!isCode) {
            for (let masked = index; masked <= advancedIndex; masked += 1) {
                if (chars[masked] !== '\n' && chars[masked] !== '\r') chars[masked] = ' ';
            }
        }
        index = advancedIndex;
    }
    return chars.join('');
}

function replaceKnownCanvasTypo(script: string): { script: string; count: number } {
    const code = executableCodeMask(script);
    const contexts = new Set<string>();
    const declaration = new RegExp(`(?:const|let|var)\\s+(${IDENTIFIER_RE_SOURCE})\\s*=\\s*[^;\\n]+?\\.getContext\\s*\\(\\s*(["'])2d\\2\\s*\\)`, 'g');
    let declarationMatch: RegExpExecArray | null;
    while ((declarationMatch = declaration.exec(script)) !== null) {
        if (code.slice(declarationMatch.index, declarationMatch.index + 5).trim()) {
            contexts.add(declarationMatch[1]);
        }
    }

    const replacements: Array<{ start: number; end: number }> = [];
    for (const context of contexts) {
        const calls = new RegExp(`\\b${context}\\s*\\.\\s*cubicCurveTo\\s*\\(`, 'g');
        let call: RegExpExecArray | null;
        while ((call = calls.exec(code)) !== null) {
            const openParen = code.indexOf('(', call.index);
            if (openParen < 0 || countTopLevelArguments(script, openParen) !== 6) continue;
            const methodStart = code.indexOf('cubicCurveTo', call.index);
            replacements.push({ start: methodStart, end: methodStart + 'cubicCurveTo'.length });
        }
    }
    let output = script;
    for (const replacement of replacements.reverse()) {
        output = `${output.slice(0, replacement.start)}bezierCurveTo${output.slice(replacement.end)}`;
    }
    return { script: output, count: replacements.length };
}

type PropertyRange = { start: number; end: number; text: string };

function topLevelPropertyRanges(objectBody: string): PropertyRange[] {
    const ranges: PropertyRange[] = [];
    let start = 0;
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    const state: ScanState = { quote: null, escaped: false, lineComment: false, blockComment: false };
    for (let index = 0; index <= objectBody.length; index += 1) {
        if (index === objectBody.length) {
            ranges.push({ start, end: index, text: objectBody.slice(start, index) });
            break;
        }
        const before = { ...state };
        index = advanceScanState(objectBody, index, state);
        if (before.quote || before.lineComment || before.blockComment || state.quote || state.lineComment || state.blockComment) continue;
        const char = objectBody[index];
        if (char === '(') paren += 1;
        else if (char === ')') paren -= 1;
        else if (char === '[') bracket += 1;
        else if (char === ']') bracket -= 1;
        else if (char === '{') brace += 1;
        else if (char === '}') brace -= 1;
        else if (char === ',' && paren === 0 && bracket === 0 && brace === 0) {
            ranges.push({ start, end: index + 1, text: objectBody.slice(start, index + 1) });
            start = index + 1;
        }
    }
    return ranges;
}

function removeNarrationDurationFromObject(objectText: string): { text: string; removed: boolean } {
    const inner = objectText.slice(1, -1);
    const properties = topLevelPropertyRanges(inner);
    const trimComma = (value: string) => value.trim().replace(/,$/, '').trim();
    const narrationKind = properties.some(property => /^kind\s*:\s*(["'])narration\+visual\1$/.test(trimComma(property.text)));
    if (!narrationKind) return { text: objectText, removed: false };
    const duration = properties.find(property => /^duration\s*:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimComma(property.text)));
    if (!duration) return { text: objectText, removed: false };
    return {
        text: `{${inner.slice(0, duration.start)}${inner.slice(duration.end)}}`,
        removed: true,
    };
}

function removeNarrationDurations(script: string): { script: string; count: number } {
    const assignment = /window\s*\.\s*__VIDEO_PLAN__\s*=\s*\[/g;
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    let count = 0;
    let match: RegExpExecArray | null;
    while ((match = assignment.exec(script)) !== null) {
        const arrayStart = script.indexOf('[', match.index);
        const arrayEnd = findMatchingDelimiter(script, arrayStart, '[', ']');
        if (arrayStart < 0 || arrayEnd < 0) continue;
        let cursor = arrayStart + 1;
        while (cursor < arrayEnd) {
            const objectStart = script.indexOf('{', cursor);
            if (objectStart < 0 || objectStart >= arrayEnd) break;
            const objectEnd = findMatchingDelimiter(script, objectStart, '{', '}');
            if (objectEnd < 0 || objectEnd > arrayEnd) break;
            const normalized = removeNarrationDurationFromObject(script.slice(objectStart, objectEnd + 1));
            if (normalized.removed) {
                replacements.push({ start: objectStart, end: objectEnd + 1, text: normalized.text });
                count += 1;
            }
            cursor = objectEnd + 1;
        }
        assignment.lastIndex = arrayEnd + 1;
    }
    let output = script;
    for (const replacement of replacements.reverse()) {
        output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
    }
    return { script: output, count };
}

export function normalizeMechanicalHtml(html: string): MechanicalNormalizationResult {
    const changes: string[] = [];
    const normalized = html.replace(INLINE_SCRIPT_TAG_RE, (full, attrs: string, body: string) => {
        if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*(["']?)module\1/i.test(attrs)) return full;
        const canvas = replaceKnownCanvasTypo(body);
        const duration = removeNarrationDurations(canvas.script);
        if (canvas.count > 0) changes.push(`corrected ${canvas.count} unambiguous cubicCurveTo call(s) to bezierCurveTo`);
        if (duration.count > 0) changes.push(`removed duration from ${duration.count} narration+visual segment(s)`);
        return `<script${attrs}>${duration.script}</script>`;
    });
    return { html: normalized, changes };
}
