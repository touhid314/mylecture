/**
 * html_contract.ts
 *
 * Provides functions to ensure written files conform to the project's HTML lecture contract.
 * Includes methods to clean up escaped double quotes in HTML markup and to invoke the
 * validator utility programmatically on write/edit events.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { findMissingRenderHelpers, formatMissingRenderHelpersError } from './render_helpers_check.js';
import { DEFAULT_WORKSPACE_DIR, resolve_workspace_path } from '../workspace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACT_VALIDATOR_JS = path.join(__dirname, '..', 'validate_contract.cjs');
const PROTECTED_HTML_BLOCK_PATTERN = /(<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>)/gi;
const HTML_TAG_PATTERN = /<[^<>]*>/g;

export function should_validate_contract(name: string, argumentsObj: any): boolean {
    if (!["write", "edits"].includes(name) || !argumentsObj || typeof argumentsObj !== 'object') {
        return false;
    }
    const filePath = argumentsObj.path;
    if (typeof filePath !== 'string') {
        return false;
    }

    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (normalized.endsWith('activities/interactive/index.html') ||
        normalized.endsWith('activities/game/index.html')) {
        return false;
    }

    const filename = path.basename(filePath).toLowerCase();
    if (!filename.startsWith("index") || !filename.endsWith(".html")) {
        return false;
    }

    const suffix = filename.substring(5, filename.length - 5);
    return suffix === "" || /^\d+$/.test(suffix);
}



export function purify_html_markup_escapes(content: string): [string, number] {
    let replacement_count = 0;

    function purify_tag(tag: string): string {
        const matches = tag.match(/\\"/g);
        if (matches) {
            replacement_count += matches.length;
        }
        return tag.replace(/\\"/g, '"');
    }

    const parts = content.split(PROTECTED_HTML_BLOCK_PATTERN);
    const purified_parts: string[] = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i % 2 === 1) {
            purified_parts.push(part);
        } else {
            purified_parts.push(part.replace(HTML_TAG_PATTERN, purify_tag));
        }
    }

    return [purified_parts.join(""), replacement_count];
}

export function purify_content_for_path(filePath: string, content: string): [string, number] {
    if (path.extname(filePath).toLowerCase() !== ".html") {
        return [content, 0];
    }
    return purify_html_markup_escapes(content);
}

export function validate_index_html_contract(filePath: string, workspaceDir: string = DEFAULT_WORKSPACE_DIR): string {
    const target = resolve_workspace_path(filePath, workspaceDir);
    if (!fs.existsSync(CONTRACT_VALIDATOR_JS)) {
        return `HTML contract validation skipped: validator not found at ${CONTRACT_VALIDATOR_JS}`;
    }

    let content: string;
    try {
        content = fs.readFileSync(target, 'utf8');
    } catch (exc: any) {
        return `HTML contract validation failed for ${filePath}: could not read file: ${exc.message || exc}`;
    }

    const [, escaped_markup_count] = purify_html_markup_escapes(content);
    if (escaped_markup_count > 0) {
        return `HTML contract validation failed for ${filePath}: found ${escaped_markup_count} literal escaped quote(s) in HTML markup. Use normal attributes like id="stage", not id=\\"stage\\".`;
    }

    const missingHelpers = findMissingRenderHelpers(content);
    if (missingHelpers.length > 0) {
        return formatMissingRenderHelpersError(filePath, missingHelpers);
    }

    try {
        const completed = spawnSync('node', [CONTRACT_VALIDATOR_JS, target], {
            cwd: workspaceDir,
            encoding: 'utf8',
            timeout: 10000
        });

        const stdout = (completed.stdout || "").trim();
        const stderr = (completed.stderr || "").trim();
        const combined = [stderr, stdout].filter(Boolean).join('\n').trim();

        if (completed.status === 0) {
            return `HTML contract validation passed for ${filePath}: ${stdout || 'OK'}`;
        }
        return `HTML contract validation failed for ${filePath} (exit ${completed.status}): ${combined || 'unknown validation error'}`;
    } catch (exc: any) {
        return `HTML contract validation skipped: ${exc.name || 'Error'}: ${exc.message || exc}`;
    }
}


