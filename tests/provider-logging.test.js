import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { configureLogger, getLogInfo } from "../electron/logger.js";
import { spawnLines } from "../electron/engines/cli-util.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ml-provider-logs-"));
configureLogger({ directory });
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const entries = () => fs.readFileSync(getLogInfo().file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

test("CLI lifecycle and heartbeats are written live without stdout, stderr or stdin bodies", async () => {
  const output = [];
  const promise = spawnLines(process.execPath, ["-e", "process.stdin.resume();process.stdout.write('PRIVATE_STDOUT\\n');process.stderr.write('PRIVATE_STDERR');setTimeout(()=>process.exit(0),110)"], {
    stdin: "PRIVATE_STDIN", onLine: line => output.push(line), heartbeatMs: 10,
  });
  assert(entries().some(entry => entry.event === "cli.start"), "start must be logged before completion");
  const result = await promise;
  assert.equal(result.code, 0);
  assert.deepEqual(output, ["PRIVATE_STDOUT"]);
  assert.equal(result.stderr, "PRIVATE_STDERR");
  const logged = entries();
  for (const event of ["cli.start", "cli.heartbeat", "cli.stderr", "cli.exit"]) assert(logged.some(entry => entry.event === event), event);
  const serialized = JSON.stringify(logged);
  for (const secret of ["PRIVATE_STDOUT", "PRIVATE_STDERR", "PRIVATE_STDIN"]) assert(!serialized.includes(secret));
  const count = entries().length;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(entries().length, count, "heartbeat timer must stop on process exit");
});

test("stderr retention is bounded while logging only diagnostic byte counts", async () => {
  const result = await spawnLines(process.execPath, ["-e", "process.stderr.write('x'.repeat(100000));process.stdout.write('ok\\n')"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr.length, 65536);
});

const fixture = { events: [] };
globalThis.__providerLoggingFixture = fixture;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/electron/engines/claude-code.js") && specifier === "./cli-util.js") return { url: "test:provider-logging-cli", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "test:provider-logging-cli") return { format: "module", shortCircuit: true, source: `
      export const findExecutable=()=>"claude";
      export const scratchDir=()=>"scratch";
      export const runCapture=async()=>({ok:true,stdout:""});
      export { idleStatus, VISION_MIMES, imageBlocks } from ${JSON.stringify(new URL("../electron/engines/cli-util.js", import.meta.url).href)};
      export const spawnLines=async(_exe,_args,opts)=>{
        globalThis.__providerLoggingFixture.args=_args;
        for(const ev of globalThis.__providerLoggingFixture.events)opts.onLine(JSON.stringify(ev));
        opts.onIdle?.({idleMs:45000,elapsedMs:60000});
        return {code:0,stderr:"",aborted:false};
      };
    ` };
    return next(url, context);
  },
});
const { claudeCode } = await import("../electron/engines/claude-code.js");
test.after(() => { hooks.deregister(); delete globalThis.__providerLoggingFixture; });

test("Claude diagnostics identify thought activity and tools without recording private reasoning or content", async () => {
  fixture.events = [
    { type: "stream_event", event: { type: "content_block_start", content_block: { type: "thinking" } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "PRIVATE_THOUGHT_TEXT" } } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "index1.html", content: "PRIVATE_SCENE_CONTENT" } }] } },
    { type: "result", is_error: false, result: "PRIVATE_RESPONSE_TEXT", duration_ms: 1000, num_turns: 1 },
  ];
  const status = [];
  const result = await claudeCode.generate({ system: "PRIVATE_SYSTEM", user: "PRIVATE_USER", model: "test-model", workspace: "project", onDelta() {}, onStatus: line => status.push(line) });
  assert.equal(result.text, "PRIVATE_RESPONSE_TEXT");
  assert(status.includes("Working…"));
  assert(status.every(line => !/no events|waiting for a response/i.test(line)));
  const logged = entries().filter(entry => entry.event.startsWith("provider."));
  for (const event of ["provider.start", "provider.thinking", "provider.tool", "provider.result", "provider.waiting", "provider.finish"]) assert(logged.some(entry => entry.event === event), event);
  const serialized = JSON.stringify(logged);
  for (const secret of ["PRIVATE_THOUGHT_TEXT", "PRIVATE_SCENE_CONTENT", "PRIVATE_RESPONSE_TEXT", "PRIVATE_SYSTEM", "PRIVATE_USER"]) assert(!serialized.includes(secret));
});

test("Claude agent runs get every tool, with edits auto-approved only inside the project folder", async () => {
  fixture.events = [{ type: "result", is_error: false, result: "done" }];
  await claudeCode.generate({ system: "s", user: "u", workspace: "project", onDelta() {} });
  const args = fixture.args;
  assert.equal(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
  assert(!args.includes("--disallowedTools"));
  assert(!args.includes("--dangerously-skip-permissions"));
  const allowed = args[args.indexOf("--allowedTools") + 1].split(",");
  for (const tool of ["Bash", "WebFetch", "WebSearch", "Read", "Task"]) assert(allowed.includes(tool), tool);
  assert(!allowed.some((tool) => /^(Write|Edit|MultiEdit)$/.test(tool)), "file edits stay under acceptEdits' folder scope");
  assert.match(args[args.indexOf("--append-system-prompt") + 1], /must be inside the current project folder/);
  assert.match(args[args.indexOf("--append-system-prompt") + 1], /real web browser/);
  assert(!args.includes("--safe-mode"), "safe mode would drop the browser MCP server");
  assert.equal(args[args.indexOf("--setting-sources") + 1], "local");
  assert(args.includes("--strict-mcp-config"));
  const mcp = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
  assert(mcp.mcpServers.browser.args.some((a) => a.startsWith("@playwright/mcp@")));
  assert(allowed.includes("mcp__browser"));
});

test("Claude text mode keeps safe mode and no tools", async () => {
  fixture.events = [{ type: "result", is_error: false, result: "done" }];
  await claudeCode.generate({ system: "s", user: "u", onDelta() {} });
  assert(fixture.args.includes("--safe-mode"));
  assert(!fixture.args.includes("--mcp-config"));
});
