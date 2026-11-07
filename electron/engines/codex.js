// OpenAI Codex CLI engine (uses the user's ChatGPT login).
// `codex exec --json` only reports whole messages, so we speak the
// app-server JSON-RPC protocol over stdio, which streams token deltas.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExecutable, scratchDir, runCapture, killTree, idleStatus } from "./cli-util.js";
import { log } from "../logger.js";
import { BROWSER_NOTE, codexMcpConfig } from "./browser-mcp.js";

// The signed-in ChatGPT account (email, plan) from the saved sign-in's ID token.
export function codexAccount(home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")) {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8"));
    const claims = JSON.parse(Buffer.from(String(auth.tokens?.id_token || "").split(".")[1] || "", "base64url").toString("utf8"));
    const plan = claims["https://api.openai.com/auth"]?.chatgpt_plan_type;
    return claims.email ? { email: claims.email, plan: plan ? `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : "" } : null;
  } catch {
    return null;
  }
}

// Plain tokens (no quotes or spaces) so they survive the .cmd shim's shell;
// a value that is not valid TOML ("live") is taken as a literal string.
export const AGENT_CONFIG = ["web_search=live"];

// Agent runs use Codex's full-access mode (no sandbox) so the agent can
// install and run any tool. The project-folder rule for its own files is an
// instruction, as with Claude and Gemini.
export const CODEX_AGENT_NOTE = `You have full access to this computer: shell, internet, package installs (pip, npm, winget, …) and a real web browser. You may read and copy files from anywhere. Every file you create, download, copy, edit or delete yourself must be inside the current project folder; never put your own files anywhere else. Installing tools or packages is allowed, and so are the caches, temp files and install folders those tools write to on their own. ${BROWSER_NOTE}`;

export function agentConfigArgs(workspace = "") {
  return [...AGENT_CONFIG, ...(workspace ? codexMcpConfig(workspace) : [])].flatMap((c) => ["-c", c]);
}

export const codex = {
  id: "codex",
  name: "GPT",
  kind: "cli",
  defaultModel: "",
  installHint: "Connect your GPT subscription from the welcome screen or Settings.",

  exe() {
    return findExecutable(["codex"]);
  },

  async status() {
    const exe = this.exe();
    if (!exe) return { installed: false, ready: false, message: "Not set up yet" };
    const v = await runCapture(exe, ["--version"], { timeout: 15000 });
    const l = await runCapture(exe, ["login", "status"], { timeout: 15000 });
    const text = (l.stdout + l.stderr).trim();
    const loggedIn = l.ok && !/not logged in/i.test(text);
    const account = loggedIn ? codexAccount() : null;
    return { installed: true, ready: loggedIn, version: v.stdout.trim(), path: exe, account, message: loggedIn ? "Signed in" : "Not signed in" };
  },

  async models() {
    const exe = this.exe();
    if (!exe) throw new Error("GPT isn't connected. Connect it from the welcome screen or Settings.");
    return new Promise((resolve, reject) => {
      const isShim = /\.(cmd|bat)$/i.test(exe);
      const child = isShim
        ? spawn(`"${exe}" app-server`, { shell: true, windowsHide: true, cwd: scratchDir("codex") })
        : spawn(exe, ["app-server"], { windowsHide: true, cwd: scratchDir("codex") });
      let done = false, buffer = "";
      const finish = (error, models) => {
        if (done) return;
        done = true; clearTimeout(timer); killTree(child);
        error ? reject(error) : resolve(models);
      };
      const timer = setTimeout(() => finish(new Error("GPT model list timed out")), 30000);
      const send = value => child.stdin.write(JSON.stringify(value) + "\n");
      child.on("error", e => finish(e));
      child.on("close", () => finish(new Error("GPT closed before returning models")));
      child.stdin.on("error", e => finish(e));
      child.stderr.resume();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        buffer += chunk;
        const lines = buffer.split("\n"); buffer = lines.pop();
        for (const line of lines) {
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.error) return finish(new Error(m.error.message));
          if (m.id === 1) { send({ method: "initialized" }); send({ id: 2, method: "model/list", params: { limit: 100 } }); }
          if (m.id === 2) return finish(null, (m.result?.data || []).filter(x => !x.hidden).map(x => ({
            id: x.model || x.id, label: x.displayName || x.model || x.id,
            efforts: (x.supportedReasoningEfforts || []).map(e => e.reasoningEffort),
            defaultEffort: x.defaultReasoningEffort, isDefault: x.isDefault, source: "GPT",
          })));
        }
      });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "mylecture-models", version: "0.1.0" } } });
    });
  },

  // Agent mode: the same turn, but working in `workspace` with write access.
  agent(opts) {
    return this.generate(opts);
  },

  generate({ system, user, model, effort = "low", signal, onDelta, onStatus, onActivity, onModel, workspace, inbox, images = [] }) {
    const exe = this.exe();
    const cwd = workspace || scratchDir("codex");
    if (!exe) return Promise.reject(new Error("GPT isn't connected. Connect it from the welcome screen or Settings."));
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const isShim = /\.(cmd|bat)$/i.test(exe);
      // Agent runs: full access (no sandbox), live web search and the browser.
      const serverArgs = ["app-server", ...(workspace ? agentConfigArgs(workspace) : [])];
      const child = isShim
        ? spawn(`"${exe}" ${serverArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`, { shell: true, windowsHide: true, cwd })
        : spawn(exe, serverArgs, { windowsHide: true, cwd });
      let buf = "";
      let full = "";
      let done = false;
      // Mid-run messages: added to the running turn with turn/steer (as Super Agent does).
      let threadId = null, turnId = null, nextId = 100, detach = null;
      if (inbox) detach = inbox.attach((text) => {
        if (done || !threadId || !turnId) return false;
        send({ id: nextId++, method: "turn/steer", params: { threadId, expectedTurnId: turnId, input: [{ type: "text", text, text_elements: [] }] } });
        log("info", "provider.inject", { provider: "codex", chars: text.length });
        return true;
      });
      let stderr = "";
      let lastOutputAt = startedAt, stdoutBytes = 0, stderrBytes = 0, lastProgressAt = 0;
      log("info", "provider.start", { provider: "codex", model, effort, agent: !!workspace, pid: child.pid });
      const heartbeat = setInterval(() => {
        const idleMs = Date.now() - lastOutputAt;
        log("info", "provider.heartbeat", { provider: "codex", pid: child.pid, elapsedMs: Date.now() - startedAt, idleMs, stdoutBytes, stderrBytes });
        if (idleMs >= 45000) onStatus?.(idleStatus(idleMs));
      }, 15000);
      heartbeat.unref?.();
      const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
      const finish = (err, val) => {
        if (done) return;
        done = true;
        detach?.();
        clearInterval(heartbeat);
        signal?.removeEventListener("abort", aborted);
        log(err ? "error" : "info", "provider.finish", { provider: "codex", pid: child.pid, elapsedMs: Date.now() - startedAt, aborted: !!val?.aborted, outputBytes: Buffer.byteLength(full), error: err });
        kill();
        err ? reject(err) : resolve(val);
      };
      const kill = () => {
        if (process.platform === "win32" && child.pid) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
        else child.kill();
      };
      const aborted = () => finish(null, { text: full, aborted: true });
      signal?.addEventListener("abort", aborted, { once: true });
      child.stderr.on("data", (d) => {
        lastOutputAt = Date.now(); stderrBytes += Buffer.byteLength(d);
        stderr = (stderr + d).slice(-65536);
        log("warn", "provider.stderr", { provider: "codex", pid: child.pid, totalBytes: stderrBytes });
      });
      child.on("error", (e) => finish(e));
      child.on("close", (code) => {
        log("info", "provider.exit", { provider: "codex", pid: child.pid, code, elapsedMs: Date.now() - startedAt });
        if (!done) finish(full ? null : new Error(`GPT stopped unexpectedly (${code}): ${stderr.slice(-400)}`), { text: full });
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => {
        lastOutputAt = Date.now(); stdoutBytes += Buffer.byteLength(d);
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          let m;
          try {
            m = JSON.parse(line);
          } catch {
            continue;
          }
          if (m.method && (!/delta$/.test(m.method) || Date.now() - lastProgressAt >= 5000)) {
            lastProgressAt = Date.now();
            log("info", "provider.event", { provider: "codex", type: m.method, itemType: m.params?.item?.type, elapsedMs: Date.now() - startedAt, outputBytes: Buffer.byteLength(full) });
          }
          if (m.id === 1) {
            if (m.error) return finish(new Error("GPT: " + (m.error.message || JSON.stringify(m.error))));
            send({ method: "initialized" });
            const params = {
              cwd,
              sandbox: workspace ? "danger-full-access" : "read-only",
              approvalPolicy: "never",
              developerInstructions: workspace ? `${system}\n\n${CODEX_AGENT_NOTE}` : system,
            };
            if (model) params.model = model;
            send({ id: 2, method: "thread/start", params });
          } else if (m.id === 2) {
            if (m.error) return finish(new Error("GPT: " + (m.error.message || JSON.stringify(m.error))));
            threadId = m.result.thread.id;
            if (m.result.model) onModel?.(String(m.result.model));
            // Pictures go in as local image files.
            const pics = images.filter((i) => /^image\/(png|jpeg|webp|gif)$/.test(i?.mime || "") && i.path).slice(0, 6);
            const tp = { threadId, input: [{ type: "text", text: user }, ...pics.map((i) => ({ type: "localImage", path: i.path }))] };
            if (effort) tp.effort = effort;
            send({ id: 3, method: "turn/start", params: tp });
          } else if (m.id === 3 && m.error) {
            return finish(new Error("GPT: " + (m.error.message || JSON.stringify(m.error))));
          } else if (m.id === 3) {
            turnId = m.result?.turn?.id || null;
          } else if (m.id >= 100 && m.error) {
            log("warn", "provider.injectFailed", { provider: "codex", message: m.error.message || JSON.stringify(m.error) });
          } else if (m.method === "item/agentMessage/delta") {
            const dlt = m.params?.delta || "";
            full += dlt;
            if (dlt) onDelta(dlt);
            if (dlt) onActivity?.({ type: "say", id: m.params?.itemId || "msg", delta: dlt });
          } else if (m.method === "item/started" && m.params?.item?.type && !/Message$/.test(m.params.item.type)) {
            const item = m.params.item;
            const files = (item.changes || []).map((c) => c.path).filter(Boolean);
            onStatus?.(files.length ? `agent: editing ${files.map((f) => f.split(/[\/]/).pop()).join(", ")}` : `agent: ${item.type}`);
            const step = codexStep(item, files);
            if (step) onActivity?.(step);
          } else if (m.method === "error") {
            return finish(new Error("GPT: " + (m.params?.error?.message || JSON.stringify(m.params))));
          } else if (m.method === "turn/completed") {
            const t = m.params?.turn;
            if (t?.status === "failed" && !full) return finish(new Error("GPT: " + (t.error?.message || "turn failed")));
            return finish(null, { text: full });
          }
        }
      });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "mylecture", version: "0.1.0" } } });
    });
  },
};

// Codex app-server items -> activity steps (Codex-style: thinking, ran, edited, searched, tool).
function codexStep(item, files) {
  switch (item.type) {
    case "reasoning":
      return { type: "step", icon: "💭", text: "thinking" };
    case "commandExecution":
      return { type: "step", icon: "▶", text: String(item.command || "").replace(/^.*?powershell(?:\.exe)?"?\s+-Command\s+/i, "").replace(/^"(.*)"$/, "$1") };
    case "fileChange":
      return { type: "step", icon: "✏️", text: files.join(", ") };
    case "webSearch":
      return { type: "step", icon: "🔎", text: item.query || "" };
    case "mcpToolCall":
      return { type: "step", icon: "🔧", text: `${item.tool || "tool"}` };
    default:
      return null;
  }
}
