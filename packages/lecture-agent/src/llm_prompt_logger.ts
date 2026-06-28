/**
 * llm_prompt_logger.ts
 *
 * Handles persistent file logging of the exact prompts, system instructions,
 * and responses sent to and from LLM providers. Sessions are mapped to local files
 * under `.log/` for inspectability and debugging.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.resolve(__dirname, '..');
const LOG_DIR = path.join(BASE_DIR, '.log');
const SESSION_STATE_PATH = path.join(LOG_DIR, 'current-session.json');

function new_logger_session_id(): string {
    return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
}

function read_or_create_logger_session_id(): string {
    try {
        if (fs.existsSync(SESSION_STATE_PATH)) {
            const state = JSON.parse(fs.readFileSync(SESSION_STATE_PATH, 'utf8'));
            if (state && typeof state.sessionId === 'string' && state.sessionId.trim()) {
                return state.sessionId;
            }
        }
    } catch {
        // Fall through and create a fresh logging session.
    }

    const sessionId = new_logger_session_id();
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(SESSION_STATE_PATH, JSON.stringify({ sessionId }, null, 2), 'utf8');
    return sessionId;
}

let loggerSessionId = read_or_create_logger_session_id();
let loggerSessionDir = path.join(LOG_DIR, `session-${loggerSessionId}`);
let callCounter = fs.existsSync(loggerSessionDir)
    ? fs.readdirSync(loggerSessionDir).filter(name => /^call-\d+-.*\.llm-request\.json$/.test(name)).length
    : 0;

export function start_new_llm_log_session(): void {
    loggerSessionId = new_logger_session_id();
    loggerSessionDir = path.join(LOG_DIR, `session-${loggerSessionId}`);
    callCounter = 0;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(SESSION_STATE_PATH, JSON.stringify({ sessionId: loggerSessionId }, null, 2), 'utf8');
}

function prompt_logging_enabled(): boolean {
    return (process.env.LOG_FULL_LLM_PROMPT || "").replace(/['"]/g, "").trim().toLowerCase() === "true";
}

function safe_label(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 80) || "llm-call";
}

export function log_llm_request(label: string, request: any): void {
    if (!prompt_logging_enabled()) {
        return;
    }

    fs.mkdirSync(loggerSessionDir, { recursive: true });
    const timestamp = new Date().toISOString();
    callCounter += 1;
    const filename = `call-${String(callCounter).padStart(3, "0")}-${safe_label(label)}.llm-request.json`;
    const content = JSON.stringify({
        session: loggerSessionId,
        call: callCounter,
        label,
        timestamp,
        request
    }, null, 2);

    fs.writeFileSync(path.join(loggerSessionDir, filename), content, 'utf8');
}
