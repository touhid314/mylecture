// Account quotas, never inferred from local token counts.
import { runCapture } from "./engines/cli-util.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const unavailable = message => ({ available: false, groups: [], message });
const remaining = used => typeof used === "number" && Number.isFinite(used) ? Math.max(0, Math.min(100, 100 - used)) : null;
const resetTime = value => value && Number.isFinite(Date.parse(value)) ? value : null;
const windowLabel = minutes => !minutes ? "Limit" : minutes <= 360 ? `${Math.round(minutes / 60)}h` : minutes >= 10000 ? "weekly" : `${Math.round(minutes / 1440)}d`;

// Provider-reported snapshots from Codex's own session events, never local token estimates.
export function parseCodexUsage(text, measuredAt) {
  for (const line of text.split(/\r?\n/).reverse()) {
    if (!line.includes('"rate_limits"')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const limits = event?.payload?.rate_limits ?? event?.rate_limits;
    if (!limits || typeof limits !== "object") continue;
    const buckets = ["primary", "secondary"].flatMap(id => {
      const limit = limits[id];
      if (remaining(limit?.used_percent) === null) return [];
      const reset = typeof limit.resets_at === "number" && Number.isFinite(limit.resets_at)
        ? new Date(limit.resets_at * 1000) : null;
      return [{ id, name: windowLabel(limit.window_minutes), window: windowLabel(limit.window_minutes),
        remaining: remaining(limit.used_percent), resetsAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null }];
    });
    if (buckets.length) return { available: true, groups: [{ name: "GPT", buckets }],
      description: "Limits reported by your GPT subscription; refreshes after each run.",
      measuredAt: event.timestamp || measuredAt, checkedAt: new Date().toISOString() };
  }
  return unavailable("No limits reported yet. Make a video with GPT, then refresh.");
}

async function* sessionFiles(dir, depth = 4) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const files = await Promise.all(entries.filter(e => e.isFile() && e.name.endsWith(".jsonl")).map(async e => {
    const file = path.join(dir, e.name);
    return { file, mtime: (await fs.stat(file)).mtimeMs };
  }));
  for (const file of files.sort((a, b) => b.mtime - a.mtime)) yield file;
  if (depth > 0) for (const entry of entries.filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    yield* sessionFiles(path.join(dir, entry.name), depth - 1);
  }
}

async function codexUsage(home) {
  let checked = 0;
  for await (const { file, mtime } of sessionFiles(path.join(home, "sessions"))) {
    const handle = await fs.open(file, "r");
    let parsed;
    try {
      const size = (await handle.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, 512 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size - buffer.length);
      parsed = parseCodexUsage(buffer.subarray(0, bytesRead).toString("utf8"), new Date(mtime).toISOString());
    } finally { await handle.close(); }
    if (parsed.available) return parsed;
    if (++checked >= 30) break;
  }
  return unavailable("No limits reported yet. Make a video with GPT, then refresh.");
}

export function parseClaudeUsage(data) {
  const buckets = [];
  if (Array.isArray(data?.limits) && data.limits.length) {
    for (const limit of data.limits) {
      if (remaining(limit?.percent) === null) continue;
      const window = limit.kind === "session" ? "5h" : limit.kind === "weekly" ? "weekly" : String(limit.kind || "limit").replaceAll("_", " ");
      buckets.push({ name: window, window, remaining: remaining(limit.percent), resetsAt: resetTime(limit.resets_at) });
    }
  } else {
    for (const [key, name, window] of [["five_hour", "5h", "5h"], ["seven_day", "Weekly", "weekly"],
      ["seven_day_opus", "Weekly (Opus)", "weekly"], ["seven_day_sonnet", "Weekly (Sonnet)", "weekly"]]) {
      const limit = data?.[key];
      if (remaining(limit?.utilization) === null) continue;
      buckets.push({ name, window, remaining: remaining(limit.utilization), resetsAt: resetTime(limit.resets_at) });
    }
  }
  return buckets.length ? { available: true, groups: [{ name: "Claude", buckets }], checkedAt: new Date().toISOString() }
    : unavailable("Claude did not report account limits for this login.");
}

