import test from "node:test";
import assert from "node:assert/strict";
import { makeApiEngine, pickApiModel } from "../electron/engines/api.js";

async function withFetch(fn, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try { await run(); } finally { globalThis.fetch = original; }
}
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

test("a compatible provider without a selected model uses an available chat model", async () => {
  await withFetch(async () => json({ data: [{ id: "embedding-only" }, { id: "chat-pro" }, { id: "chat-mini" }] }), async () => {
    assert.equal(await pickApiModel({ provider: "compatible", baseUrl: "http://localhost:7654/v1" }), "chat-mini");
  });
  await withFetch(async () => json({ data: [{ id: "embedding-only" }] }), async () => {
    await assert.rejects(pickApiModel({ provider: "compatible", baseUrl: "http://localhost:7654/v1" }), /no chat models/);
  });
  await withFetch(async () => new Response("denied", { status: 401 }), async () => {
    await assert.rejects(pickApiModel({ provider: "compatible", baseUrl: "http://localhost:7654/v1" }), /Choose a model.*HTTP 401/);
  });
});

test("Gemini discovers generation models across pages without inventing thinking levels", async () => {
  const requests = [];
  await withFetch(async (url, options) => {
    requests.push({ url: new URL(url), options });
    return requests.length === 1
      ? json({ models: [{ name: "models/gemini-a", displayName: "Gemini A", thinking: true, supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-a", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "page 2" })
      : json({ models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] });
  }, async () => {
    const list = await makeApiEngine(() => ({ provider: "gemini", apiKey: "fixture-key", model: "not-a-catalog-entry" })).models();
    assert.deepEqual(list.map(m => m.id), ["gemini-a", "gemini-b"]);
    assert.equal(list[0].label, "Gemini A");
    assert.deepEqual(list[0].efforts, []);
    assert.equal(list[0].reasoningLevelsAdvertised, false);
    assert.equal(list[0].source, "gemini:models.list");
    assert.equal(requests[0].url.origin, "https://generativelanguage.googleapis.com");
    assert.equal(requests[0].options.headers["x-goog-api-key"], "fixture-key");
    assert(!requests[0].url.href.includes("fixture-key"));
    assert.equal(requests[1].url.searchParams.get("pageToken"), "page 2");
    assert.equal(requests[0].options.method, "GET");
  });
});

test("Anthropic derives effort support from provider capabilities and follows cursors", async () => {
  const requests = [];
  await withFetch(async (url, options) => {
    requests.push({ url: new URL(url), options });
    return requests.length === 1
      ? json({ data: [{ id: "claude-provider-a", display_name: "Provider A", capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: false }, custom_future_level: { supported: true } } } }], has_more: true, last_id: "cursor-a" })
      : json({ data: [{ id: "claude-provider-b" }], has_more: false });
  }, async () => {
    const list = await makeApiEngine(() => ({ provider: "anthropic", apiKey: "fixture-key" })).models();
    assert.deepEqual(list[0].efforts, ["low", "custom_future_level"]);
    assert.equal(list[0].reasoningLevelsAdvertised, true);
    assert.deepEqual(list[1].efforts, []);
    assert.equal(list[1].reasoningLevelsAdvertised, false);
    assert.equal(requests[1].url.searchParams.get("after_id"), "cursor-a");
    assert.equal(requests[0].options.headers["x-api-key"], "fixture-key");
  });
});

test("OpenAI model discovery reports returned IDs and keeps unknown effort support unknown", async () => {
  await withFetch(async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(options.headers.authorization, "Bearer fixture-key");
    return json({ data: [{ id: "actual-provider-model" }] });
  }, async () => {
    const list = await makeApiEngine(() => ({ provider: "openai", apiKey: "fixture-key", model: "configured-only" })).models();
    assert.deepEqual(list, [{ id: "actual-provider-model", label: "actual-provider-model", efforts: [], reasoningLevelsAdvertised: false, source: "openai:models.list" }]);
  });
});

test("compatible servers use their configured endpoint and only their actual effort metadata", async () => {
  await withFetch(async (url, options) => {
    assert.equal(url, "http://localhost:7654/v1/models");
    assert.equal(options.headers.authorization, undefined);
    return json({ data: [{ id: "local-provider-model", supported_reasoning_efforts: ["small", "large"] }] });
  }, async () => {
    const list = await makeApiEngine(() => ({ provider: "compatible", baseUrl: "http://localhost:7654/v1/" })).models();
    assert.deepEqual(list[0].efforts, ["small", "large"]);
    assert.equal(list[0].reasoningLevelsAdvertised, true);
  });
});

test("catalog failures stay visible instead of substituting configured/static models", async () => {
  await withFetch(async () => new Response("access denied", { status: 401 }), async () => {
    await assert.rejects(makeApiEngine(() => ({ provider: "openai", apiKey: "fixture-key", model: "configured-only" })).models(), /model discovery HTTP 401/);
  });
  let called = false;
  await withFetch(async () => { called = true; return json({ data: [] }); }, async () => {
    await assert.rejects(makeApiEngine(() => ({ provider: "anthropic" })).models(), /API key/);
    assert.equal(called, false);
  });
  await withFetch(async () => json({ data: [{ id: "a" }], has_more: true, last_id: "repeated" }), async () => {
    await assert.rejects(makeApiEngine(() => ({ provider: "anthropic", apiKey: "fixture-key" })).models(), /repeated.*pagination cursor/);
  });
});

test("provider-default effort omits all explicit thinking configuration", async () => {
  let body;
  await withFetch(async (_url, options) => { body = JSON.parse(options.body); return new Response("", { status: 200 }); }, async () => {
    for (const [provider, model] of [["openai", "gpt-test"], ["gemini", "gemini-3.8-flash"], ["gemini", "gemini-2.5-pro"], ["anthropic", "claude-provider-a"], ["compatible", "local-provider-model"]]) {
      await makeApiEngine(() => ({ provider, model, apiKey: "fixture-key" })).generate({ system: "fixture", user: "fixture", effort: "", onDelta() {} });
      assert.equal(body.reasoning, undefined, provider);
      assert.equal(body.output_config, undefined, provider);
      assert.equal(body.reasoning_effort, undefined, provider);
      assert.equal(body.generationConfig?.thinkingConfig, undefined, provider);
    }
  });
});

test("compatible requests send reasoning_effort only for an explicit selected level", async () => {
  let body;
  await withFetch(async (_url, options) => { body = JSON.parse(options.body); return new Response("", { status: 200 }); }, async () => {
    const engine = makeApiEngine(() => ({ provider: "compatible", model: "actual-model", baseUrl: "http://localhost:7654/v1" }));
    await engine.generate({ system: "fixture", user: "fixture", effort: "provider-reported-level", onDelta() {} });
    assert.equal(body.reasoning_effort, "provider-reported-level");
  });
});

test("Use with API key offers only providers verified end to end", async () => {
  const { OFFERED_API_PROVIDERS, verifyApiProvider } = await import("../electron/engines/api.js");
  assert.deepEqual(Object.keys(OFFERED_API_PROVIDERS), ["gemini", "compatible"]);
  assert.equal(OFFERED_API_PROVIDERS.compatible.label, "LiteLLM");
  assert.ok(OFFERED_API_PROVIDERS.compatible.needsBaseUrl);
  await assert.rejects(verifyApiProvider({ provider: "openai", apiKey: "x" }), /not available/);
  await assert.rejects(verifyApiProvider({ provider: "compatible", apiKey: "x", baseUrl: "" }), /server address/);
  await assert.rejects(verifyApiProvider({ provider: "gemini", apiKey: "" }), /Enter an API key/);
});
