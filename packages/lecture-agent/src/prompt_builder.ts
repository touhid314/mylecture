import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKTICK_PATH_PATTERN = /(`+)([^`\n\r]+?)\1/g;

export function language_for_path(filePath: string): string {
    const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
    return ext || "txt";
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
    return promptText.replace(BACKTICK_PATH_PATTERN, (match, backticks, filePath) => {
        const trimmedFilePath = filePath.trim();
        const resolvedPath = resolve_prompt_path(trimmedFilePath, workspaceDir);
        if (resolvedPath === null) {
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
