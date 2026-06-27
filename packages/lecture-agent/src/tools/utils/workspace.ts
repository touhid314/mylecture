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

export const BASE_DIR = path.resolve(__dirname, '..', '..', '..');
export const WORKSPACE_DIR = path.join(BASE_DIR, 'workspace');
export let ROOT: string;

function clean_env_path(value: string | undefined): string {
    let cleaned = value || "";
    cleaned = cleaned.split('#')[0].trim();
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned;
}

function explicit_agent_workspace(): string {
    const explicitWorkspace = clean_env_path(process.env.AGENT_WORKSPACE);
    if (explicitWorkspace) {
        return path.resolve(explicitWorkspace);
    }
    return "";
}

export function get_agent_workspace_dir(): string {
    const explicitWorkspace = explicit_agent_workspace();
    if (explicitWorkspace) {
        return explicitWorkspace;
    }
    const dir = clean_env_path(process.env.AGENT_WORKSPACE_DIR);
    if (dir) {
        return path.resolve(dir);
    }
    return path.join(WORKSPACE_DIR, 'agent-workspace');
}

export function create_new_session_workspace(): string {
    const explicitWorkspace = explicit_agent_workspace();
    let folderPath = explicitWorkspace;
    if (!folderPath) {
        const baseDir = get_agent_workspace_dir();
        fs.mkdirSync(baseDir, { recursive: true });

        const now = new Date();
        const pad = (num: number) => String(num).padStart(2, '0');
        const hh = pad(now.getHours());
        const min = pad(now.getMinutes());
        const ss = pad(now.getSeconds());
        const dd = pad(now.getDate());
        const mm = pad(now.getMonth() + 1);
        const yyyy = now.getFullYear();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const folderName = `${hh}-${min}-${ss}-${dd}-${mm}-${yyyy}-${randomSuffix}`;
        folderPath = path.resolve(baseDir, folderName);
    }
    fs.mkdirSync(folderPath, { recursive: true });

    console.log(`[Workspace] Created new session folder: ${folderPath}`);

    ROOT = folderPath;
    if (process.cwd() !== ROOT) {
        try {
            process.chdir(ROOT);
        } catch (err) {
            console.error(`Failed to change directory to ${ROOT}:`, err);
        }
    }

    return folderPath;
}

export function get_active_workspace(): string {
    const workspace = get_agent_workspace_dir();
    fs.mkdirSync(workspace, { recursive: true });
    return workspace;
}

ROOT = get_active_workspace();

// Change CWD to ROOT to ensure agent runs in the active workspace
if (process.cwd() !== ROOT) {
    try {
        process.chdir(ROOT);
    } catch (err) {
        console.error(`Failed to change directory to ${ROOT}:`, err);
    }
}

export function ensure_workspace_dirs(): void {
    fs.mkdirSync(ROOT, { recursive: true });
}

ensure_workspace_dirs();

export function resolve_workspace_path(filePath: string): string {
    const target = path.resolve(ROOT, filePath);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        throw new Error(`path escapes workspace: ${filePath}`);
    }
    return target;
}
