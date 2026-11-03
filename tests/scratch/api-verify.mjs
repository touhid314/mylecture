// Verifies API providers end to end through the app's own API engine:
// model discovery + a short streamed generation. Keys come from env vars;
// nothing is printed except provider, model and the reply.
//   GEMINI_KEY=... LITELLM_KEY=... LITELLM_BASE=... node tests/scratch/api-verify.mjs
import { makeApiEngine } from "../../electron/engines/api.js";

const cases = [
  process.env.GEMINI_KEY && { provider: "gemini", apiKey: process.env.GEMINI_KEY },
  process.env.LITELLM_KEY && { provider: "compatible", apiKey: process.env.LITELLM_KEY, baseUrl: process.env.LITELLM_BASE },
  process.env.OPENAI_KEY && { provider: "openai", apiKey: process.env.OPENAI_KEY },
  process.env.ANTHROPIC_KEY && { provider: "anthropic", apiKey: process.env.ANTHROPIC_KEY },
].filter(Boolean);

for (const c of cases) {
  const t0 = Date.now();
  try {
    const engine = makeApiEngine(() => c);
    const models = await engine.models();
    const pick = process.env[`${c.provider.toUpperCase()}_MODEL`] || models.find((m) => /flash|mini|haiku|gpt-4o-mini|small/i.test(m.id))?.id || models[0]?.id;
    let streamed = 0;
    const res = await engine.generate({
      system: "Reply with exactly: OK",
      user: "Say OK.",
      model: pick,
      signal: new AbortController().signal,
      onDelta: () => streamed++,
    });
    console.log(`PASS ${c.provider}: ${models.length} models, used ${pick}, streamed ${streamed} chunks, reply ${JSON.stringify(String(res?.text || "").trim().slice(0, 40))} (${Date.now() - t0}ms)`);
  } catch (e) {
    console.log(`FAIL ${c.provider}: ${String(e.message || e).replace(/(key|token)=[^&\s]+/gi, "$1=…").slice(0, 300)}`);
  }
}
