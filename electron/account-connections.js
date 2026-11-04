const PROVIDERS = ["codex", "antigravity", "claude-code"];

function assertProvider(id) {
  if (!PROVIDERS.includes(id)) throw new Error("Unknown account provider");
}

/** Invalidates in-flight account checks without touching provider credentials. */
export function accountRevisionPatch(settings, id) {
  assertProvider(id);
  const current = settings?.accountRevision?.[id];
  const revision = Number.isSafeInteger(current) && current >= 0 && current < Number.MAX_SAFE_INTEGER ? current + 1 : 1;
  return { accountRevision: { [id]: revision } };
}

/**
 * A settings patch only: merge nested maps when saving. readyProviders must
 * contain IDs whose current provider status was checked by the caller.
 * Persist removal/invalidation before asynchronous fallback checks; callers
 * can then choose a fallback only if their operation is still current.
 */
export function accountRemovalPatch(settings, id, readyProviders = []) {
  assertProvider(id);
  const patch = { connected: { [id]: false }, ...accountRevisionPatch(settings, id) };
  if (settings?.engine === id) {
    const ready = new Set(Array.isArray(readyProviders) ? readyProviders : []);
    patch.engine = PROVIDERS.find(candidate => candidate !== id && settings?.connected?.[candidate] === true && ready.has(candidate)) || "";
  }
  return patch;
}
