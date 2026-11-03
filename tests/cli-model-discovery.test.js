import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { discoverClaudeModels, parseClaudeModels, parseAntigravityModels } from "../electron/engines/model-discovery.js";

test("Claude discovery preserves each CLI model's own capabilities, including new levels and missing support", () => {
  const result = parseClaudeModels({ models: [
    { value: "default", displayName: "Default", resolvedModel: "provider-newest", supportedEffortLevels: ["quick", "deep", "future-level"], supportsEffort: true },
    { value: "old-model", displayName: "Older model" },
  ], account: { accessToken: "must-not-leave-protocol" } });
  assert.deepEqual(result[0].efforts, ["quick", "deep", "future-level"]);
  assert.equal(result[0].resolvedModel, "provider-newest");
  assert.equal(result[0].isDefault, true);
  assert.deepEqual(result[1].efforts, []);
  assert.equal(result[1].defaultEffort, undefined);
  assert.equal(result[1].supportsAdaptiveThinking, undefined);
  assert(!JSON.stringify(result).includes("must-not-leave-protocol"));
  assert.throws(() => parseClaudeModels({}), /did not list any models/);
});

test("Claude discovery sends only a native initialize control request, disables hooks, then closes the process", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const sent = [];
  let argumentsUsed, stopped = false;
  child.stdin.on("data", chunk => {
    const request = JSON.parse(chunk.toString()); sent.push(request);
    process.nextTick(() => child.stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: request.request_id, response: { models: [{ value: "native-model", supportedEffortLevels: ["max"] }] } } }) + "\n"));
  });
  const list = await discoverClaudeModels("native-cli", {
    spawnProcess: (_exe, args) => { argumentsUsed = args; return child; },
    stopProcess: () => { stopped = true; },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "control_request");
  assert.equal(sent[0].request.subtype, "initialize");
  assert(argumentsUsed.includes("--no-session-persistence"));
  assert(argumentsUsed.includes('{"disableAllHooks":true}'));
  assert.equal(list[0].id, "native-model");
  assert(stopped);
});

test("Antigravity levels and variants come only from matching CLI-advertised names and IDs", () => {
  const list = parseAntigravityModels("Fetching available models...\nnew-model-quiet\tNew model (Quiet)\nnew-model-turbo-plus\tNew model (Turbo Plus)\nlegacy\tLegacy\n");
  assert.deepEqual(list[0].efforts, ["quiet", "turbo-plus"]);
  assert.deepEqual(list[0].effortVariants, [{ level: "quiet", model: "new-model-quiet" }, { level: "turbo-plus", model: "new-model-turbo-plus" }]);
  assert.deepEqual(list[2].efforts, []);
  assert.equal(list[0].defaultEffort, undefined);
  assert.throws(() => parseAntigravityModels("Fetching available models..."), /returned no models/);
});
