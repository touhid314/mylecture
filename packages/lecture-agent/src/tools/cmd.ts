/**
 * cmd.ts
 *
 * Implements the cmd tool for executing shell commands synchronously within the active
 * workspace. Includes checks to block Python one-liners, enforcing usage of read/write/edits
 * tools for file operations.
 */
import { spawnSync } from 'child_process';

import { DEFAULT_WORKSPACE_DIR } from '../workspace.js';

export function tool_cmd(command: string, timeout_seconds: number = 30, workspaceDir: string = DEFAULT_WORKSPACE_DIR): string {
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
            cwd: workspaceDir,
            shell: true,
            encoding: 'utf8',
            timeout: timeout_seconds * 1000,
        });

        const stdout = completed.stdout || "";
        const stderr = completed.stderr || "";
        const combined = [stdout, stderr].filter(Boolean).join('\n').trim();

        if (completed.status !== 0) {
            return `ERROR: command failed with exit code ${completed.status}:\n${combined}`;
        }
        return combined || "Command completed with no output";
    } catch (e: any) {
        return `ERROR: ${e.message || String(e)}`;
    }
}

export function compact_cmd(args: { command: string; timeout_seconds?: number }, result: string): { compactedArgs: any; compactedResult: string } {
    const lines = result.split(/\r?\n/);
    let compactedResult = result;
    if (lines.length > 20) {
        compactedResult = [
            ...lines.slice(0, 3),
            `... [${lines.length - 8} lines of output logs omitted from history] ...`,
            ...lines.slice(-5)
        ].join('\n');
    }
    return {
        compactedArgs: args,
        compactedResult
    };
}
