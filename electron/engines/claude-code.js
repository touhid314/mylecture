// Anthropic Claude Code CLI engine (uses the user's Claude login).
// Print mode with stream-json output and partial messages gives token deltas.
import os from "node:os";
import path from "node:path";
import { findExecutable, scratchDir, spawnLines, runCapture, idleStatus, imageBlocks } from "./cli-util.js";
import fs from "node:fs";
import { discoverClaudeModels } from "./model-discovery.js";
import { log } from "../logger.js";
import { BROWSER_SERVER, BROWSER_NOTE, claudeMcpConfig } from "./browser-mcp.js";

// Claude Code records the signed-in account in ~/.claude.json (all platforms)
// and, outside macOS, the login in ~/.claude/.credentials.json.
export function claudeSignedIn(home = os.homedir()) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
    if (cfg.oauthAccount) return true;
  } catch {}
  return fs.existsSync(path.join(home, ".claude", ".credentials.json"));
}

export const AGENT_TOOLS = ["Bash", "PowerShell", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "NotebookEdit", "Skill", "ToolSearch", `mcp__${BROWSER_SERVER}`];
export const WRITE_SCOPE = "You have full tool access: shell, internet (search, fetch, downloads), subagents and file tools. You may read and copy from anywhere on this computer. Every file you create, download, copy, edit or delete yourself must be inside the current project folder; never put your own files anywhere else. Installing tools or packages (pip, npm, uv, winget, Playwright browsers, etc.) is allowed, and so are the caches, temp files and install folders those tools write to on their own.";

const EXTRA = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".claude", "local")];

