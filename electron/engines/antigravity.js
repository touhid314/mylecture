// Google Antigravity CLI ("agy") engine.
// Uses print mode with NDJSON in/out: the prompt goes in over stdin (no
// command-line length limit) and text deltas stream back line by line.
import os from "node:os";
import path from "node:path";
import { findExecutable, scratchDir, spawnLines, runCapture, idleStatus, VISION_MIMES } from "./cli-util.js";
import fs from "node:fs";
import { parseAntigravityModels } from "./model-discovery.js";
import { log } from "../logger.js";
import { BROWSER_NOTE, PLAYWRIGHT_MCP, browserServer } from "./browser-mcp.js";

// The active Google account, as recorded in ~/.gemini/google_accounts.json.
export function antigravityEmail(home = os.homedir()) {
  try {
    const active = JSON.parse(fs.readFileSync(path.join(home, ".gemini", "google_accounts.json"), "utf8")).active;
    return typeof active === "string" && active.includes("@") ? active : "";
  } catch {
    return "";
  }
}

const EXTRA_DIRS = [path.join(os.homedir(), "AppData", "Local", "agy", "bin")];

// Agent runs get every tool, auto-approved: terminal, browser/web and file
// tools. Headless mode cannot ask the user, so nothing would run otherwise.
// Antigravity's --sandbox does not confine terminal writes on Windows, so the
// project-folder write scope is given as an instruction.
export const ANTIGRAVITY_FILE_TOOLS = `You are running non-interactively in MyLecture with full tool access: terminal commands, internet (search, fetch, download), browser and file tools are all approved. You may read and copy files from anywhere on this computer. Every file you create, download, copy, edit or delete yourself must be inside the current project folder; never put your own files anywhere else. Installing tools or packages (pip, npm, uv, winget, Playwright browsers, etc.) is allowed, and so are the caches, temp files and install folders those tools write to on their own. ${BROWSER_NOTE} Finish with a short response describing the result.`;

// agy has no per-run MCP option (--settings rejects mcpServers), so the
// browser is registered once in its MCP list, unless a Playwright server is
// already there.
let browserReady = null;
export function ensureAgyBrowser(exe) {
  browserReady ||= (async () => {
    const list = await runCapture(exe, ["mcp", "list"], { timeout: 20000 });
    if (list.ok && /@playwright\/mcp/.test(list.stdout)) return true;
    const { command, args } = browserServer();
    const add = await runCapture(exe, ["mcp", "add", "mylecture-browser", "--", command, ...args], { timeout: 20000 });
    log(add.ok ? "info" : "warn", "provider.browser", { provider: "antigravity", registered: !!add.ok, server: PLAYWRIGHT_MCP });
    return !!add.ok;
  })().catch(() => false);
  return browserReady;
}

