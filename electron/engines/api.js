// "MyLecture Agent" — the built-in engine that talks to model APIs directly
// with the user's own key. Supports Gemini, OpenAI, Anthropic, and any
// OpenAI-compatible endpoint (OpenRouter, LiteLLM/Navigator, Ollama, LM Studio).
import fs from "node:fs";
import { log, registerLogSecret } from "../logger.js";

export function imageAttachments(attachments = []) {
  return attachments.filter(a => /^image\/(png|jpeg|webp|gif)$/.test(a.mime || "")).map(a => ({
    mime: a.mime,
    data: fs.readFileSync(a.path).toString("base64"),
  }));
}

export const API_PROVIDERS = {
  gemini: { label: "Google Gemini", defaultModel: "gemini-3.8-flash", keyUrl: "https://aistudio.google.com/apikey" },
  openai: { label: "OpenAI", defaultModel: "gpt-6.1-sol", keyUrl: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Anthropic", defaultModel: "claude-sonnet-5-5", keyUrl: "https://console.anthropic.com/settings/keys" },
  compatible: { label: "LiteLLM", defaultModel: "", keyUrl: "" },
};

// Providers offered in "Use with API key". Only providers verified end to end
// with a real key are offered (OpenAI and Anthropic are supported in code but
// not offered until verified).
export const OFFERED_API_PROVIDERS = {
  gemini: { label: "Gemini API", hint: "A Google AI Studio API key", keyUrl: "https://aistudio.google.com/apikey" },
  compatible: { label: "LiteLLM", hint: "Your LiteLLM server and key", needsBaseUrl: true, keyUrl: "" },
};

// Not chat models: hidden from the model list.
const NON_CHAT = /(flux|embed|whisper|tts|dall-?e|imagen|image|vision-only|rerank|moderation|audio|transcribe|veo|sora)/i;

// "HTTP 402: {json}" -> "HTTP 402: <the provider's own message>".
function providerMessage(e) {
  const text = String(e?.message || e);
  const m = text.match(/^(.*?HTTP \d+): (\{[\s\S]*)$/);
  if (!m) return text.slice(0, 300);
  try {
    const j = JSON.parse(m[2]);
    const msg = j.error?.message || j.message || j.detail;
    if (msg) return `${m[1]}: ${String(msg).replace(/\s+/g, " ").trim().slice(0, 300)}`;
  } catch {}
  const loose = m[2].match(/"message"\s*:\s*"([^"]+)/);
  return loose ? `${m[1]}: ${loose[1].slice(0, 300)}` : text.slice(0, 300);
}

// Checks a key for real: lists models, then makes one short request.
// Returns { models, model } or throws with the provider's own error.
export async function verifyApiProvider(config) {
  const c = { ...config };
  if (!OFFERED_API_PROVIDERS[c.provider]) throw new Error("That provider is not available.");
  if (!c.apiKey) throw new Error("Enter an API key.");
  if (OFFERED_API_PROVIDERS[c.provider].needsBaseUrl) {
    if (!/^https?:\/\/\S+$/i.test(c.baseUrl || "")) throw new Error("Enter your LiteLLM server address, e.g. https://litellm.example.com");
    c.baseUrl = c.baseUrl.replace(/\/+$/, "");
  }
  const engine = makeApiEngine(() => c);
  let models;
  try {
    models = (await engine.models()).filter((m) => m.id && !NON_CHAT.test(m.id));
  } catch (e) {
    throw new Error(`The key or address was not accepted. ${providerMessage(e)}`);
  }
  if (!models.length) throw new Error("The key works, but no chat models are available to it.");
  const preferred = [API_PROVIDERS[c.provider]?.defaultModel, ...models.map((m) => m.id).filter((id) => /flash|mini|haiku/i.test(id)), ...models.map((m) => m.id)];
  const candidates = [...new Set(preferred.filter((id) => id && models.some((m) => m.id === id)))].slice(0, 4);
  let lastError = null;
  for (const model of candidates) {
    try {
      const signal = AbortSignal.timeout(15000);
      await engine.generate({ system: "Reply with exactly: OK", user: "Say OK.", model, signal, onDelta: () => {} });
      return { models: models.map((m) => ({ id: m.id, label: m.label || m.id })), model };
    } catch (e) {
      lastError = e;
      // A billing or key problem will not get better with another model.
      if (/HTTP (401|402|403)\b/.test(String(e.message))) break;
    }
  }
  throw new Error(`The key was accepted, but a test request failed. ${providerMessage(lastError)}`);
}

async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      let event = "";
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}