async function claudeUsage(home, fetchUsage) {
  let oauth;
  try { oauth = JSON.parse(await fs.readFile(path.join(home, ".credentials.json"), "utf8"))?.claudeAiOauth; }
  catch { return unavailable("Claude login is unavailable. Sign in using Claude, then refresh."); }
  if (!oauth?.accessToken) return unavailable("Claude subscription login is required; API keys do not provide subscription limits.");
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) return unavailable("Claude login has expired. Sign in using Claude, then refresh.");
  // Never renew via an inference call. This is the read-only endpoint used by /usage.
  let response;
  try {
    response = await fetchUsage("https://api.anthropic.com/api/oauth/usage", {
      method: "GET", headers: { Authorization: `Bearer ${oauth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(15000),
    });
  } catch { return unavailable("Could not connect to Claude account limits. Check your connection, then refresh."); }
  if (!response.ok) return unavailable(`Claude account limits unavailable (HTTP ${response.status}).${response.status === 429 ? " Try again in ten minutes." : " Check your Claude sign-in."}`);
  try { return parseClaudeUsage(await response.json()); }
  catch { return unavailable("Could not read the Claude account limits response."); }
}

export function parseAntigravityUsage(result) {
  if (result.status !== "SUCCESS" || result.command?.name !== "usage" || !Array.isArray(result.command.data?.groups)) {
    throw new Error("Gemini did not report account limits. Check that you are signed in.");
  }
  const groups = result.command.data.groups.map((g) => ({
    name: String(g.name || "Models"),
    description: String(g.description || ""),
    buckets: (g.buckets || []).map((b) => ({
      id: b.id,
      name: String(b.name || "Usage limit"),
      window: b.window,
      remaining: typeof b.remaining_fraction === "number" && Number.isFinite(b.remaining_fraction)
        ? Math.max(0, Math.min(1, b.remaining_fraction)) * 100 : null,
      resetsAt: b.reset_time && Number.isFinite(Date.parse(b.reset_time)) ? b.reset_time : null,
    })),
  }));
  return { available: true, groups, description: result.command.data.description || "", checkedAt: new Date().toISOString() };
}

export function createUsageService(engines, capture = runCapture, options = {}) {
  const pending = new Map();
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const claudeHome = options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const fetchUsage = options.fetch ?? globalThis.fetch;
  let claudeCached, claudeRefreshAt = 0;
  return function usage(id) {
    if (pending.has(id)) return pending.get(id);
    const request = (async () => {
      if (!["antigravity", "codex", "claude-code"].includes(id)) return unavailable("Account limits are not available for API keys. Check your provider's usage page.");
      try {
        if (id === "codex") return await codexUsage(codexHome);
        if (id === "claude-code") {
          if (claudeCached && Date.now() < claudeRefreshAt) return claudeCached;
          claudeCached = await claudeUsage(claudeHome, fetchUsage);
          claudeRefreshAt = Date.now() + (claudeCached.message?.includes("HTTP 429") ? 600000
            : claudeCached.available || claudeCached.message?.includes("HTTP") ? 120000 : 0);
          return claudeCached;
        }
        const exe = engines.get(id).exe();
        if (!exe) throw new Error("Gemini is not connected. Connect it to see account limits.");
        const r = await capture(exe, ["-p", "/usage", "--output-format", "json"], { timeout: 20000 });
        if (!r.ok) throw new Error("Could not read Gemini limits. Check your connection and sign-in, then refresh.");
        return parseAntigravityUsage(JSON.parse(r.stdout));
      } catch (error) {
        return { available: false, groups: [], message: error instanceof SyntaxError
          ? "Could not read the usage response. Refresh to try again."
          : id === "codex" ? "Could not read GPT limits. Refresh to try again." : error.message };
      }
    })();
    pending.set(id, request);
    request.finally(() => pending.delete(id));
    return request;
  };
}
