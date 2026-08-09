import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
    DEFAULT_PRIMARY_COOLDOWN_MS,
    LlmRateLimitError,
    clampLlmRetryWaitMs,
    isLlmCapacityError,
    isLlmRateLimitError,
    isLlmTransientProviderError,
    parseRetryAfterMs,
    primaryCooldownUntilMs,
    resolveLlmFallbackModel,
} from './llm_rate_limit.js';

const ORIGINAL_FALLBACK = process.env.LLM_FALLBACK_MODEL;
const ORIGINAL_OPENAI_FALLBACK = process.env.OPENAI_FALLBACK_MODEL;

afterEach(() => {
    if (ORIGINAL_FALLBACK === undefined) delete process.env.LLM_FALLBACK_MODEL;
    else process.env.LLM_FALLBACK_MODEL = ORIGINAL_FALLBACK;
    if (ORIGINAL_OPENAI_FALLBACK === undefined) delete process.env.OPENAI_FALLBACK_MODEL;
    else process.env.OPENAI_FALLBACK_MODEL = ORIGINAL_OPENAI_FALLBACK;
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

describe('isLlmTransientProviderError', () => {
    it('detects provider capacity failures', () => {
        assert.equal(isLlmTransientProviderError({ status: 503 }), true);
        assert.equal(
            isLlmTransientProviderError(new Error('UNAVAILABLE: model is experiencing high demand')),
            true
        );
    });

    it('includes rate limits but excludes permanent errors', () => {
        assert.equal(isLlmTransientProviderError({ status: 429 }), true);
        assert.equal(isLlmTransientProviderError(new Error('invalid tool output')), false);
    });
});

describe('isLlmCapacityError', () => {
    it('detects high-demand and unavailable responses', () => {
        assert.equal(isLlmCapacityError({ status: 503 }), true);
        assert.equal(isLlmCapacityError(new Error('This model is currently experiencing high demand')), true);
        assert.equal(isLlmCapacityError(new Error('UNAVAILABLE')), true);
    });

    it('does not classify unrelated provider failures as capacity errors', () => {
        assert.equal(isLlmCapacityError({ status: 500 }), false);
        assert.equal(isLlmCapacityError(new Error('invalid tool output')), false);
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

    it('defaults gemini primary to gpt-5.6-luna', () => {
        delete process.env.LLM_FALLBACK_MODEL;
        delete process.env.OPENAI_FALLBACK_MODEL;
        assert.equal(resolveLlmFallbackModel('gemini-3.5-flash'), 'gpt-5.6-luna');
        // Env override cannot create a gemini→gemini "equals primary" path:
        // The resolver ignores that same-provider value and uses the OpenAI default.
        process.env.LLM_FALLBACK_MODEL = 'gemini-3.5-flash';
        assert.equal(resolveLlmFallbackModel('gemini-3.5-flash'), 'gpt-5.6-luna');
    });

    it('uses OPENAI_FALLBACK_MODEL for gemini primary', () => {
        process.env.OPENAI_FALLBACK_MODEL = 'gpt-5.6-luna-custom';
        assert.equal(
            resolveLlmFallbackModel('gemini-3.5-flash'),
            'gpt-5.6-luna-custom'
        );
    });

    it('uses LLM_FALLBACK_MODEL env override', () => {
        process.env.LLM_FALLBACK_MODEL = 'gemini-2.5-flash';
        assert.equal(resolveLlmFallbackModel('gpt-5.6-luna'), 'gemini-2.5-flash');
    });

    it('ignores same-provider env fallback for gpt primary', () => {
        process.env.LLM_FALLBACK_MODEL = 'gpt-4o';
        assert.equal(resolveLlmFallbackModel('gpt-5.6-luna'), 'gemini-3.5-flash');
        process.env.LLM_FALLBACK_MODEL = ' GPT-5.6-luna ';
        assert.equal(resolveLlmFallbackModel('gpt-5.6-luna'), 'gemini-3.5-flash');
    });
});
