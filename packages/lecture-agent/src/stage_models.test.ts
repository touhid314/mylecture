import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
    formatStageModelLog,
    isModelSlugContained,
    parseScriptCompareModels,
    resolveLectureGenStageModels,
    sanitizeModelSlug,
    uniqueModelSlugs,
} from './stage_models.js';

const ORIGINAL_SCRIPT = process.env.SCRIPT_MODEL;
const ORIGINAL_ANIMATOR = process.env.ANIMATOR_MODEL;
const WORKSPACE = path.resolve('/tmp/lecturegen-compare-workspace');

afterEach(() => {
    if (ORIGINAL_SCRIPT === undefined) delete process.env.SCRIPT_MODEL;
    else process.env.SCRIPT_MODEL = ORIGINAL_SCRIPT;
    if (ORIGINAL_ANIMATOR === undefined) delete process.env.ANIMATOR_MODEL;
    else process.env.ANIMATOR_MODEL = ORIGINAL_ANIMATOR;
});

describe('resolveLectureGenStageModels', () => {
    it('falls back to default model when stage env/options are unset', () => {
        delete process.env.SCRIPT_MODEL;
        delete process.env.ANIMATOR_MODEL;
        assert.deepEqual(resolveLectureGenStageModels({ model: 'gemini-3.5-flash' }), {
            scriptModel: 'gemini-3.5-flash',
            animatorModel: 'gemini-3.5-flash',
            defaultModel: 'gemini-3.5-flash',
        });
    });

    it('prefers SCRIPT_MODEL and ANIMATOR_MODEL env over default', () => {
        process.env.SCRIPT_MODEL = 'gpt-5.6-luna';
        process.env.ANIMATOR_MODEL = 'gemini-3.5-flash';
        assert.deepEqual(resolveLectureGenStageModels({ model: 'fallback' }), {
            scriptModel: 'gpt-5.6-luna',
            animatorModel: 'gemini-3.5-flash',
            defaultModel: 'fallback',
        });
    });

    it('prefers explicit options over env', () => {
        process.env.SCRIPT_MODEL = 'env-script';
        process.env.ANIMATOR_MODEL = 'env-animator';
        assert.deepEqual(
            resolveLectureGenStageModels({
                model: 'fallback',
                scriptModel: 'opt-script',
                animatorModel: 'opt-animator',
            }),
            {
                scriptModel: 'opt-script',
                animatorModel: 'opt-animator',
                defaultModel: 'fallback',
            }
        );
    });

    it('rejects an empty default model', () => {
        assert.throws(() => resolveLectureGenStageModels({ model: '  ' }), /default model/i);
    });
});

describe('parseScriptCompareModels', () => {
    it('parses two or more distinct models', () => {
        assert.deepEqual(parseScriptCompareModels('gpt-5.6-luna, gemini-3.5-flash'), [
            'gpt-5.6-luna',
            'gemini-3.5-flash',
        ]);
    });

    it('rejects fewer than two models', () => {
        assert.throws(() => parseScriptCompareModels('only-one'), /at least two/i);
        assert.throws(() => parseScriptCompareModels(''), /at least two/i);
        assert.throws(() => parseScriptCompareModels(',,'), /at least two/i);
    });

    it('rejects duplicate models case-insensitively', () => {
        assert.throws(
            () => parseScriptCompareModels('gemini-3.5-flash,Gemini-3.5-flash'),
            /distinct|duplicate/i
        );
    });
});

describe('sanitizeModelSlug / uniqueModelSlugs / containment', () => {
    it('replaces unsafe characters', () => {
        assert.equal(sanitizeModelSlug('org/gpt 5.6'), 'org-gpt-5.6');
    });

    it('never yields . or .. (path containment)', () => {
        for (const raw of ['..', '.', '...', '../evil', '..\\..']) {
            const slug = sanitizeModelSlug(raw);
            assert.notEqual(slug, '.');
            assert.notEqual(slug, '..');
            assert.ok(!/^\.+$/.test(slug), `slug for ${raw} was dots-only: ${slug}`);
            assert.equal(isModelSlugContained(WORKSPACE, slug), true, `slug ${slug} from ${raw}`);
            const joined = path.resolve(WORKSPACE, slug);
            assert.ok(
                joined === path.join(WORKSPACE, slug) || joined.startsWith(WORKSPACE + path.sep),
                `escaped for ${raw}: ${joined}`
            );
        }
    });

    it('reserves uploads/assets and other workspace names', () => {
        assert.notEqual(sanitizeModelSlug('uploads'), 'uploads');
        assert.notEqual(sanitizeModelSlug('assets'), 'assets');
        assert.ok(isModelSlugContained(WORKSPACE, sanitizeModelSlug('uploads')));
        assert.ok(isModelSlugContained(WORKSPACE, sanitizeModelSlug('assets')));
    });

    it('maps empty / punctuation-only ids to a safe slug', () => {
        assert.equal(sanitizeModelSlug('!!!'), 'model');
        assert.equal(sanitizeModelSlug(''), 'model');
        assert.ok(isModelSlugContained(WORKSPACE, sanitizeModelSlug('!!!')));
    });

    it('isModelSlugContained rejects traversal segments', () => {
        assert.equal(isModelSlugContained(WORKSPACE, '..'), false);
        assert.equal(isModelSlugContained(WORKSPACE, '.'), false);
        assert.equal(isModelSlugContained(WORKSPACE, 'a/b'), false);
        assert.equal(isModelSlugContained(WORKSPACE, 'safe-model'), true);
    });

    it('disambiguates colliding slugs', () => {
        assert.deepEqual(uniqueModelSlugs(['a/b', 'a b', 'other']), ['a-b', 'a-b-2', 'other']);
    });
});

describe('formatStageModelLog', () => {
    it('mentions both stage models', () => {
        const text = formatStageModelLog({
            scriptModel: 'luna',
            animatorModel: 'gemini',
            defaultModel: 'gemini',
        });
        assert.match(text, /luna/);
        assert.match(text, /gemini/);
    });
});
