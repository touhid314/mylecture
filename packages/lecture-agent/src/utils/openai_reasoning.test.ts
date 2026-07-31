import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
    OPENAI_REASONING_EFFORTS,
    OPENAI_REASONING_EFFORT_GEMINI_FLASH_PARITY,
    OPENAI_SERVICE_TIERS,
    applyOpenAiReasoningEffort,
    applyOpenAiServiceTier,
    parseOpenAiReasoningEffort,
    parseOpenAiServiceTier,
    resolveOpenAiReasoningEffortFromEnv,
    resolveOpenAiServiceTierFromEnv,
} from './openai_reasoning.js';

const ORIGINAL_REASONING = process.env.GPT_REASONING_EFFORT;
const ORIGINAL_SERVICE_TIER = process.env.GPT_SERVICE_TIER;

afterEach(() => {
    if (ORIGINAL_REASONING === undefined) delete process.env.GPT_REASONING_EFFORT;
    else process.env.GPT_REASONING_EFFORT = ORIGINAL_REASONING;
    if (ORIGINAL_SERVICE_TIER === undefined) delete process.env.GPT_SERVICE_TIER;
    else process.env.GPT_SERVICE_TIER = ORIGINAL_SERVICE_TIER;
});

describe('parseOpenAiReasoningEffort', () => {
    it('accepts supported values case-insensitively', () => {
        assert.equal(parseOpenAiReasoningEffort('MAX'), 'max');
        assert.equal(parseOpenAiReasoningEffort(' High '), 'high');
    });

    it('rejects unknown values', () => {
        assert.equal(parseOpenAiReasoningEffort('turbo'), null);
        assert.equal(parseOpenAiReasoningEffort(''), null);
    });
});

describe('resolveOpenAiReasoningEffortFromEnv', () => {
    it('defaults to Gemini Flash parity when unset', () => {
        delete process.env.GPT_REASONING_EFFORT;
        assert.deepEqual(resolveOpenAiReasoningEffortFromEnv(), {
            effort: OPENAI_REASONING_EFFORT_GEMINI_FLASH_PARITY,
            invalidRaw: null,
        });
    });

    it('reads GPT_REASONING_EFFORT from env', () => {
        process.env.GPT_REASONING_EFFORT = 'max';
        assert.deepEqual(resolveOpenAiReasoningEffortFromEnv(), { effort: 'max', invalidRaw: null });
    });

    it('returns invalidRaw for unsupported values', () => {
        process.env.GPT_REASONING_EFFORT = 'gpt-5-luna-max';
        assert.deepEqual(resolveOpenAiReasoningEffortFromEnv(), {
            effort: null,
            invalidRaw: 'gpt-5-luna-max',
        });
    });
});

describe('applyOpenAiReasoningEffort', () => {
    it('maps to Responses API shape', () => {
        const params: Record<string, unknown> = {};
        applyOpenAiReasoningEffort(params, 'responses', 'max');
        assert.deepEqual(params, { reasoning: { effort: 'max' } });
    });

    it('maps to Chat Completions shape', () => {
        const params: Record<string, unknown> = {};
        applyOpenAiReasoningEffort(params, 'chat', 'max');
        assert.deepEqual(params, { reasoning_effort: 'max' });
    });
});

describe('OPENAI_REASONING_EFFORTS', () => {
    it('includes max', () => {
        assert.ok(OPENAI_REASONING_EFFORTS.includes('max'));
    });
});

describe('parseOpenAiServiceTier', () => {
    it('accepts fast case-insensitively', () => {
        assert.equal(parseOpenAiServiceTier('fast'), 'fast');
        assert.equal(parseOpenAiServiceTier(' FAST '), 'fast');
    });

    it('accepts priority as Fast-mode alias case-insensitively', () => {
        assert.equal(parseOpenAiServiceTier('priority'), 'priority');
        assert.equal(parseOpenAiServiceTier(' PRIORITY '), 'priority');
    });

    it('rejects unknown and empty values', () => {
        assert.equal(parseOpenAiServiceTier('turbo'), null);
        assert.equal(parseOpenAiServiceTier(''), null);
        assert.equal(parseOpenAiServiceTier(null), null);
    });
});

describe('resolveOpenAiServiceTierFromEnv', () => {
    it('returns null serviceTier when unset (omit parameter)', () => {
        delete process.env.GPT_SERVICE_TIER;
        assert.deepEqual(resolveOpenAiServiceTierFromEnv(), {
            serviceTier: null,
            invalidRaw: null,
        });
    });

    it('returns null serviceTier when empty/whitespace', () => {
        process.env.GPT_SERVICE_TIER = '   ';
        assert.deepEqual(resolveOpenAiServiceTierFromEnv(), {
            serviceTier: null,
            invalidRaw: null,
        });
    });

    it('reads GPT_SERVICE_TIER=fast from env', () => {
        process.env.GPT_SERVICE_TIER = 'fast';
        assert.deepEqual(resolveOpenAiServiceTierFromEnv(), {
            serviceTier: 'fast',
            invalidRaw: null,
        });
    });

    it('reads GPT_SERVICE_TIER=priority from env', () => {
        process.env.GPT_SERVICE_TIER = 'priority';
        assert.deepEqual(resolveOpenAiServiceTierFromEnv(), {
            serviceTier: 'priority',
            invalidRaw: null,
        });
    });

    it('returns invalidRaw for unsupported values', () => {
        process.env.GPT_SERVICE_TIER = 'turbo';
        assert.deepEqual(resolveOpenAiServiceTierFromEnv(), {
            serviceTier: null,
            invalidRaw: 'turbo',
        });
    });
});

describe('applyOpenAiServiceTier', () => {
    it('sets service_tier on Responses API params', () => {
        const params: Record<string, unknown> = { model: 'gpt-5.6-luna' };
        applyOpenAiServiceTier(params, 'responses', 'fast');
        assert.equal(params.service_tier, 'fast');
        assert.equal(params.model, 'gpt-5.6-luna');
    });

    it('sets service_tier on Chat Completions params', () => {
        const params: Record<string, unknown> = { model: 'gpt-5.6-luna' };
        applyOpenAiServiceTier(params, 'chat', 'fast');
        assert.equal(params.service_tier, 'fast');
        assert.equal(params.model, 'gpt-5.6-luna');
    });

    it('passes priority through unchanged', () => {
        const params: Record<string, unknown> = {};
        applyOpenAiServiceTier(params, 'responses', 'priority');
        assert.equal(params.service_tier, 'priority');
    });

    it('does not affect reasoning effort fields', () => {
        const params: Record<string, unknown> = {};
        applyOpenAiReasoningEffort(params, 'responses', 'none');
        applyOpenAiServiceTier(params, 'responses', 'fast');
        assert.deepEqual(params, {
            reasoning: { effort: 'none' },
            service_tier: 'fast',
        });
    });
});

describe('OPENAI_SERVICE_TIERS', () => {
    it('includes fast and priority', () => {
        assert.ok(OPENAI_SERVICE_TIERS.includes('fast'));
        assert.ok(OPENAI_SERVICE_TIERS.includes('priority'));
    });
});
