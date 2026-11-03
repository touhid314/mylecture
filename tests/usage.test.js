import test from "node:test";
import assert from "node:assert/strict";
import { createUsageService, parseAntigravityUsage, parseCodexUsage, parseClaudeUsage } from "../electron/usage.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const response = (buckets) => ({ status: "SUCCESS", command: { name: "usage", data: { groups: [{ name: "Gemini Models", buckets }] } } });

test("account usage preserves exhausted, unknown, weekly and five-hour quotas", () => {
  const usage = parseAntigravityUsage(response([
    { name: "Weekly", window: "weekly", remaining_fraction: 0, reset_time: "2026-11-10T00:18:14Z" },
    { name: "Five hour", window: "5h", remaining_fraction: 0.9181 },
    { name: "Unknown", reset_time: "invalid" },
  ]));
  assert.equal(usage.groups[0].buckets[0].remaining, 0);
  assert.equal(usage.groups[0].buckets[0].resetsAt, "2026-11-10T00:18:14Z");
  assert.equal(usage.groups[0].buckets[1].window, "5h");
  assert.ok(Math.abs(usage.groups[0].buckets[1].remaining - 91.81) < 0.001);
  assert.equal(usage.groups[0].buckets[2].remaining, null);
  assert.equal(usage.groups[0].buckets[2].resetsAt, null);
  assert.throws(() => parseAntigravityUsage({ status: "ERROR" }));
});

test("usage requests are read-only, deduplicated, and do not substitute another engine", async () => {
  let calls = 0;
  const read = createUsageService({ get: () => ({ exe: () => "agy.exe" }) }, async (_exe, args) => {
    calls++;
    assert.deepEqual(args, ["-p", "/usage", "--output-format", "json"]);
    return { ok: true, stdout: JSON.stringify(response([])) };
  });
  const first = read("antigravity");
  assert.equal(first, read("antigravity"));
  assert.equal((await first).available, true);
  assert.equal(calls, 1);
  assert.equal((await read("api")).available, false);
  assert.equal(calls, 1);
});

test("quota failures remain unavailable and can be retried", async () => {
  let calls = 0;
  const read = createUsageService({ get: () => ({ exe: () => "agy.exe" }) }, async () => {
    calls++;
    return calls === 1 ? { ok: false } : { ok: true, stdout: JSON.stringify(response([])) };
  });
  assert.equal((await read("antigravity")).available, false);
  assert.equal((await read("antigravity")).available, true);
});

const codexEvent = (used, timestamp = "2026-11-03T08:00:00Z") => JSON.stringify({ timestamp, type: "event_msg", payload: {
  type: "token_count", rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: 1794000000 },
    secondary: { used_percent: 0, window_minutes: 10080 } },
} });

test("Codex reads the last valid provider event, preserving exhausted limits and snapshot time", () => {
  const parsed = parseCodexUsage(["partial line", codexEvent(20), codexEvent(100), '{"rate_limits":'].join("\n"));
  assert.equal(parsed.available, true);
  assert.deepEqual(parsed.groups[0].buckets.map(b => [b.window, b.remaining]), [["5h", 0], ["weekly", 100]]);
  assert.equal(parsed.groups[0].buckets[0].resetsAt, new Date(1794000000000).toISOString());
  assert.equal(parsed.groups[0].buckets[1].resetsAt, null);
  assert.equal(parsed.measuredAt, "2026-11-03T08:00:00Z");
  assert.match(parsed.description, /last Codex session/);
  assert.equal(parseCodexUsage('{"payload":{"rate_limits":{"primary":{"used_percent":"20"}}}}').available, false);
  assert.equal(parseCodexUsage("token count: 5000").available, false);
});

