import test from "node:test";
import assert from "node:assert/strict";
import { makeApiEngine } from "../electron/engines/api.js";

test("API requests carry the sidebar thinking level in each provider's own format", async () => {
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response("", { status: 200 });
  };
  try {
    for (const [provider, model] of [["openai", "gpt-test"], ["gemini", "gemini-3.8-flash"], ["gemini", "gemini-2.5-pro"], ["anthropic", "claude-sonnet-5-5"], ["compatible", "local-model"]]) {
      const engine = makeApiEngine(() => ({ provider, model, apiKey: "test-only" }));
      await engine.generate({ system: "Test", user: "Test", effort: "high", onDelta() {} });
      if (provider === "openai") assert.equal(body.reasoning.effort, "high");
      if (provider === "gemini" && model.includes("3.8")) assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "high");
      if (provider === "gemini" && model.includes("2.5")) assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 8192);
      if (provider === "anthropic") assert.equal(body.output_config.effort, "high");
      if (provider === "compatible") assert.equal(body.reasoning, undefined);
    }
  } finally { globalThis.fetch = original; }
});

test("an active API job retains its provider when sidebar settings change", async () => {
  const original = globalThis.fetch;
  const urls = [];
  let config = { provider: "openai", model: "job-start-model", apiKey: "test-only" };
  globalThis.fetch = async (url) => { urls.push(url); return new Response("", { status: 200 }); };
  try {
    const active = makeApiEngine(() => config).snapshot();
    config = { provider: "anthropic", model: "other-model", apiKey: "other-test-only" };
    await active.generate({ system: "Test", user: "Test", onDelta() {} });
    assert.equal(urls[0], "https://api.openai.com/v1/responses");
  } finally { globalThis.fetch = original; }
});
