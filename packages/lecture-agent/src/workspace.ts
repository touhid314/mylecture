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

export function get_agent_workspace_dir(): string {
    const explicitWorkspace = clean_env_path(process.env.AGENT_WORKSPACE);
    if (explicitWorkspace) {
        return path.resolve(explicitWorkspace);
    }
    const dir = clean_env_path(process.env.AGENT_WORKSPACE_DIR);
    if (dir) {
        return path.resolve(dir);
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
