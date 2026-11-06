import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";

const fixture = { events: [], result: { code: 0 }, call: null };
globalThis.__hermesFixture = fixture;
const hooks = registerHooks({
  load(url, context, next) {
    if (url.endsWith("/electron/engines/cli-util.js")) {
      return { format: "module", shortCircuit: true, source: `
        export const findExecutable = () => "C:/hermes/bin/hermes.exe";
        export const scratchDir = () => "scratch";
        export const runCapture = async () => ({ ok: true, stdout: "" });
        export const killTree = () => {};
        export const idleStatus = () => "Working…";
        export const IDLE_STATUS = /^Working…$/;
        export const spawnLines = async (exe, args, opts) => {
          const f = globalThis.__hermesFixture;
          f.call = { exe, args, opts };
          for (const ev of f.events) opts.onLine(JSON.stringify(ev));
          return { stderr: "", ...f.result };
        };
      ` };
    }
    return next(url, context);
  },
});
const { hermesEndpoint, hermesArgs, writeHermesConfig, runHermes, hermesExe, hermesPaths, hermesHome, HERMES_CONFIG } = await import("../electron/engines/hermes.js");
const { makeApiEngine } = await import("../electron/engines/api.js");
const { supportsAgentFlow } = await import("../electron/lecturegen/agent-run.js");
test.after(() => { hooks.deregister(); delete globalThis.__hermesFixture; });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ml-hermes-"));

test("every API provider maps to an OpenAI-compatible endpoint for Hermes", () => {
  assert.equal(hermesEndpoint({ provider: "gemini", apiKey: "k" }).baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(hermesEndpoint({ provider: "openai" }).baseUrl, "https://api.openai.com/v1");
  assert.equal(hermesEndpoint({ provider: "compatible", baseUrl: "https://api.ai.it.ufl.edu/" }).baseUrl, "https://api.ai.it.ufl.edu");
});

test("Hermes runs one-shot, streaming JSON, auto-approved, with the user's endpoint and model", () => {
  const args = hermesArgs({ baseUrl: "https://x/v1", apiKey: "sk-1", model: "gpt-x" });
  assert.equal(args[0], "chat");
  for (const a of ["--oneshot", "--yolo", "--ignore-rules"]) assert(args.includes(a), a);
  assert.equal(args[args.indexOf("--format") + 1], "stream-json");
  assert.equal(args[args.indexOf("--query-file") + 1], "-", "the prompt goes over stdin");
  assert.equal(args[args.indexOf("--provider") + 1], "custom");
  assert.equal(args[args.indexOf("--base-url") + 1], "https://x/v1");
  assert.equal(args[args.indexOf("--api-key") + 1], "sk-1");
  assert.equal(args[args.indexOf("-m") + 1], "gpt-x");
});

test("MyLecture's Hermes home has memory, self-review and skill writing switched off", () => {
  const home = tmp();
  fs.writeFileSync(path.join(home, "config.yaml"), "model:\n  provider: auto\n_config_version: 52\n");
  writeHermesConfig(home);
  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.equal(cfg, HERMES_CONFIG + "_config_version: 52\n", "Hermes's config version is kept");
  assert.match(cfg, /memory_enabled: false/);
  assert.match(cfg, /user_profile_enabled: false/);
  assert.match(cfg, /background_review:\n\s+enabled: false/);
  assert.match(cfg, /disabled_toolsets: \[[^\]]*\bskills\b[^\]]*\]/);
  assert.match(cfg, /disabled_toolsets: \[[^\]]*\bmemory\b[^\]]*\]/);
  assert(fs.existsSync(path.join(home, ".no-bundled-skills")), "bundled skills opted out");
});

test("a Hermes run streams text and tool steps and stays confined to the project folder", async () => {
  fixture.events = [
    { type: "system", subtype: "init", model: "m" },
    { type: "text", text: "Writing " },
    { type: "tool_use", name: "write_file", input: { path: "index1.html" } },
    { type: "text", text: "scene 1." },
    { type: "result", exit_code: 0, text: "Done: one scene." },
  ];
  fixture.result = { code: 0 };
  const home = tmp(), workspace = tmp();
  const deltas = [], activity = [];
  fs.writeFileSync(path.join(home, ".mylecture-curator-paused"), "");
  const r = await runHermes({ exe: "C:/hermes/hermes.exe", home, system: "SYS", user: "USER", model: "m", config: { provider: "compatible", baseUrl: "https://api.ai.it.ufl.edu", apiKey: "k" }, workspace, onDelta: (d) => deltas.push(d), onActivity: (a) => activity.push(a) });
  assert.equal(r.text, "Done: one scene.");
  assert.deepEqual(deltas, ["Writing ", "scene 1."]);
  assert(activity.some((a) => a.type === "step" && a.text === "index1.html"));
  const { opts } = fixture.call;
  assert.equal(opts.cwd, workspace);
  assert.equal(opts.env.HERMES_HOME, home, "MyLecture's own Hermes home");
  assert.match(fs.readFileSync(path.join(home, "config.yaml"), "utf8"), /memory_enabled: false/);
  assert.equal(opts.env.HERMES_WRITE_SAFE_ROOT, workspace);
  assert.equal(opts.stdin, "SYS\n\n---\n\nUSER");
});

test("a failed Hermes run reports its error", async () => {
  fixture.events = [{ type: "result", exit_code: 1, error: "401 invalid api key" }];
  fixture.result = { code: 1 };
  const home2 = tmp(); fs.writeFileSync(path.join(home2, ".mylecture-curator-paused"), "");
  await assert.rejects(runHermes({ exe: "C:/hermes/hermes.exe", home: home2, system: "s", user: "u", config: { provider: "compatible", baseUrl: "https://x", apiKey: "bad" }, workspace: tmp() }), /Hermes: 401 invalid api key/);
});

test("API-key videos now use the agent flow (Hermes), not the staged pipeline", () => {
  const engine = makeApiEngine(() => ({ provider: "compatible", baseUrl: "https://x", apiKey: "k" }));
  assert.equal(typeof engine.agent, "function");
  assert.equal(supportsAgentFlow(engine), true);
  assert.equal(typeof engine.generate, "function", "the staged pipeline stays in the code");
});

test("only MyLecture's own, fully installed Hermes is used", () => {
  const tools = tmp();
  const p = hermesPaths(tools);
  assert.equal(hermesExe(tools), null);
  fs.mkdirSync(path.dirname(p.exe), { recursive: true });
  fs.writeFileSync(p.exe, "");
  assert.equal(hermesExe(tools), null, "an interrupted install (no marker) is not used");
  fs.writeFileSync(p.marker, "{}");
  assert.equal(hermesExe(tools), p.exe);
  assert(p.home.startsWith(path.join(tools, "hermes")), "its HERMES_HOME lives with MyLecture, not the user's Hermes");
});

test("each project gets its own Hermes home, so a lingering gateway never carries another project's write limit", () => {
  const tools = tmp();
  const a = hermesHome(tools, "C:/lib/lec-1"), b = hermesHome(tools, "C:/lib/lec-2");
  assert.notEqual(a, b);
  assert.equal(hermesHome(tools, "C:/lib/lec-1"), a, "the same project keeps its home");
  assert(a.startsWith(path.join(tools, "hermes", "homes")));
  assert.match(HERMES_CONFIG, /curator:\n\s+enabled: false/);
});
