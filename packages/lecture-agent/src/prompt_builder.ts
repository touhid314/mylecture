/**
 * prompt_builder.ts
 *
 * Provides utilities to parse and build system/user prompts. Handles automatic
 * inlining of backticked local files, extracts attachment directives (like images,
 * PDFs, and videos), and prepares attachment metadata for the LLM upload pipeline.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKTICK_PATH_PATTERN = /(`+)([^`\n\r]+?)\1/g;
const ATTACHMENT_PATTERN = /\[\(\s*attachment\s*:\s*([^)]+?)\s*\)\]/gi;

export type UploadAttachment = {
    path: string;
    kind: "image" | "pdf" | "video";
    mimeType: string;
};

export const UPLOAD_MIME_BY_EXT: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".mov": "video/quicktime",
    ".avi": "video/avi",
    ".webm": "video/webm",
    ".wmv": "video/wmv",
    ".3gp": "video/3gpp",
    ".3gpp": "video/3gpp",
    ".flv": "video/x-flv",
};

export function language_for_path(filePath: string): string {
    const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
    return ext || "txt";
}

export function upload_mime_type_for_path(filePath: string): string | null {
    return UPLOAD_MIME_BY_EXT[path.extname(filePath).toLowerCase()] || null;
}

export function upload_kind_for_path(filePath: string): "image" | "pdf" | "video" | null {
    const mimeType = upload_mime_type_for_path(filePath);
    if (!mimeType) return null;
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.startsWith("video/")) return "video";
    return null;
}

export function is_upload_supported_path(filePath: string): boolean {
    return upload_mime_type_for_path(filePath) !== null;
}

export function strip_attachment_directives(promptText: string): string {
    return promptText.replace(ATTACHMENT_PATTERN, "").replace(/[ \t]+\n/g, "\n").trim();
}

export function resolve_prompt_path(pathText: string, workspaceDir: string = "."): string | null {
    const rawPath = pathText.trim();
    if (!rawPath) {
        return null;
    }

    const normalized = path.normalize(rawPath);
    if (path.isAbsolute(normalized)) {
        return fs.existsSync(normalized) && fs.statSync(normalized).isFile() ? normalized : null;
    }

    const workspace = path.resolve(workspaceDir);
    const repoRoot = path.resolve(__dirname, '..'); // Since this is in src/, parent is repoRoot

    const workspaceRoot = path.dirname(path.dirname(repoRoot));
    const parentOfWorkspace = path.dirname(workspaceRoot);

    const candidates = [
        path.resolve(workspace, normalized),
        path.resolve(repoRoot, normalized),
        path.resolve(repoRoot, "workspace", normalized),
        path.resolve(process.cwd(), normalized),
        path.resolve(workspaceRoot, normalized),
        path.resolve(parentOfWorkspace, "mylecture-ide", normalized),
        path.resolve(parentOfWorkspace, "mylecture-website", normalized)
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

export function build_prompt(promptText: string, workspaceDir: string = "."): string {
    return strip_attachment_directives(promptText).replace(BACKTICK_PATH_PATTERN, (match, backticks, filePath) => {
        const trimmedFilePath = filePath.trim();
        const resolvedPath = resolve_prompt_path(trimmedFilePath, workspaceDir);
        if (resolvedPath === null) {
            return match;
        }

        if (is_upload_supported_path(resolvedPath)) {
            return match;
        }

        try {
            const content = fs.readFileSync(resolvedPath, 'utf8');
            const language = language_for_path(trimmedFilePath);
            return `\n\n---\n[File Content Starts. File: ${trimmedFilePath}]\n\`\`\`${language}\n${content}\n\`\`\`\n[File Content Ends. File: ${trimmedFilePath}]\n\n---\n`;
        } catch (exc) {
            return `\n\n[Error reading file ${trimmedFilePath}: ${exc}]\n\n`;
        }
    });
}

export function extract_upload_attachments(promptText: string, workspaceDir: string = "."): UploadAttachment[] {
    const rawCandidates: string[] = [];

    for (const match of promptText.matchAll(ATTACHMENT_PATTERN)) {
        rawCandidates.push(match[1]);
    }

    const attachments: UploadAttachment[] = [];
    const seen = new Set<string>();
    for (const candidate of rawCandidates) {
        const trimmed = candidate.trim().replace(/[),.;:!?]+$/g, "");
        const resolvedPath = resolve_prompt_path(trimmed, workspaceDir);
        if (!resolvedPath || !is_upload_supported_path(resolvedPath)) {
            continue;
        }

        const mimeType = upload_mime_type_for_path(resolvedPath);
        const kind = upload_kind_for_path(resolvedPath);
        if (!mimeType || !kind) {
            continue;
        }

        const key = path.resolve(resolvedPath).toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        attachments.push({ path: resolvedPath, kind, mimeType });
    }
    return attachments;
}
