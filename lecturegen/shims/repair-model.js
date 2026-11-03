// Stand-in for mylecture-agent/src/repair-model.ts: one text-only request
// (no history) through the app's configured engine.
export function repairModel(options, purpose) {
  return async (system, prompt, limits) => {
    limits.signal.throwIfAborted();
    const llm = globalThis.__ML_LLM__;
    if (!llm) throw new Error("MyLecture LLM bridge is not configured.");
    const text = await llm.generate({ system, user: prompt, purpose, model: options.model, signal: limits.signal });
    limits.signal.throwIfAborted();
    if (!String(text || "").trim()) throw new Error("Repair returned no patch");
    return text;
  };
}
