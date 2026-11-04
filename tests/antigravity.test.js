import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const fixture = { events: [], result: { code: 0 }, call: null };
globalThis.__agyFixture = fixture;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/electron/engines/cli-util.js")) {
      return { format: "module", shortCircuit: true, source: `
        export const findExecutable = () => "agy";
        export const scratchDir = () => "scratch";
        export const runCapture = async () => ({ok:true,stdout:""});
        export const killTree = () => {};
        export const idleStatus = () => "Working…";
        export const spawnLines = async (exe,args,opts) => {
          const f = globalThis.__agyFixture;
          f.call = {exe,args,opts};
          for (const event of f.events) opts.onLine(JSON.stringify(event));
          return {stderr:"",...f.result};
        };
      ` };
    }
    return nextLoad(url, context);
  },
});
const { antigravity } = await import("../electron/engines/antigravity.js");
test.after(() => { hooks.deregister(); delete globalThis.__agyFixture; });
const generate = (extra = {}) => antigravity.generate({ system: "Make a video", user: "Explain rain", workspace: "project", onDelta() {}, ...extra });

test("Gemini uses native file tools without granting terminal permissions", async () => {
  fixture.events = [{ event: "result", result: { status: "SUCCESS", response: "Files created." } }];
  fixture.result = { code: 0 };
  assert.equal((await generate()).text, "Files created.");
  const { args, opts } = fixture.call;
  assert.ok(args.includes("accept-edits"));
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  assert.ok(!args.includes("--settings"));
  assert.match(JSON.parse(opts.stdin).message.content, /do not use run_command/);
  assert.equal(opts.cwd, "project");
});

test("SUCCESS with denied_actions is an error even if Gemini returned text", async () => {
  fixture.events = [{ event: "result", result: { status: "SUCCESS", response: "I will list files.", denied_actions: [{ action: "command" }] } }];
  await assert.rejects(generate(), /needed permission.*built-in file tools/);
});

test("an empty SUCCESS response does not silently complete", async () => {
  fixture.events = [{ event: "result", result: { status: "SUCCESS", response: "" } }];
  await assert.rejects(generate(), /stopped without a reply/);
});

test("cancellation may end without a reply", async () => {
  fixture.events = [];
  fixture.result = { code: null, aborted: true };
  assert.equal((await generate()).aborted, true);
  fixture.result = { code: 0 };
});
