import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
    DEFAULT_PRIMARY_COOLDOWN_MS,
    LlmRateLimitError,
    clampLlmRetryWaitMs,
    isLlmRateLimitError,
    parseRetryAfterMs,
    primaryCooldownUntilMs,
    resolveLlmFallbackModel,
} from './llm_rate_limit.js';

const ORIGINAL_FALLBACK = process.env.LLM_FALLBACK_MODEL;

afterEach(() => {
    if (ORIGINAL_FALLBACK === undefined) delete process.env.LLM_FALLBACK_MODEL;
    else process.env.LLM_FALLBACK_MODEL = ORIGINAL_FALLBACK;
});

describe('isLlmRateLimitError', () => {
    it('detects LlmRateLimitError instances', () => {
        assert.equal(isLlmRateLimitError(new LlmRateLimitError('limited')), true);
    });

    it('detects status 429', () => {
        assert.equal(isLlmRateLimitError({ status: 429, message: 'Too Many Requests' }), true);
        assert.equal(isLlmRateLimitError({ statusCode: 429 }), true);
        assert.equal(isLlmRateLimitError({ code: 429 }), true);
    });

    it('detects RateLimitError name', () => {
        const err = new Error('rate limited');
        err.name = 'RateLimitError';
        assert.equal(isLlmRateLimitError(err), true);
    });

    it('detects message with rate_limit_exceeded', () => {
        assert.equal(
            isLlmRateLimitError(new Error('Error code: 429 - rate_limit_exceeded')),
            true
        );
    });

    it('detects RESOURCE_EXHAUSTED and bare 429 in message', () => {
        assert.equal(isLlmRateLimitError(new Error('RESOURCE_EXHAUSTED: quota')), true);
        assert.equal(isLlmRateLimitError(new Error('HTTP 429 from provider')), true);
    });

    it('does not match bare TPM alone', () => {
        assert.equal(isLlmRateLimitError(new Error('TPM budget remaining')), false);
    });

    it('returns false for unrelated errors', () => {
        assert.equal(isLlmRateLimitError(new Error('server overloaded')), false);
        assert.equal(isLlmRateLimitError({ status: 500 }), false);
        assert.equal(isLlmRateLimitError(null), false);
    });
});

describe('parseRetryAfterMs', () => {
    it('parses "Please try again in 10.748s"', () => {
        assert.equal(
            parseRetryAfterMs(new Error('Please try again in 10.748s')),
            10748
        );
    });

    it('parses millisecond retry hints', () => {
        assert.equal(parseRetryAfterMs(new Error('Retry in 2500ms')), 2500);
    });

    it('reads retry-after header when present', () => {
        assert.equal(
            parseRetryAfterMs({ message: 'limited', headers: { 'retry-after': '5' } }),
            5000
        );
    });

    it('reads Web Headers get() and retry-after-ms', () => {
        const headers = {
            get(name: string) {
                if (name === 'retry-after-ms') return '2500';
                return null;
            },
        };
        assert.equal(parseRetryAfterMs({ message: 'limited', headers }), 2500);

        const headersSeconds = {
            get(name: string) {
                if (name === 'retry-after') return '3';
                return null;
            },
        };
        assert.equal(parseRetryAfterMs({ message: 'limited', headers: headersSeconds }), 3000);
    });

    it('prefers LlmRateLimitError.retryAfterMs when set', () => {
        assert.equal(
            parseRetryAfterMs(
                new LlmRateLimitError('wrapped', { retryAfterMs: 4242 })
            ),
            4242
        );
    });

    it('returns null when no retry hint exists', () => {
        assert.equal(parseRetryAfterMs(new Error('no retry info')), null);
    });
});

describe('clampLlmRetryWaitMs', () => {
    it('clamps to [1s, 120s]', () => {
        assert.equal(clampLlmRetryWaitMs(100), 1_000);
        assert.equal(clampLlmRetryWaitMs(5_000), 5_000);
        assert.equal(clampLlmRetryWaitMs(200_000), 120_000);
    });
});

describe('primaryCooldownUntilMs', () => {
    it('uses parseRetryAfterMs when present', () => {
        const nowMs = 1_000_000;
        assert.equal(
            primaryCooldownUntilMs(new Error('Please try again in 10.748s'), nowMs),
            nowMs + 10748
        );
        assert.equal(
            primaryCooldownUntilMs(new LlmRateLimitError('wrapped', { retryAfterMs: 4242 }), nowMs),
            nowMs + 4242
        );
    });

    it('defaults to 60s when absent', () => {
        const nowMs = 2_000_000;
        assert.equal(
            primaryCooldownUntilMs(new Error('no retry info'), nowMs),
            nowMs + DEFAULT_PRIMARY_COOLDOWN_MS
        );
    });

    it('clamps to [1s, 120s]', () => {
        const nowMs = 3_000_000;
        assert.equal(
            primaryCooldownUntilMs(new Error('Retry in 100ms'), nowMs),
            nowMs + 1_000
        );
        assert.equal(
            primaryCooldownUntilMs(new Error('Please try again in 200s'), nowMs),
            nowMs + 120_000
        );
    });
});

describe('resolveLlmFallbackModel', () => {
    it('defaults gpt primary to gemini-3.5-flash', () => {
        delete process.env.LLM_FALLBACK_MODEL;
        assert.equal(resolveLlmFallbackModel('gpt-5.6-luna'), 'gemini-3.5-flash');
    });

    it('returns null for gemini primary', () => {
        delete process.env.LLM_FALLBACK_MODEL;
        assert.equal(resolveLlmFallbackModel('gemini-3.5-flash'), null);
        // Env override cannot create a gemini→gemini "equals primary" path:
        // gemini primary returns null before fallback resolution.
        process.env.LLM_FALLBACK_MODEL = 'gemini-3.5-flash';
        assert.equal(resolveLlmFallbackModel('gemini-3.5-flash'), null);
    });

    it('uses LLM_FALLBACK_MODEL env override', () => {
        process.env.LLM_FALLBACK_MODEL = 'gemini-2.5-flash';
        assert.equal(resolveLlmFallbackModel('gpt-5.6-luna'), 'gemini-2.5-flash');
    });

    it('returns null when env fallback is another gpt model', () => {
        process.env.LLM_FALLBACK_MODEL = 'gpt-4o';
        assert.equal(resolveLlmFallbackModel('gpt-5.6-luna'), null);
        process.env.LLM_FALLBACK_MODEL = ' GPT-5.6-luna ';
        assert.equal(resolveLlmFallbackModel('gpt-5.6-luna'), null);
    });
});
