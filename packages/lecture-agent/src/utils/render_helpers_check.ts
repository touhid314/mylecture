/**
 * Fast static check: canvas/render helper calls must be defined in the same HTML file.
 * Each index*.html is loaded independently — helpers from prior blocks are not in scope.
 */

const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

const DEFINITION_PATTERNS = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*\([^)]*\)\s*=>/g,
];

const HELPER_CALL_PATTERN = /\b(draw[A-Z][\w$]*|render[A-Z][\w$]*|update[A-Z][\w$]*)\s*\(/g;

const IGNORED_HELPERS = new Set([
    'renderSection',
    'renderCanvasSection',
    'renderHtmlSection',
    'renderAt',
    'renderFrame',
]);

const GLOBAL_ALLOWLIST = new Set([
    'Object', 'Array', 'Math', 'Number', 'String', 'Boolean', 'Date', 'JSON',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'clearTimeout',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
    'console', 'window', 'document', 'katex',
]);

function extractInlineScripts(html: string): string {
    const scripts: string[] = [];
    let match: RegExpExecArray | null;
    const pattern = new RegExp(SCRIPT_BLOCK_PATTERN.source, SCRIPT_BLOCK_PATTERN.flags);
    while ((match = pattern.exec(html)) !== null) {
        if (match[1]?.trim()) scripts.push(match[1]);
    }
    return scripts.join('\n');
}

function collectDefinedNames(script: string): Set<string> {
    const defined = new Set<string>();
    for (const pattern of DEFINITION_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = re.exec(script)) !== null) {
            if (match[1]) defined.add(match[1]);
        }
    }
    return defined;
}

function collectHelperCalls(script: string): Set<string> {
    const calls = new Set<string>();
    const re = new RegExp(HELPER_CALL_PATTERN.source, HELPER_CALL_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(script)) !== null) {
        const name = match[1];
        if (!name || IGNORED_HELPERS.has(name) || GLOBAL_ALLOWLIST.has(name)) continue;
        calls.add(name);
    }
    return calls;
}

export function findMissingRenderHelpers(html: string): string[] {
    const script = extractInlineScripts(html);
    if (!script.trim()) return [];

    const defined = collectDefinedNames(script);
    const calls = collectHelperCalls(script);
    const missing: string[] = [];

    for (const name of calls) {
        if (!defined.has(name)) missing.push(name);
    }

    return missing.sort();
}

export function formatMissingRenderHelpersError(filePath: string, missing: string[]): string {
    const list = missing.map((name) => `  - ${name}`).join('\n');
    return [
        `HTML contract validation failed for ${filePath}: missing render helper definition(s) in this file.`,
        'Each index*.html is standalone — copy any draw*/render*/update* helpers you call from earlier blocks into the current file.',
        'Undefined helpers:',
        list,
    ].join('\n');
}