test("Claude supports both provider quota formats without inventing unknown limits", () => {
  const legacy = parseClaudeUsage({ five_hour: { utilization: 100, resets_at: "2026-11-05T00:00:00Z" },
    seven_day: { utilization: 22.5, resets_at: "invalid" }, seven_day_opus: { utilization: null } });
  assert.deepEqual(legacy.groups[0].buckets.map(b => b.remaining), [0, 77.5]);
  assert.equal(legacy.groups[0].buckets[1].resetsAt, null);
  const modern = parseClaudeUsage({ limits: [{ kind: "session", percent: 10 }, { kind: "weekly", percent: 130 },
    { kind: "weekly_all", percent: 19 },
    { kind: "unknown", percent: "40" }] });
  assert.deepEqual(modern.groups[0].buckets.map(b => [b.window, b.remaining]), [["5h", 90], ["weekly", 0], ["weekly all", 81]]);
  assert.equal(parseClaudeUsage({}).available, false);
  assert.equal(parseClaudeUsage(null).available, false);
});

async function accountDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mylecture-usage-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("Codex searches its configured account only and skips newer sessions without limits", async t => {
  const dir = await accountDir(t);
  const day = path.join(dir, "sessions", "2026", "11", "03");
  await fs.mkdir(day, { recursive: true });
  await fs.writeFile(path.join(day, "older.jsonl"), codexEvent(35));
  await fs.writeFile(path.join(day, "newer.jsonl"), '{"payload":{"rate_limits":null}}');
  await fs.utimes(path.join(day, "older.jsonl"), 1000, 1000);
  const service = createUsageService({ get: () => { throw new Error("must not select another provider"); } },
    () => { throw new Error("must not run inference or a CLI"); }, { codexHome: dir });
  const first = service("codex");
  assert.equal(first, service("codex"));
  assert.equal((await first).groups[0].buckets[0].remaining, 65);
  assert.equal((await service("api")).available, false);
  const missing = createUsageService(null, null, { codexHome: path.join(dir, "missing") });
  assert.equal((await missing("codex")).available, false);
});

test("Claude uses only its account's read-only usage endpoint, deduplicates and caches", async t => {
  const dir = await accountDir(t);
  await fs.writeFile(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "test-only", expiresAt: Date.now() + 60000 } }));
  let calls = 0;
  const service = createUsageService({ get: () => { throw new Error("no provider fallback"); } },
    () => { throw new Error("no inference calls"); }, { claudeHome: dir, fetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer test-only");
      assert.equal(options.headers["anthropic-beta"], "oauth-2025-04-20");
      assert.ok(options.signal);
      return { ok: true, json: async () => ({ five_hour: { utilization: 42 } }) };
    } });
  const first = service("claude-code");
  assert.equal(first, service("claude-code"));
  assert.equal((await first).groups[0].buckets[0].remaining, 58);
  await service("claude-code");
  assert.equal(calls, 1);
});

test("Claude missing, API-key, and expired logins never invoke a model or endpoint", async t => {
  const dir = await accountDir(t);
  const service = createUsageService(null, () => { throw new Error("no CLI calls"); }, {
    claudeHome: dir, fetch: () => { throw new Error("should not fetch"); },
  });
  assert.match((await service("claude-code")).message, /login is unavailable/);
  await fs.writeFile(path.join(dir, ".credentials.json"), "{}");
  assert.match((await service("claude-code")).message, /subscription login/);
  await fs.writeFile(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "test-only", expiresAt: 1 } }));
  assert.match((await service("claude-code")).message, /expired/);
});

test("Claude throttling, authorization, malformed data and transport errors stay honest and sanitized", async t => {
  const dir = await accountDir(t);
  await fs.writeFile(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "test-only" } }));
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const service = createUsageService(null, null, { claudeHome: dir, fetch: async () => { calls++; return { ok: false, status }; } });
    const result = await service("claude-code");
    assert.equal(result.available, false);
    assert.match(result.message, new RegExp(`HTTP ${status}`));
    await service("claude-code");
    assert.equal(calls, 1);
  }
  for (const fetch of [async () => { throw new Error("sensitive transport detail"); },
    async () => ({ ok: true, json: async () => { throw new Error("sensitive body"); } })]) {
    const result = await createUsageService(null, null, { claudeHome: dir, fetch })("claude-code");
    assert.equal(result.available, false);
    assert.doesNotMatch(result.message, /sensitive/);
  }
});
