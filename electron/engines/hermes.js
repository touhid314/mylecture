// Hermes Agent (Nous Research, https://hermes-agent.nousresearch.com) runs the
// agent flow for "Use with API key": it works in the video's project folder
// with its own tools (terminal, files, web, browser...) against the user's
// API provider, the same way the Claude/Codex/Gemini CLIs do.
//
// MyLecture installs its own copy (electron/components.js): the pinned release
// source, and Python 3.14 plus Hermes's locked packages through uv, under
// <userData>/tools/hermes:
//   src/   release source        env/   Python environment (hermes executable)
//   home/  HERMES_HOME: MyLecture's own config, separate from any Hermes the
//          user runs themselves.
// Self-improvement is off: no memory, no automatic post-turn review (which
// writes memory and skills), no skills toolset, no bundled skills, and the
// skill curator paused. Each run is one-shot:
//   hermes chat --format stream-json --query-file - --oneshot --yolo
//          --provider custom --base-url <url> --api-key <key> -m <model>
import fs from "node:fs";
import path from "node:path";
import { spawnLines, runCapture, idleStatus } from "./cli-util.js";
import { log, registerLogSecret } from "../logger.js";

export const HERMES_VERSION = "0.23.0";
export const HERMES_SOURCE_URL = `https://github.com/NousResearch/hermes-agent/archive/refs/tags/v${HERMES_VERSION}.zip`;
// Hermes supports only Python 3.14 (its pyproject: "we *only* support 3.14").
export const HERMES_PYTHON = "3.14";

export function hermesPaths(toolsDir, platform = process.platform) {
  const root = path.join(toolsDir, "hermes");
  return {
    root,
    src: path.join(root, "src"),
    env: path.join(root, "env"),
    home: path.join(root, "home"),
    exe: path.join(root, "env", platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "hermes.exe" : "hermes"),
    marker: path.join(root, "installed.json"),
  };
}

// Set by the main process: <userData>/tools.
let toolsDir = "";
export function setHermesToolsDir(dir) { toolsDir = dir || ""; }

// MyLecture's own Hermes, once fully installed; null otherwise.
export function hermesExe(dir = toolsDir) {
  if (!dir) return null;
  const p = hermesPaths(dir);
  return fs.existsSync(p.marker) && fs.existsSync(p.exe) ? p.exe : null;
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
export const HERMES_CONFIG = `# Written by MyLecture for its own Hermes; edits are overwritten.
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

// Writes MyLecture's settings into its Hermes home, keeping Hermes's own
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

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

// Settings written and the skill curator paused, once per home.
const homesReady = new Map();
export function prepareHermesHome(exe, home) {
  if (!homesReady.has(home)) {
    homesReady.set(home, (async () => {
      writeHermesConfig(home);
      const paused = path.join(home, ".mylecture-curator-paused");
      if (!fs.existsSync(paused)) {
        const r = await runCapture(exe, ["curator", "pause"], { timeout: 120000, env: { ...process.env, HERMES_HOME: home } });
        if (r.ok) fs.writeFileSync(paused, "", "utf8");
      }
      return home;
    })().catch((e) => { homesReady.delete(home); throw e; }));
  }
  return homesReady.get(home);
}

export function hermesArgs({ baseUrl, apiKey, model, maxTurns = 200 }) {
  return [
    "chat", "--format", "stream-json", "--query-file", "-", "--oneshot",
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
export async function runHermes({ exe = hermesExe(), home = toolsDir ? hermesPaths(toolsDir).home : "", system, user, model, config, workspace, signal, onDelta, onStatus, onActivity }) {
  if (!exe) throw new Error("Hermes Agent isn't installed. Install it in Settings → AI engines & voices, then try again.");
  const { baseUrl, apiKey } = hermesEndpoint(config);
  if (!baseUrl) throw new Error("Add your API provider in Settings first.");
  registerLogSecret(apiKey);
  await prepareHermesHome(exe, home);
  const env = {
    ...process.env,
    HERMES_HOME: home,
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