export const antigravity = {
  id: "antigravity",
  name: "Gemini",
  kind: "cli",
  defaultModel: "",
  installHint: "Connect your Gemini subscription from the welcome screen or Settings.",

  exe() {
    return findExecutable(["agy"], EXTRA_DIRS);
  },

  async status() {
    const exe = this.exe();
    if (!exe) return { installed: false, ready: false, message: "Not set up yet" };
    const r = await runCapture(exe, ["--version"], { timeout: 15000 });
    if (!r.ok) return { installed: true, ready: false, path: exe, message: r.stderr.trim() || "Gemini did not start" };
    // Live check: the usage report only answers when the Google sign-in works
    // (it is stored by the system, e.g. Windows Credential Manager).
    const u = await runCapture(exe, ["-p", "/usage", "--output-format", "json"], { timeout: 25000 });
    let signedIn = false;
    try {
      signedIn = JSON.parse(u.stdout).status === "SUCCESS";
    } catch {}
    const email = signedIn ? antigravityEmail() : "";
    return { installed: true, ready: signedIn, version: r.stdout.trim(), path: exe, account: email ? { email, plan: "" } : null, message: signedIn ? "Signed in" : "Not signed in" };
  },

  async models() {
    const exe = this.exe();
    if (!exe) throw new Error("Gemini isn't connected. Connect it from the welcome screen or Settings.");
    const r = await runCapture(exe, ["models"], { timeout: 30000 });
    if (!r.ok) throw new Error(`Gemini model list failed: ${r.stderr.trim() || r.error?.message || "no models"}`);
    return parseAntigravityModels(r.stdout);
  },

  // Streams the model's text; calls onDelta(text) per chunk.
  // Agent mode: file edits auto-accepted, working inside `workspace`.
  agent(opts) {
    return this.generate(opts);
  },

  async generate({ system, user, model, effort, signal, onDelta, onStatus, onActivity, workspace, inbox, images = [] }) {
    const exe = this.exe();
    if (!exe) throw new Error("Gemini isn't connected. Connect it from the welcome screen or Settings.");
    const baseArgs = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"];
    if (workspace) {
      baseArgs.push("--dangerously-skip-permissions");
      await ensureAgyBrowser(exe);
    }
    if (model) baseArgs.push("--model", model);
    if (workspace && effort) baseArgs.push("--effort", effort);
    // Pictures: its stream input takes text only, so it opens the files
    // itself (their folder is added to its workspace).
    const pics = images.filter((i) => VISION_MIMES.test(i?.mime || "") && i.path).slice(0, 6);
    for (const dir of new Set(pics.map((i) => path.dirname(i.path)))) baseArgs.push("--add-dir", dir);
    const picNote = pics.length ? `\n\nThe student attached ${pics.length === 1 ? "a picture" : `${pics.length} pictures`}. Open and look at ${pics.length === 1 ? "it" : "each one"} with your file viewing tool before you answer:\n${pics.map((i) => `- ${i.path}`).join("\n")}` : "";
    let content = `${system}${workspace ? `\n\n${ANTIGRAVITY_FILE_TOOLS}` : ""}\n\n---\n\n${user}${picNote}`;
    let full = "";
    let error = null;
    let usage = null;
    const startedAt = Date.now();
    let lastProgressAt = 0;
    log("info", "provider.start", { provider: "antigravity", model, effort, agent: !!workspace });
    // Mid-run messages (as Super Agent does for Antigravity): stop the run and
    // resume the same conversation at once with the new message.
    let conversation = null, interrupt = null;
    const pending = [];
    const detach = inbox?.attach((text) => {
      if (!conversation || !interrupt) return false;
      pending.push(text);
      log("info", "provider.inject", { provider: "antigravity", chars: text.length });
      interrupt.abort();
      return true;
    });
    let res;
    try {
      for (;;) {
        interrupt = new AbortController();
        const onOuterAbort = () => interrupt?.abort();
        signal?.addEventListener("abort", onOuterAbort, { once: true });
        if (signal?.aborted) interrupt.abort();
        const args = [...baseArgs, ...(conversation ? ["--conversation", conversation] : []), "-p", ""];
        const stdin = JSON.stringify({ event: "user", message: { role: "user", content } }) + "\n";
        res = await spawnLines(exe, args, {
          cwd: workspace || scratchDir("antigravity"),
          stdin,
          signal: interrupt.signal,
          onIdle: ({ idleMs, elapsedMs }) => {
            log("warn", "provider.waiting", { provider: "antigravity", idleMs, elapsedMs });
            onStatus?.(idleStatus(idleMs));
          },
          onLine: (line) => {
            if (!conversation) conversation = /"conversation_id"\s*:\s*"([^"]+)"/.exec(line)?.[1] || null;
            handle(line);
          },
        });
        signal?.removeEventListener("abort", onOuterAbort);
        interrupt = null;
        // Interrupted for a new message (not stopped by the user): resume with it.
        if (res.aborted && !signal?.aborted && pending.length && conversation) {
          content = `You were interrupted by a new message from the user. Take it into account, then continue the task:\n\n${pending.splice(0).join("\n\n")}`;
          error = null;
          log("info", "provider.resume", { provider: "antigravity", conversation });
          continue;
        }
        break;
      }
    } finally {
      detach?.();
    }
    function handle(line) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.event === "step_update") {
          const su = ev.step_update || {};
          if (su.step_type === "tool" || Date.now() - lastProgressAt >= 5000) {
            lastProgressAt = Date.now();
            log("info", "provider.event", { provider: "antigravity", type: su.step_type, state: su.state, tool: su.tool_name, outputBytes: Buffer.byteLength(full), elapsedMs: Date.now() - startedAt });
          }
          if (su.step_type === "agent_response" && su.text_delta) {
            full += su.text_delta;
            onDelta(su.text_delta);
            onActivity?.({ type: "say", id: `s${su.step_index}`, delta: su.text_delta });
          } else if (su.step_type === "tool" && su.state === "ACTIVE") {
            onStatus?.(`agent: ${su.tool_name}`);
            onActivity?.(agyStep(su));
          } else if (su.step_type && su.step_type !== "user_input" && su.state === "ACTIVE") {
            onStatus?.(`agent: ${su.step_type}`);
          }
          if (su.usage) usage = su.usage;
        } else if (ev.event === "result") {
          const r = ev.result || {};
          log(r.status === "SUCCESS" ? "info" : "error", "provider.result", { provider: "antigravity", status: r.status, deniedActions: r.denied_actions?.length || 0, outputBytes: Buffer.byteLength(full) });
          if (r.status && r.status !== "SUCCESS") error = r.error || r.status;
          if (r.denied_actions?.length) {
            error = "A tool needed permission that Gemini cannot request inside MyLecture. Send the request again.";
          }
          if (r.usage) usage = r.usage;
          // If deltas were missed, fall back to the full response.
          if (!full && r.response) {
            full = r.response;
            onDelta(r.response);
          }
        }
    }
    log("info", "provider.finish", { provider: "antigravity", code: res.code, aborted: !!res.aborted, elapsedMs: Date.now() - startedAt, outputBytes: Buffer.byteLength(full) });
    if (res.aborted) return { text: full, aborted: true };
    if (error) throw new Error(`Gemini: ${error}`);
    if (res.code !== 0 && !full) throw new Error(`Gemini stopped unexpectedly (${res.code}): ${res.stderr.slice(-500)}`);
    if (!full.trim()) throw new Error("Gemini stopped without a reply. Send the request again; no completed response was received.");
    return { text: full, usage };
  },
};

// Antigravity tool steps -> activity steps.
function agyStep(su) {
  const name = su.tool_name || su.tool_info?.name || "tool";
  const p = su.tool_info?.parameters || {};
  const file = p.Path || p.TargetFile || p.AbsolutePath || p.path || "";
  if (/write|replace|edit|create_file/i.test(name)) return { type: "step", icon: "✏️", text: file };
  if (/run_command|shell|terminal/i.test(name)) return { type: "step", icon: "▶", text: p.CommandLine || p.Command || p.command || "" };
  if (/search_web|web_search/i.test(name)) return { type: "step", icon: "🔎", text: p.query || p.Query || "" };
  return { type: "step", icon: "🔧", text: `${name.replace(/_/g, " ")} ${file || p.Query || p.Pattern || ""}`.trim() };
}
