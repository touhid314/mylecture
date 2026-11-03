// Read provider metadata through the installed CLIs. No inference/user turn is
// sent for discovery, and missing capabilities stay unknown rather than guessed.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { scratchDir, killTree } from "./cli-util.js";

export function parseClaudeModels(response) {
  const models = response?.models || response?.supported_models;
  if (!Array.isArray(models) || !models.length) throw new Error("Claude Code did not advertise any models in its initialize response. Update or sign in to the original CLI and refresh.");
  return models.filter(m => typeof (m.value || m.id) === "string").map(m => ({
    id: m.value || m.id,
    label: m.displayName || m.display_name || m.value || m.id,
    resolvedModel: m.resolvedModel || m.id,
    description: m.description || "",
    efforts: m.supportsEffort === false ? [] : (Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter(x => typeof x === "string") : []),
    ...(typeof m.defaultEffort === "string" ? { defaultEffort: m.defaultEffort } : {}),
    isDefault: m.value === "default" || m.isDefault === true,
    source: "Claude Code initialize",
    ...(typeof m.supportsAdaptiveThinking === "boolean" ? { supportsAdaptiveThinking: m.supportsAdaptiveThinking } : {}),
    ...(typeof m.supportsThinkingOff === "boolean" ? { supportsThinkingOff: m.supportsThinkingOff } : {}),
  }));
}

export function discoverClaudeModels(exe, { timeout = 30000, spawnProcess = spawn, stopProcess = killTree } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(exe, [
      "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--no-session-persistence", "--disable-slash-commands",
      "--settings", JSON.stringify({ disableAllHooks: true }),
      "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
    ], { cwd: scratchDir("claude-models"), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const requestId = randomUUID();
    let settled = false, buffer = "";
    const finish = (error, models) => {
      if (settled) return;
      settled = true; clearTimeout(timer); stopProcess(child);
      error ? reject(error) : resolve(models);
    };
    const timer = setTimeout(() => finish(new Error("Claude Code model discovery timed out. Sign in through the original CLI and refresh.")), timeout);
    child.on("error", e => finish(new Error(`Claude Code discovery: ${e.message}`)));
    child.on("close", code => finish(new Error(`Claude Code exited (${code}) before reporting its model capabilities.`)));
    child.stdin.on("error", e => finish(new Error(`Claude Code discovery connection failed: ${e.message}`)));
    // Ignore hook/account/system logs: only model metadata crosses into the UI.
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type !== "control_response" || event.response?.request_id !== requestId) continue;
        const result = event.response;
        if (result.subtype !== "success") return finish(new Error(`Claude Code initialization failed: ${result.error || "unknown error"}`));
        try { finish(null, parseClaudeModels(result.response)); } catch (e) { finish(e); }
      }
    });
    // This is a control request, never a user prompt or a billable model turn.
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } }) + "\n");
  });
}

export function parseAntigravityModels(stdout) {
  const models = stdout.split(/\r?\n/).map(line => line.split("\t"))
    .filter(parts => parts.length >= 2 && parts[0].trim() && !parts[0].startsWith("Fetching"))
    .map(([id, label]) => ({ id: id.trim(), label: label.trim() }));
  if (!models.length) throw new Error("Antigravity CLI returned no available models. Sign in through agy and refresh.");
  const groups = new Map();
  const parsed = models.map(model => {
    // The CLI advertises effort in both the display suffix and model ID.
    // Derive levels from those actual entries instead of a fixed level list.
    const label = model.label.match(/\(([^()]+)\)\s*$/)?.[1];
    const level = label?.trim().toLowerCase().replace(/\s+/g, "-");
    const suffix = level && "-" + level;
    const effort = suffix && model.id.endsWith(suffix) ? level : undefined;
    const baseModel = effort ? model.id.slice(0, -suffix.length) : model.id;
    if (effort) {
      if (!groups.has(baseModel)) groups.set(baseModel, []);
      groups.get(baseModel).push({ level: effort, model: model.id });
    }
    return { ...model, baseModel, ...(effort ? { effort } : {}) };
  });
  return parsed.map(model => ({
    ...model,
    efforts: (groups.get(model.baseModel) || []).map(x => x.level),
    effortVariants: groups.get(model.baseModel) || [],
    source: "Antigravity CLI models",
  }));
}
