// Hermes Agent (Nous Research, https://hermes-agent.nousresearch.com) runs the
// agent flow for "Use with API key": it works in the video's project folder
// with its own tools (terminal, files, web, browser...) against the user's
// API provider, the same way the Claude/Codex/Gemini CLIs do.
//
// MyLecture runs Hermes in its own profile ("mylecture"), separate from the
// user's own Hermes setup, with self-improvement switched off: no memory, no
// automatic post-turn review (which writes memory and skills), no skills
// toolset, no bundled skills and the skill curator paused. (HERMES_HOME cannot
// be used for this: it also locates the installed Hermes environment.)
// Each run is one-shot:
//   hermes -p mylecture chat --format stream-json --query-file - --oneshot
//          --yolo --provider custom --base-url <url> --api-key <key> -m <model>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExecutable, spawnLines, runCapture, idleStatus } from "./cli-util.js";
import { log, registerLogSecret } from "../logger.js";

export const HERMES_INSTALL = {
  win32: "irm https://hermes-agent.nousresearch.com/install.ps1 | iex",
  posix: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
};

export function hermesDirs(env = process.env, home = os.homedir()) {
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  return [path.join(local, "hermes", "bin"), path.join(home, ".hermes", "bin"), path.join(home, ".local", "bin")];
}

export const HERMES_PROFILE = "mylecture";

export function hermesProfileDir(env = process.env, home = os.homedir(), platform = process.platform) {
  const root = platform === "win32" ? path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "hermes") : path.join(home, ".hermes");
  return path.join(root, "profiles", HERMES_PROFILE);
}

export function hermesExe() {
  return findExecutable(["hermes"], hermesDirs());
}

// OpenAI-compatible endpoint for each API provider MyLecture supports.
export function hermesEndpoint(config = {}) {
  const base = {
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
  }[config.provider] || config.baseUrl || "";
  return { baseUrl: String(base).replace(/\/+$/, ""), apiKey: config.apiKey || "" };
}

// Hermes settings for MyLecture runs: no memory, no self-review, no skill
// writing; tools that do not fit a headless video job are off.
export const HERMES_CONFIG = `# Written by MyLecture for its own Hermes profile; edits are overwritten.
memory:
  memory_enabled: false
  user_profile_enabled: false
auxiliary:
  background_review:
    enabled: false
skills:
  write_approval: true
agent:
  disabled_toolsets: [memory, skills, session_search, cronjob, messaging, discord, discord_admin, clarify, tts]
`;

// Writes MyLecture's settings into the profile, keeping Hermes's own
// _config_version line so Hermes does not re-run its config migrations.
export function writeHermesConfig(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "config.yaml");
  const version = /^_config_version:.*$/m.exec(readText(file) || "")?.[0];
  const want = HERMES_CONFIG + (version ? version + "\n" : "");
  if (readText(file) !== want) fs.writeFileSync(file, want, "utf8");
  // No bundled skills either (same as `hermes skills opt-out`).
  const optOut = path.join(dir, ".no-bundled-skills");
  if (!fs.existsSync(optOut)) fs.writeFileSync(optOut, "", "utf8");
  return dir;
}

// Creates the profile once (blank: no skills, no wrapper alias), pauses the
// skill curator, and (re)writes MyLecture's settings.
let profileReady = null;
export function ensureHermesProfile(exe, dir = hermesProfileDir()) {
  profileReady ||= (async () => {
    if (!fs.existsSync(path.join(dir, "config.yaml"))) {
      const r = await runCapture(exe, ["profile", "create", HERMES_PROFILE, "--no-skills", "--no-alias", "--description", "MyLecture video agent (API key mode)"], { timeout: 120000 });
      if (!r.ok && !fs.existsSync(dir)) throw new Error(`Could not set up Hermes for MyLecture: ${String(r.stderr || r.stdout).trim().slice(-300)}`);
      await runCapture(exe, ["-p", HERMES_PROFILE, "curator", "pause"], { timeout: 60000 });
    }
    writeHermesConfig(dir);
    return dir;
  })().catch((e) => { profileReady = null; throw e; });
  return profileReady;
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

export function hermesArgs({ baseUrl, apiKey, model, maxTurns = 200 }) {
  return [
    "-p", HERMES_PROFILE, "chat", "--format", "stream-json", "--query-file", "-", "--oneshot",
    "--yolo", "--ignore-rules", "--max-turns", String(maxTurns),
    "--provider", "custom", "--base-url", baseUrl, ...(apiKey ? ["--api-key", apiKey] : []),
    ...(model ? ["-m", model] : []),
  ];
}

// Hermes tool calls -> activity steps.
function hermesStep(name, input = {}) {
  const file = input.path || input.file_path || input.filename || "";
  if (/write|patch|edit/i.test(name)) return { type: "step", icon: "✏️", text: file || name };
  if (/terminal|shell|exec|command/i.test(name)) return { type: "step", icon: "▶", text: input.command || input.cmd || name };
  if (/search/i.test(name) && !/session/i.test(name)) return { type: "step", icon: "🔎", text: input.query || name };
  if (/read/i.test(name)) return { type: "step", icon: "🔧", text: `read ${file}`.trim() };
  return { type: "step", icon: "🔧", text: `${name} ${file}`.trim() };
}

// One agent task in `workspace`. Returns { text } (the final reply).
export async function runHermes({ exe = hermesExe(), profileDir, system, user, model, config, workspace, signal, onDelta, onStatus, onActivity }) {
  if (!exe) throw new Error("Hermes Agent isn't installed. Install it in Settings → AI engines & voices, then try again.");
  const { baseUrl, apiKey } = hermesEndpoint(config);
  if (!baseUrl) throw new Error("Add your API provider in Settings first.");
  registerLogSecret(apiKey);
  await ensureHermesProfile(exe, profileDir);
  const env = {
    ...process.env,
    // Hard-blocks Hermes's file writes outside the project folder.
    HERMES_WRITE_SAFE_ROOT: workspace,
    HERMES_YOLO_MODE: "1",
    PYTHONIOENCODING: "utf-8",
    NO_COLOR: "1",
  };
  let full = "", result = null, msg = 0;
  const startedAt = Date.now();
  log("info", "provider.start", { provider: "hermes", model, agent: true });
  const res = await spawnLines(exe, hermesArgs({ baseUrl, apiKey, model }), {
    cwd: workspace,
    env,
    stdin: `${system}\n\n---\n\n${user}`,
    signal,
    onIdle: ({ idleMs }) => onStatus?.(idleStatus(idleMs)),
    onLine(line) {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === "text" && ev.text) {
        full += ev.text;
        onDelta?.(ev.text);
        onActivity?.({ type: "say", id: `h${msg}`, delta: ev.text });
      } else if (ev.type === "tool_use") {
        msg++;
        log("info", "provider.tool", { provider: "hermes", tool: ev.name });
        onStatus?.(`agent: ${ev.name}`);
        onActivity?.(hermesStep(String(ev.name || "tool"), ev.input || {}));
      } else if (ev.type === "result") {
        result = ev;
      }
    },
  });
  log("info", "provider.finish", { provider: "hermes", code: res.code, aborted: !!res.aborted, elapsedMs: Date.now() - startedAt, exitCode: result?.exit_code });
  if (res.aborted) return { text: full, aborted: true };
  if (result?.error && !full) throw new Error(`Hermes: ${String(result.error).slice(0, 400)}`);
  if (res.code !== 0 && !full && !result?.text) throw new Error(`Hermes stopped unexpectedly (${res.code}): ${String(res.stderr || "").slice(-400)}`);
  return { text: result?.text || full };
}
