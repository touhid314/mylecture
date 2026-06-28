/**
 * cmd.ts
 *
 * Implements the cmd tool for executing shell commands synchronously within the active
 * workspace. Includes checks to block Python one-liners, enforcing usage of read/write/edits
 * tools for file operations.
 */
import { spawnSync } from 'child_process';

import { ROOT } from './utils/workspace.js';

export function tool_cmd(command: string, timeout_seconds: number = 30): string {
    const lowered_command = command.toLowerCase().trim();
    const blocked_python_patterns = [
        "python -c",
        "python3 -c",
        "py -c",
    ];
    if (blocked_python_patterns.some(pattern => lowered_command.includes(pattern))) {
        return "ERROR: Python one-liners are blocked in cmd. Use the read tool for file inspection, write/edits for file changes, and cmd only for ordinary project commands such as tests, builds, installs, or running existing scripts.";
    }

    try {
        const completed = spawnSync(command, {
            cwd: ROOT,
            shell: true,
            encoding: 'utf8',
            timeout: timeout_seconds * 1000
        });
        return JSON.stringify({
            returncode: completed.status ?? -1,
            stdout: (completed.stdout || "").slice(-12000),
            stderr: (completed.stderr || "").slice(-12000),
        });
    } catch (e: any) {
        return JSON.stringify({
            returncode: -1,
            stdout: "",
            stderr: e.message || String(e)
        });
    }
}
