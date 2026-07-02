/**
 * workspace.ts
 *
 * Configures and resolves the active directories (BASE_DIR, WORKSPACE_DIR, DEFAULT_WORKSPACE_DIR)
 * for the agent. Handles loading configuration environment variables, managing
 * workspace-relative path resolution, and validating boundary constraints.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
function loadEnv() {
    let dir = __dirname;
    while (dir && dir !== path.parse(dir).root) {
        const envPath = path.join(dir, '.env');
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, quiet: true });
            return;
        }
        dir = path.dirname(dir);
    }
    dotenv.config({ quiet: true });
}
loadEnv();

export const BASE_DIR = path.resolve(__dirname, '..');
export const WORKSPACE_DIR = path.join(BASE_DIR, 'workspace');

function clean_env_path(value: string | undefined): string {
    let cleaned = value || "";
    cleaned = cleaned.split('#')[0].trim();
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned;
}

function parse_config_generation_dir(configPath: string): string {
    let section = "";
    const content = fs.readFileSync(configPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
        if (!line.trim() || line.trimStart().startsWith('#')) continue;

        const sectionMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
        if (sectionMatch) {
            section = sectionMatch[1];
            continue;
        }

        const fieldMatch = line.match(/^\s+generationDir:\s*(.*?)\s*$/);
        if (section === "agent" && fieldMatch) {
            return clean_env_path(fieldMatch[1]);
        }
    }
    return "";
}

function find_config_generation_dir(): string {
    let dir = __dirname;
    while (dir && dir !== path.parse(dir).root) {
        const configPath = path.join(dir, 'config.yaml');
        if (fs.existsSync(configPath)) {
            const configured = parse_config_generation_dir(configPath);
            if (configured) {
                return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(dir, configured);
            }
            return "";
        }
        dir = path.dirname(dir);
    }
    return "";
}

export function get_agent_workspace_dir(): string {
    const explicitWorkspace = clean_env_path(process.env.AGENT_WORKSPACE);
    if (explicitWorkspace) {
        return path.resolve(explicitWorkspace);
    }
    const configWorkspace = find_config_generation_dir();
    if (configWorkspace) {
        return configWorkspace;
    }
    return path.join(WORKSPACE_DIR, 'agent-workspace');
}

export const DEFAULT_WORKSPACE_DIR = get_agent_workspace_dir();

export function resolve_workspace_path(filePath: string, workspaceDir: string = DEFAULT_WORKSPACE_DIR): string {
    const target = path.resolve(workspaceDir, filePath);
    if (target !== workspaceDir && !target.startsWith(workspaceDir + path.sep)) {
        throw new Error(`path escapes workspace: ${filePath}`);
    }
    return target;
}
