import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BASE_DIR = path.resolve(__dirname, '..', '..', '..');
export const WORKSPACE_DIR = path.join(BASE_DIR, 'workspace');
export const ROOT = path.resolve(WORKSPACE_DIR, 'agent-workspace');
export const OUTPUTS_DIR = path.resolve(BASE_DIR, 'outputs');

export function ensure_workspace_dirs(): void {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

ensure_workspace_dirs();

export function resolve_workspace_path(filePath: string): string {
    const target = path.resolve(ROOT, filePath);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        throw new Error(`path escapes workspace: ${filePath}`);
    }
    return target;
}

export function clear_agent_workspace(): void {
    const resolvedRoot = path.resolve(ROOT);
    if (resolvedRoot !== ROOT || resolvedRoot === path.parse(resolvedRoot).root) {
        throw new Error(`refusing to clear unsafe workspace path: ${ROOT}`);
    }

    fs.mkdirSync(ROOT, { recursive: true });
    for (const entry of fs.readdirSync(ROOT)) {
        fs.rmSync(path.join(ROOT, entry), { recursive: true, force: true });
    }
}

function slugify_title(title: string): string {
    return title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 80);
}

function extract_title_from_html(content: string): string | null {
    const metadataTitleMatch = content.match(/__VIDEO_METADATA__\s*=\s*\{[\s\S]*?\btitle\s*:\s*(['"`])([\s\S]*?)\1/);
    if (metadataTitleMatch && metadataTitleMatch[2].trim()) {
        return metadataTitleMatch[2].trim();
    }

    const documentTitleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (documentTitleMatch && documentTitleMatch[1].trim()) {
        return documentTitleMatch[1].replace(/<[^>]+>/g, "").trim();
    }

    return null;
}

function archive_title_slug(): string | null {
    for (const htmlName of ["index.html", "index1.html"]) {
        const htmlPath = path.join(ROOT, htmlName);
        if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) {
            continue;
        }
        const title = extract_title_from_html(fs.readFileSync(htmlPath, 'utf8'));
        if (!title) {
            continue;
        }
        const slug = slugify_title(title);
        if (slug) {
            return slug;
        }
    }
    return null;
}

export function archive_agent_workspace(): string | null {
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    fs.mkdirSync(ROOT, { recursive: true });

    const entries = fs.readdirSync(ROOT);
    if (entries.length === 0) {
        return null;
    }

    const uniqueId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const slug = archive_title_slug();
    const archiveName = slug ? `${slug}-${uniqueId}` : uniqueId;
    const archivePath = path.resolve(OUTPUTS_DIR, archiveName);
    if (archivePath !== OUTPUTS_DIR && !archivePath.startsWith(OUTPUTS_DIR + path.sep)) {
        throw new Error(`refusing to archive outside outputs: ${archivePath}`);
    }

    fs.cpSync(ROOT, archivePath, { recursive: true });
    return archivePath;
}
