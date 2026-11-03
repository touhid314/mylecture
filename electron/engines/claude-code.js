// Anthropic Claude Code CLI engine (uses the user's Claude login).
// Print mode with stream-json output and partial messages gives token deltas.
import os from "node:os";
import path from "node:path";
import { findExecutable, scratchDir, spawnLines, runCapture } from "./cli-util.js";
import { discoverClaudeModels } from "./model-discovery.js";

const EXTRA = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".claude", "local")];

export const claudeCode = {
  id: "claude-code",
  name: "Claude",
  kind: "cli",
  defaultModel: "",
  installHint: "Install Claude Code (https://claude.com/claude-code), then run `claude` once and sign in.",

  exe() {
    return findExecutable(["claude"], EXTRA);
  },

  async status() {
    const exe = this.exe();
    if (!exe) return { installed: false, ready: false, message: "claude not found on PATH" };
    const r = await runCapture(exe, ["--version"], { timeout: 15000 });
    return { installed: true, ready: r.ok, version: r.stdout.trim(), path: exe, message: r.ok ? "Ready (sign in with `claude` if prompted)" : r.stderr.trim() };
  },

  async models() {
    const exe = this.exe();
    if (!exe) throw new Error("Claude Code CLI is not installed or not on PATH.");
    return discoverClaudeModels(exe);
  },

  // Agent mode: multi-turn, with file tools, working inside `workspace`.
  agent(opts) {
    return this.generate(opts);
  },

  async generate({ system, user, model, effort, signal, onDelta, onStatus, onActivity, workspace }) {
    const exe = this.exe();
    if (!exe) throw new Error("Claude Code CLI is not installed or not on PATH.");
    // The (long) system prompt travels over stdin with the question, which
    // avoids Windows' command-line length limit.
    const args = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose"];
    if (workspace) {
      args.push("--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,MultiEdit,Glob,Grep");
      args.push("--disallowedTools", "Bash,WebFetch,WebSearch,Task,NotebookEdit");
    } else {
      args.push("--max-turns", "1", "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit");
    }
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    let full = "";
    let err = null;
    let msgId = "m";
    const res = await spawnLines(exe, args, {
      cwd: workspace || scratchDir("claude-code"),
      stdin: `${system}\n\n---\n\n${user}`,
      signal,
      onLine(line) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === "stream_event") {
          const e = ev.event || {};
          if (e.type === "message_start") msgId = e.message?.id || msgId + "'";
          if (e.type === "content_block_start" && e.content_block?.type === "tool_use") onStatus?.(`agent: ${e.content_block.name}`);
          if (e.type === "content_block_start" && e.content_block?.type === "thinking") onActivity?.({ type: "step", icon: "💭", text: "thinking" });
          if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
            full += e.delta.text;
            onDelta(e.delta.text);
            onActivity?.({ type: "say", id: `${msgId}:${e.index}`, delta: e.delta.text });
          }
        } else if (ev.type === "assistant") {
          // Complete tool calls (with their inputs) arrive on the assistant message.
          for (const b of ev.message?.content || []) if (b.type === "tool_use") onActivity?.(claudeStep(b));
        } else if (ev.type === "result") {
          if (ev.is_error) err = ev.result || ev.subtype || "error";
          if (!full && typeof ev.result === "string" && !ev.is_error) {
            full = ev.result;
            onDelta(full);
          }
        }
      },
    });
    if (res.aborted) return { text: full, aborted: true };
    if (err && !full) throw new Error("Claude Code: " + err);
    if (res.code !== 0 && !full) throw new Error(`Claude Code exited ${res.code}: ${res.stderr.slice(-400)}`);
    return { text: full };
  },
};

// Claude Code tool calls -> activity steps.
function claudeStep({ name, input = {} }) {
  const file = input.file_path || input.path || input.notebook_path || "";
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) return { type: "step", icon: "✏️", text: file };
  if (name === "Bash") return { type: "step", icon: "▶", text: input.command || "" };
  if (name === "WebSearch") return { type: "step", icon: "🔎", text: input.query || "" };
  if (name === "Read") return { type: "step", icon: "🔧", text: `read ${file}` };
  if (name === "Glob" || name === "Grep") return { type: "step", icon: "🔧", text: `${name.toLowerCase()} ${input.pattern || ""}` };
  return { type: "step", icon: "🔧", text: `${name} ${file}`.trim() };
}
