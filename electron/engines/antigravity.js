// Google Antigravity CLI ("agy") engine.
// Uses print mode with NDJSON in/out: the prompt goes in over stdin (no
// command-line length limit) and text deltas stream back line by line.
import os from "node:os";
import path from "node:path";
import { findExecutable, scratchDir, spawnLines, runCapture } from "./cli-util.js";
import fs from "node:fs";
import { parseAntigravityModels } from "./model-discovery.js";

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

  async generate({ system, user, model, effort, signal, onDelta, onStatus, onActivity, workspace }) {
    const exe = this.exe();
    if (!exe) throw new Error("Gemini isn't connected. Connect it from the welcome screen or Settings.");
    const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"];
    if (workspace) args.push("--mode", "accept-edits");
    if (model) args.push("--model", model);
    if (workspace && effort) args.push("--effort", effort);
    args.push("-p", "");
    const content = `${system}\n\n---\n\n${user}`;
    const stdin = JSON.stringify({ event: "user", message: { role: "user", content } }) + "\n";
    let full = "";
    let error = null;
    let usage = null;
    const res = await spawnLines(exe, args, {
      cwd: workspace || scratchDir("antigravity"),
      stdin,
      signal,
      onLine(line) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.event === "step_update") {
          const su = ev.step_update || {};
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
          if (r.status && r.status !== "SUCCESS") error = r.error || r.status;
          if (r.usage) usage = r.usage;
          // If deltas were missed, fall back to the full response.
          if (!full && r.response) {
            full = r.response;
            onDelta(r.response);
          }
        }
      },
    });
    if (res.aborted) return { text: full, aborted: true };
    if (error) throw new Error(`Gemini: ${error}`);
    if (res.code !== 0 && !full) throw new Error(`Gemini stopped unexpectedly (${res.code}): ${res.stderr.slice(-500)}`);
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
