/**
 * Resolve the model used for agent generation (plan, spawn, script-lab, extend).
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

/**
 * Resolve the model used for script/practice review.
 * Chain: override (trim) → COURSEGEN_REVIEW_MODEL → AGENT_MODEL → ''.
 * Callers that require a model should throw a clear Error when empty
 * (must not be treated as a soft review failure that triggers narration repair).
 */
export function tryResolveReviewModel(override?: string): string {
  const fromOverride = typeof override === 'string' ? override.trim() : '';
  if (fromOverride) return fromOverride;
  const reviewEnv = String(process.env.COURSEGEN_REVIEW_MODEL || '').trim();
  if (reviewEnv) return reviewEnv;
  return String(process.env.AGENT_MODEL || '').trim();
}
