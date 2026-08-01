/**
 * Helpers for detecting LLM provider rate limits (e.g. OpenAI TPM 429)
 * and resolving a LectureGen fallback model.
 */

export class LlmRateLimitError extends Error {
    retryAfterMs: number | null;
    provider?: string;
    model?: string;

    constructor(
        message: string,
        options?: {
            retryAfterMs?: number | null;
            provider?: string;
            model?: string;
        }
    ) {
        super(message);
        this.name = 'LlmRateLimitError';
        this.retryAfterMs = options?.retryAfterMs ?? null;
        this.provider = options?.provider;
        this.model = options?.model;
    }
}

const RATE_LIMIT_MESSAGE_RE =
    /rate_limit|rate limit|tokens per min|RESOURCE_EXHAUSTED|\b429\b/i;

export function isLlmRateLimitError(err: unknown): boolean {
    if (err instanceof LlmRateLimitError) return true;
    if (err == null) return false;

    if (typeof err === 'object') {
        const e = err as Record<string, unknown>;
        if (e.name === 'LlmRateLimitError' || e.name === 'RateLimitError') return true;
        const status = e.status ?? e.statusCode ?? e.code;
        if (status === 429 || status === '429') return true;
        const message = String(e.message ?? '');
        if (RATE_LIMIT_MESSAGE_RE.test(message)) return true;
        return false;
    }

    return RATE_LIMIT_MESSAGE_RE.test(String(err));
}

function readHeaderValue(headers: unknown, name: string): string | null {
    if (headers == null || typeof headers !== 'object') return null;

    const getter = (headers as { get?: (key: string) => unknown }).get;
    if (typeof getter === 'function') {
        try {
            const value = getter.call(headers, name);
            if (value != null && value !== '') return String(value);
        } catch {
            // ignore non-Headers get failures
        }
    }

    const record = headers as Record<string, unknown>;
    const lower = name.toLowerCase();
    const raw =
        record[name] ??
        record[lower] ??
        record[name.replace(/(^|-)([a-z])/g, (_, p1, p2) => p1 + String(p2).toUpperCase())];
    if (raw != null && raw !== '') return String(raw);
    return null;
}

function parseRetryAfterHeaderMs(headers: unknown): number | null {
    const retryAfterMsRaw = readHeaderValue(headers, 'retry-after-ms');
    if (retryAfterMsRaw != null) {
        const ms = Number(retryAfterMsRaw);
        if (!Number.isNaN(ms)) return Math.round(ms);
    }

    const retryAfterRaw = readHeaderValue(headers, 'retry-after');
    if (retryAfterRaw != null) {
        const seconds = Number(retryAfterRaw);
        if (!Number.isNaN(seconds)) return Math.round(seconds * 1000);
    }

    return null;
}

export function parseRetryAfterMs(err: unknown): number | null {
    // Prefer value captured when wrapping so Headers are not lost after rethrow.
    if (err instanceof LlmRateLimitError && err.retryAfterMs != null) {
        return err.retryAfterMs;
    }

    if (err != null && typeof err === 'object') {
        const fromHeaders = parseRetryAfterHeaderMs((err as { headers?: unknown }).headers);
        if (fromHeaders != null) return fromHeaders;
    }

    const message =
        err instanceof Error
            ? err.message
            : err != null && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message ?? '')
              : String(err ?? '');

    const msMatch = message.match(/in\s+(\d+(?:\.\d+)?)\s*ms\b/i);
    if (msMatch) {
        return Math.round(parseFloat(msMatch[1]));
    }

    const secMatch = message.match(/in\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\b/i);
    if (secMatch) {
        return Math.round(parseFloat(secMatch[1]) * 1000);
    }

    return null;
}

export const DEFAULT_PRIMARY_COOLDOWN_MS = 60_000;
export const PRIMARY_RESTORE_FAILURE_PUSH_MS = 30_000;

const LLM_RETRY_WAIT_MIN_MS = 1_000;
const LLM_RETRY_WAIT_MAX_MS = 120_000;

export function clampLlmRetryWaitMs(ms: number): number {
    return Math.min(LLM_RETRY_WAIT_MAX_MS, Math.max(LLM_RETRY_WAIT_MIN_MS, ms));
}

export function primaryCooldownUntilMs(err: unknown, nowMs = Date.now()): number {
    const retryAfter = parseRetryAfterMs(err);
    const wait = retryAfter ?? DEFAULT_PRIMARY_COOLDOWN_MS;
    return nowMs + clampLlmRetryWaitMs(wait);
}

export function resolveLlmFallbackModel(primaryModel: string): string | null {
    const primary = primaryModel.trim();
    if (primary.toLowerCase().includes('gemini')) {
        return null;
    }

    const envFallback = process.env.LLM_FALLBACK_MODEL?.trim();
    let fallback: string | null = null;
    if (envFallback) {
        fallback = envFallback;
    } else if (primary.startsWith('gpt-')) {
        fallback = 'gemini-3.5-flash';
    } else {
        return null;
    }

    const trimmed = fallback.trim();
    // Gemini primary already returned above, so trimmed === primary is unreachable.
    if (!trimmed.toLowerCase().includes('gemini')) {
        return null;
    }
    return trimmed;
}