async function check(res, label) {
  if (res.ok) return;
  let body = "";
  try {
    body = await res.text();
  } catch {}
  throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 400)}`);
}

// Only advertise effort levels explicitly returned by the provider. Model names
// and a generic `thinking: true` capability do not enumerate supported levels.
function advertisedEfforts(model) {
  const capability = model.capabilities?.effort;
  if (capability && typeof capability === "object") {
    return {
      efforts: Object.entries(capability).filter(([key, value]) => key !== "supported" && value?.supported === true).map(([key]) => key),
      reasoningLevelsAdvertised: true,
    };
  }
  const levels = model.supportedReasoningEfforts ?? model.supported_reasoning_efforts ?? model.supportedThinkingLevels ?? model.supported_thinking_levels;
  if (Array.isArray(levels)) {
    return {
      efforts: [...new Set(levels.map(value => typeof value === "string" ? value : value?.reasoningEffort ?? value?.effort ?? value?.level).filter(value => typeof value === "string" && value))],
      reasoningLevelsAdvertised: true,
    };
  }
  return { efforts: [], reasoningLevelsAdvertised: false };
}

async function discoverApiModels(config) {
  const c = { ...config }, provider = c.provider;
  if (provider !== "compatible" && !c.apiKey) throw new Error(`Add a ${API_PROVIDERS[provider]?.label || provider} API key to discover its models.`);
  const defaults = { gemini: "https://generativelanguage.googleapis.com/v1beta", anthropic: "https://api.anthropic.com/v1", openai: "https://api.openai.com/v1", compatible: "http://localhost:11434/v1" };
  const base = (c.baseUrl || defaults[provider] || "").replace(/\/$/, "");
  if (!base) throw new Error("Unknown API model provider");
  const endpoint = new URL(base + "/models");
  const headers = {};
  if (provider === "gemini") headers["x-goog-api-key"] = c.apiKey;
  else if (provider === "anthropic") {
    headers["x-api-key"] = c.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;
  const source = `${provider}:models.list`;
  const found = new Map(), seenCursors = new Set();
  let cursor = "";
  const signal = AbortSignal.timeout(30000);
  // Docs: ai.google.dev/api/models; platform.claude.com/docs/en/api/http/models/list;
  // developers.openai.com/api/reference/resources/models/methods/list.
  for (let page = 0; page < 50; page++) {
    const url = new URL(endpoint);
    if (provider === "gemini") {
      url.searchParams.set("pageSize", "1000");
      if (cursor) url.searchParams.set("pageToken", cursor);
    } else if (provider === "anthropic") {
      url.searchParams.set("limit", "1000");
      if (cursor) url.searchParams.set("after_id", cursor);
    } else if (cursor) url.searchParams.set("after", cursor);
    const res = await fetch(url.href, { method: "GET", headers, signal });
    await check(res, `${API_PROVIDERS[provider]?.label || provider} model discovery`);
    const result = await res.json();
    const models = provider === "gemini" ? result.models : result.data;
    if (!Array.isArray(models)) throw new Error("The provider returned an invalid model catalog.");
    for (const model of models) {
      if (provider === "gemini" && Array.isArray(model.supportedGenerationMethods) && !model.supportedGenerationMethods.includes("generateContent") && !model.supportedGenerationMethods.includes("streamGenerateContent")) continue;
      const id = provider === "gemini" ? model.name?.replace(/^models\//, "") : model.id;
      if (typeof id !== "string" || !id) continue;
      found.set(id, { id, label: model.display_name || model.displayName || model.name?.replace(/^models\//, "") || id,
        ...advertisedEfforts(model), source });
    }
    const next = provider === "gemini" ? result.nextPageToken : result.has_more ? result.last_id || models.at(-1)?.id : "";
    if (!next) {
      if (result.has_more) throw new Error("The provider returned more model pages without a pagination cursor.");
      return [...found.values()];
    }
    if (typeof next !== "string" || seenCursors.has(next)) throw new Error("The provider repeated a model pagination cursor.");
    seenCursors.add(next); cursor = next;
  }
  throw new Error("The provider model catalog exceeded the discovery page limit.");
}

export function makeApiEngine(getConfig) {
  return {
    id: "api",
    name: "MyLecture Agent (API key)",
    kind: "api",
    snapshot() {
      const config = { ...getConfig() };
      return makeApiEngine(() => config);
    },

    async status() {
      const c = getConfig();
      const ok = !!c.apiKey || c.provider === "compatible";
      return { installed: true, ready: ok, message: ok ? `${API_PROVIDERS[c.provider]?.label || c.provider} configured` : "Add an API key in Settings" };
    },

    async models() {
      return discoverApiModels(getConfig());
    },

    async generate({ system, user, model, effort = "low", signal, onDelta, attachments = [] }) {
      const c = getConfig();
      registerLogSecret(c.apiKey);
      const m = model || c.model || API_PROVIDERS[c.provider]?.defaultModel;
      const started = Date.now();
      log("info", "api.request", { provider: c.provider, model: m, effort, attachmentCount: attachments.length });
      try {
      const images = imageAttachments(attachments);
      let full = "";
      const push = (t) => {
        if (!t) return;
        if (!full) log("info", "api.firstResponse", { provider: c.provider, model: m, durationMs: Date.now() - started });
        full += t;
        onDelta(t);
      };
      if (c.provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`;
        const res = await fetch(url, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", "x-goog-api-key": c.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }, ...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.data } }))] }],
            // https://ai.google.dev/gemini-api/docs/generate-content/thinking
            generationConfig: { temperature: 0.7, maxOutputTokens: 32768,
              ...(effort && /^gemini-[34]/.test(m) ? { thinkingConfig: { thinkingLevel: effort } }
                : effort && /^gemini-2\.5/.test(m) ? { thinkingConfig: { thinkingBudget: { low: 1024, medium: 4096, high: 8192 }[effort] || 1024 } } : {}),
            },
          }),
        });
        await check(res, "Gemini");
        for await (const ev of sse(res)) {
          try {
            const j = JSON.parse(ev.data);
            for (const p of j.candidates?.[0]?.content?.parts || []) if (!p.thought) push(p.text);
          } catch {}
        }
      } else if (c.provider === "openai") {
        const res = await fetch((c.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/responses", {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${c.apiKey}` },
          body: JSON.stringify({ model: m, instructions: system, input: images.length ? [{ role: "user", content: [{ type: "input_text", text: user }, ...images.map(i => ({ type: "input_image", image_url: `data:${i.mime};base64,${i.data}` }))] }] : user, stream: true, ...(effort ? { reasoning: { effort } } : {}) }),
        });
        await check(res, "OpenAI");
        for await (const ev of sse(res)) {
          if (ev.data === "[DONE]") break;
          try {
            const j = JSON.parse(ev.data);
            if (j.type === "response.output_text.delta") push(j.delta);
            else if (j.type === "error") throw new Error(j.error?.message || "OpenAI error");
          } catch (e) {
            if (e.message && !/JSON/.test(e.message)) throw e;
          }
        }
      } else if (c.provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" },
          // https://platform.claude.com/docs/en/build-with-claude/effort
          body: JSON.stringify({ model: m, max_tokens: 32000, system, messages: [{ role: "user", content: images.length ? [{ type: "text", text: user }, ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } }))] : user }], stream: true,
            ...(!effort || /claude-(?:haiku|sonnet)-4-5/.test(m) ? {} : { output_config: { effort } }),
          }),
        });
        await check(res, "Anthropic");
        for await (const ev of sse(res)) {
          try {
            const j = JSON.parse(ev.data);
            if (j.type === "content_block_delta" && j.delta?.type === "text_delta") push(j.delta.text);
            else if (j.type === "error") throw new Error(j.error?.message || "Anthropic error");
          } catch (e) {
            if (e.message && !/JSON/.test(e.message)) throw e;
          }
        }
      } else {
        const base = (c.baseUrl || "http://localhost:11434/v1").replace(/\/$/, "");
        const headers = { "content-type": "application/json" };
        if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;
        const res = await fetch(base + "/chat/completions", {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            model: m,
            stream: true,
            ...(effort ? { reasoning_effort: effort } : {}),
            messages: [
              { role: "system", content: system },
              { role: "user", content: images.length ? [{ type: "text", text: user }, ...images.map(i => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : user },
            ],
          }),
        });
        await check(res, "API");
        for await (const ev of sse(res)) {
          if (ev.data === "[DONE]") break;
          try {
            const j = JSON.parse(ev.data);
            push(j.choices?.[0]?.delta?.content);
          } catch {}
        }
      }
      log("info", "api.done", { provider: c.provider, model: m, durationMs: Date.now() - started, characters: full.length });
      return { text: full };
      } catch (error) {
        log(signal?.aborted ? "info" : "error", signal?.aborted ? "api.aborted" : "api.failed", { provider: c.provider, model: m, durationMs: Date.now() - started, error });
        throw error;
      }
    },
  };
}
