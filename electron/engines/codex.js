// OpenAI Codex CLI engine (uses the user's ChatGPT login).
// `codex exec --json` only reports whole messages, so we speak the
// app-server JSON-RPC protocol over stdio, which streams token deltas.
import { spawn, execFile } from "node:child_process";
import { findExecutable, scratchDir, runCapture, killTree } from "./cli-util.js";

export const codex = {
  id: "codex",
  name: "Codex",
  kind: "cli",
  defaultModel: "",
  installHint: "Install with `npm i -g @openai/codex`, then run `codex login`.",

  exe() {
    return findExecutable(["codex"]);
  },

  async status() {
    const exe = this.exe();
    if (!exe) return { installed: false, ready: false, message: "codex not found on PATH" };
    const v = await runCapture(exe, ["--version"], { timeout: 15000 });
    const l = await runCapture(exe, ["login", "status"], { timeout: 15000 });
    const text = (l.stdout + l.stderr).trim();
    const loggedIn = l.ok && !/not logged in/i.test(text);
    return { installed: true, ready: loggedIn, version: v.stdout.trim(), path: exe, message: loggedIn ? text || "Logged in" : "Run `codex login` in a terminal" };
  },

  async models() {
    const exe = this.exe();
    if (!exe) throw new Error("Codex CLI is not installed or not on PATH.");
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
      const timer = setTimeout(() => finish(new Error("Codex model list timed out")), 30000);
      const send = value => child.stdin.write(JSON.stringify(value) + "\n");
      child.on("error", e => finish(e));
      child.on("close", () => finish(new Error("Codex closed before returning models")));
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
            defaultEffort: x.defaultReasoningEffort, isDefault: x.isDefault, source: "Codex app-server model/list",
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

  generate({ system, user, model, effort = "low", signal, onDelta, onStatus, onActivity, workspace }) {
    const exe = this.exe();
    const cwd = workspace || scratchDir("codex");
    if (!exe) return Promise.reject(new Error("Codex CLI is not installed or not on PATH."));
    return new Promise((resolve, reject) => {
      const isShim = /\.(cmd|bat)$/i.test(exe);
      const child = isShim
        ? spawn(`"${exe}" app-server`, { shell: true, windowsHide: true, cwd })
        : spawn(exe, ["app-server"], { windowsHide: true, cwd });
      let buf = "";
      let full = "";
      let done = false;
      let stderr = "";
      const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
      const finish = (err, val) => {
        if (done) return;
        done = true;
        kill();
        err ? reject(err) : resolve(val);
      };
      const kill = () => {
        if (process.platform === "win32" && child.pid) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
        else child.kill();
      };
      signal?.addEventListener("abort", () => finish(null, { text: full, aborted: true }), { once: true });
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => finish(e));
      child.on("close", (code) => {
        if (!done) finish(full ? null : new Error(`Codex app-server exited (${code}): ${stderr.slice(-400)}`), { text: full });
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => {
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
          if (m.id === 1) {
            if (m.error) return finish(new Error("Codex: " + (m.error.message || JSON.stringify(m.error))));
            send({ method: "initialized" });
            const params = {
              cwd,
              sandbox: workspace ? "workspace-write" : "read-only",
              approvalPolicy: "never",
              developerInstructions: system,
            };
            if (model) params.model = model;
            send({ id: 2, method: "thread/start", params });
          } else if (m.id === 2) {
            if (m.error) return finish(new Error("Codex: " + (m.error.message || JSON.stringify(m.error))));
            const tp = { threadId: m.result.thread.id, input: [{ type: "text", text: user }] };
            if (effort) tp.effort = effort;
            send({ id: 3, method: "turn/start", params: tp });
          } else if (m.id === 3 && m.error) {
            return finish(new Error("Codex: " + (m.error.message || JSON.stringify(m.error))));
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
            return finish(new Error("Codex: " + (m.params?.error?.message || JSON.stringify(m.params))));
          } else if (m.method === "turn/completed") {
            const t = m.params?.turn;
            if (t?.status === "failed" && !full) return finish(new Error("Codex: " + (t.error?.message || "turn failed")));
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
