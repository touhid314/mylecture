export const OPENAI_REASONING_EFFORTS = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
] as const;

export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

/** Parity with Gemini 3.5 Flash in this repo: no explicit thinking budget is configured. */
export const OPENAI_REASONING_EFFORT_GEMINI_FLASH_PARITY: OpenAiReasoningEffort = 'none';

export function parseOpenAiReasoningEffort(
    raw: string | undefined | null,
): OpenAiReasoningEffort | null {
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if ((OPENAI_REASONING_EFFORTS as readonly string[]).includes(normalized)) {
        return normalized as OpenAiReasoningEffort;
    }
    return null;
}

export function resolveOpenAiReasoningEffortFromEnv(): {
    effort: OpenAiReasoningEffort | null;
    invalidRaw: string | null;
} {
    const raw = String(process.env.GPT_REASONING_EFFORT ?? '').trim();
    if (!raw) {
        return { effort: OPENAI_REASONING_EFFORT_GEMINI_FLASH_PARITY, invalidRaw: null };
    }
    const effort = parseOpenAiReasoningEffort(raw);
    return effort ? { effort, invalidRaw: null } : { effort: null, invalidRaw: raw };
}

export function applyOpenAiReasoningEffort(
    params: Record<string, unknown>,
    api: 'responses' | 'chat',
    effort: OpenAiReasoningEffort,
): void {
    if (api === 'responses') {
        params.reasoning = { effort };
        return;
    }
    params.reasoning_effort = effort;
}

/**
 * OpenAI service tiers supported via GPT_SERVICE_TIER (OpenAI-only).
 * Prefer `fast` (recommended). `priority` is OpenAI's backwards-compatible alias for Fast mode.
 */
export const OPENAI_SERVICE_TIERS = ['fast', 'priority'] as const;

export type OpenAiServiceTier = (typeof OPENAI_SERVICE_TIERS)[number];

export function parseOpenAiServiceTier(
    raw: string | undefined | null,
): OpenAiServiceTier | null {
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if ((OPENAI_SERVICE_TIERS as readonly string[]).includes(normalized)) {
        return normalized as OpenAiServiceTier;
    }
    return null;
}

/**
 * Resolve GPT_SERVICE_TIER from env.
 * Unset/empty → no parameter (standard API behavior).
 * Invalid → serviceTier null + invalidRaw for warning.
 */
export function resolveOpenAiServiceTierFromEnv(): {
    serviceTier: OpenAiServiceTier | null;
    invalidRaw: string | null;
} {
    const raw = String(process.env.GPT_SERVICE_TIER ?? '').trim();
    if (!raw) {
        return { serviceTier: null, invalidRaw: null };
    }
    const serviceTier = parseOpenAiServiceTier(raw);
    return serviceTier
        ? { serviceTier, invalidRaw: null }
        : { serviceTier: null, invalidRaw: raw };
}

/** Both Responses and Chat Completions use the same `service_tier` field. */
export function applyOpenAiServiceTier(
    params: Record<string, unknown>,
    _api: 'responses' | 'chat',
    serviceTier: OpenAiServiceTier,
): void {
    params.service_tier = serviceTier;
}