export const claudeCode = {
  id: "claude-code",
  name: "Claude",
  kind: "cli",
  defaultModel: "",
  installHint: "Connect your Claude subscription from the welcome screen or Settings.",

  exe() {
    return findExecutable(["claude"], EXTRA);
  },

  async status() {
    const exe = this.exe();
    if (!exe) return { installed: false, ready: false, message: "Not set up yet" };
    const r = await runCapture(exe, ["--version"], { timeout: 15000 });
    if (!r.ok) return { installed: true, ready: false, path: exe, message: r.stderr.trim() || "Claude did not start" };
    // Live check: signed in with a Claude subscription (not an API key).
    const a = await runCapture(exe, ["auth", "status", "--json"], { timeout: 20000 });
    let st = null;
    try {
      st = JSON.parse(a.stdout);
    } catch {}
    const signedIn = st ? !!st.loggedIn && st.authMethod === "claude.ai" : claudeSignedIn();
    const plan = st?.subscriptionType ? `Claude ${String(st.subscriptionType).replace(/^\w/, (c) => c.toUpperCase())}` : "";
    const account = signedIn && st?.email ? { email: st.email, plan } : null;
    const message = signedIn ? "Signed in" : st?.loggedIn ? "Signed in with an API key, not a Claude subscription" : "Not signed in";
    return { installed: true, ready: signedIn, version: r.stdout.trim(), path: exe, account, message };
  },

  async models() {
    const exe = this.exe();
    if (!exe) throw new Error("Claude isn't connected. Connect it from the welcome screen or Settings.");
    return discoverClaudeModels(exe);
  },

  // Agent mode: multi-turn, with file tools, working inside `workspace`.
  agent(opts) {
    return this.generate(opts);
  },

  async generate({ system, user, model, effort, signal, onDelta, onStatus, onActivity, onModel, workspace, inbox, images = [] }) {
    const exe = this.exe();
    if (!exe) throw new Error("Claude isn't connected. Connect it from the welcome screen or Settings.");
    // The (long) system prompt travels over stdin with the question, which
    // avoids Windows' command-line length limit.
    // Ignore the user's personal Claude Code setup (CLAUDE.md, hooks, MCP
    // servers, plugins): it leaks into MyLecture runs, slows them down and can
    // contradict the lesson prompt (e.g. "never create .md files").
    // Text mode uses --safe-mode. Agent mode can't: safe mode also drops the
    // --mcp-config browser, so it loads only local settings and our MCP config.
    const args = ["-p", "--no-session-persistence", "--output-format", "stream-json", "--include-partial-messages", "--verbose"];
    // Agent mode streams its input too, so messages typed mid-run (inbox) are
    // injected into the live session; Claude reads them at its next step.
    const live = !!workspace;
    if (live) args.push("--input-format", "stream-json", "--replay-user-messages");
    if (workspace) {
      // Full agent: shell, web, a real browser (Playwright MCP), subagents
      // and every file tool. acceptEdits auto-approves file edits inside the
      // project folder only; edits elsewhere need approval, which headless
      // mode denies. Reads are allowed anywhere. (Claude Code's Windows
      // sandbox is feature-gated off, so shell writes are confined by
      // instruction, not by the OS.)
      args.push("--setting-sources", "local");
      args.push("--permission-mode", "acceptEdits");
      args.push("--allowedTools", AGENT_TOOLS.join(","));
      args.push("--mcp-config", claudeMcpConfig(workspace), "--strict-mcp-config");
      args.push("--append-system-prompt", `${WRITE_SCOPE} ${BROWSER_NOTE}`);
    } else {
      args.push("--safe-mode", "--max-turns", "1", "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit");
    }
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    // Pictures (text mode): the prompt goes in as one stream-json message
    // with image blocks.
    const pics = live ? [] : imageBlocks(images);
    if (pics.length) args.push("--input-format", "stream-json");
    let full = "";
    let err = null;
    // Live input: stdin closes at a result once every message we sent has been
    // consumed (echoed back); otherwise Claude takes another turn for it.
    let input = null, sent = 0, echoed = 0, detach = null;
    const userLine = (text) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";
    const closeInput = () => { detach?.(); detach = null; input?.end(); input = null; };
    let msgId = "m";
    const startedAt = Date.now();
    let thinkingChunks = 0, thinkingBytes = 0, lastProgressAt = 0;
    log("info", "provider.start", { provider: "claude-code", model, effort, agent: !!workspace });
    const res = await spawnLines(exe, args, {
      cwd: workspace || scratchDir("claude-code"),
      // Uncapped hidden thinking made Claude plan for minutes before writing
      // anything; a small budget gets it writing files in seconds.
      env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS || "1024" },
      stdin: live ? null : pics.length ? JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: `${system}\n\n---\n\n${user}` }, ...pics] } }) + "\n" : `${system}\n\n---\n\n${user}`,
      keepStdin: live,
      onStdin: (io) => {
        input = io;
        sent++;
        io.write(userLine(`${system}\n\n---\n\n${user}`));
        if (inbox) detach = inbox.attach((text) => {
          if (!input || !input.write(userLine(text))) return false;
          sent++;
          log("info", "provider.inject", { provider: "claude-code", chars: text.length });
          return true;
        });
      },
      signal,
      onIdle: ({ idleMs, elapsedMs }) => {
        log("warn", "provider.waiting", { provider: "claude-code", idleMs, elapsedMs });
        onStatus?.(idleStatus(idleMs));
      },
      onLine(line) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === "system" && ev.subtype === "init" && ev.model) onModel?.(String(ev.model));
        if (ev.type === "user" && ev.isReplay) {
          echoed++;
          return;
        }
        if (ev.type === "stream_event") {
          const e = ev.event || {};
          if (e.type !== "content_block_delta") log("debug", "provider.event", { provider: "claude-code", type: e.type, blockType: e.content_block?.type, tool: e.content_block?.name });
          if (e.type === "content_block_delta" && e.delta?.type === "thinking_delta") {
            thinkingChunks++;
            thinkingBytes += Buffer.byteLength(e.delta.thinking || "");
            if (Date.now() - lastProgressAt >= 5000) {
              lastProgressAt = Date.now();
              log("info", "provider.thinking", { provider: "claude-code", elapsedMs: Date.now() - startedAt, chunks: thinkingChunks, bytes: thinkingBytes });
            }
          }
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
          for (const b of ev.message?.content || []) if (b.type === "tool_use") {
            log("info", "provider.tool", { provider: "claude-code", tool: b.name });
            onActivity?.(claudeStep(b));
          }
        } else if (ev.type === "result") {
          if (live && echoed >= sent) closeInput();
          log(ev.is_error ? "error" : "info", "provider.result", { provider: "claude-code", isError: !!ev.is_error, subtype: ev.subtype, durationMs: ev.duration_ms, turns: ev.num_turns, outputBytes: Buffer.byteLength(full) });
          if (ev.is_error) err = ev.result || ev.subtype || "error";
          if (!full && typeof ev.result === "string" && !ev.is_error) {
            full = ev.result;
            onDelta(full);
          }
        }
      },
    });
    closeInput();
    log("info", "provider.finish", { provider: "claude-code", code: res.code, aborted: !!res.aborted, elapsedMs: Date.now() - startedAt, outputBytes: Buffer.byteLength(full), thinkingChunks, thinkingBytes });
    if (res.aborted) return { text: full, aborted: true };
    if (err && !full) throw new Error("Claude: " + err);
    if (res.code !== 0 && !full) throw new Error(`Claude stopped unexpectedly (${res.code}): ${res.stderr.slice(-400)}`);
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
