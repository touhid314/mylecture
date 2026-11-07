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
        export const VISION_MIMES = new RegExp("^image/(png|jpeg|webp|gif)$");
        export const imageBlocks = () => [];
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

test("Gemini agent runs get full, auto-approved tool access scoped to the project folder", async () => {
  fixture.events = [{ event: "result", result: { status: "SUCCESS", response: "Files created." } }];
  fixture.result = { code: 0 };
  assert.equal((await generate()).text, "Files created.");
  const { args, opts } = fixture.call;
  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.match(JSON.parse(opts.stdin).message.content, /full tool access/);
  assert.match(JSON.parse(opts.stdin).message.content, /must be inside the current project folder/);
  assert.equal(opts.cwd, "project");
});

test("SUCCESS with denied_actions is an error even if Gemini returned text", async () => {
  fixture.events = [{ event: "result", result: { status: "SUCCESS", response: "I will list files.", denied_actions: [{ action: "command" }] } }];
  await assert.rejects(generate(), /needed permission/);
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
