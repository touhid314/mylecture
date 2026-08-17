/**
 * Resolve the model used for course planning and agent generation.
 * Chain: override (trim) → AGENT_MODEL → throw when empty.
 */
export function resolveAgentModel(override?: string): string {
  const fromOverride = typeof override === 'string' ? override.trim() : '';
  if (fromOverride) return fromOverride;
  const fromEnv = String(process.env.AGENT_MODEL || '').trim();
  if (fromEnv) return fromEnv;
  throw new Error('AGENT_MODEL environment variable or --model flag must be specified.');
}

/**
 * Same as resolveAgentModel but returns '' instead of throwing.
 */
export function tryResolveAgentModel(override?: string): string {
  try {
    return resolveAgentModel(override);
  } catch {
    return '';
  }
}

