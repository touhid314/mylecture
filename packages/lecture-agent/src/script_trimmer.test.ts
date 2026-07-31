import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
    getScriptTrimmerChunkSizes,
    trimScriptByNarration,
    validateAudiovisualScript,
} from './script_trimmer.js';

const ORIGINAL_CHUNK_SIZE = process.env.SCRIPT_TRIMMER_CHUNK_SIZE;

afterEach(() => {
    if (ORIGINAL_CHUNK_SIZE === undefined) delete process.env.SCRIPT_TRIMMER_CHUNK_SIZE;
    else process.env.SCRIPT_TRIMMER_CHUNK_SIZE = ORIGINAL_CHUNK_SIZE;
});

describe('validateAudiovisualScript', () => {
    it('accepts a script with paired N: and V: cues', () => {
        assert.doesNotThrow(() => validateAudiovisualScript(`
# Scene 1
N: A planet follows an ellipse.
V: Draw an elliptical orbit.
`));
    });

    it('rejects an empty script', () => {
        assert.throws(
            () => validateAudiovisualScript('   \n'),
            /Script validation failed: script is empty/
        );
    });

    it('reports missing N: prefixes when only V: cues are present', () => {
        assert.throws(
            () => validateAudiovisualScript(`
# Scene 1: The Shear Controversy

A tightly wound ball of yarn dropped into a turbulent river will naturally unravel.
V: Dark charcoal matte background.

For decades, biophysicists assumed a similar mechanism applied to globular proteins.
V: The macromolecule is centered in the velocity field.
`),
            (error: Error) => {
                assert.match(error.message, /found 2 V: visual cue\(s\) but no N: narration cues/);
                assert.match(error.message, /2 narration line\(s\) are missing the required "N: " prefix/);
                assert.match(error.message, /line 4, line 7/);
                return true;
            }
        );
    });

    it('reports partially prefixed scripts', () => {
        assert.throws(
            () => validateAudiovisualScript(`
N: This beat is formatted correctly.
V: Show a title card.

This beat forgot the prefix.
V: Show a diagram.
`),
            /1 narration line\(s\) are missing the required "N: " prefix \(line 5\)/
        );
    });
});

describe('trimScriptByNarration', () => {
    it('splits valid scripts into narration-sized blocks', () => {
        process.env.SCRIPT_TRIMMER_CHUNK_SIZE = '75';
        const blocks = trimScriptByNarration(`
# Scene 1
N: One.
V: Visual one.
N: Two.
V: Visual two.
`);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].narrationWords, 2);
    });

    it('fails fast with validation details before trimming', () => {
        process.env.SCRIPT_TRIMMER_CHUNK_SIZE = '75';
        assert.throws(
            () => trimScriptByNarration(`
Narration without a prefix.
V: Visual cue.
`),
            /Script validation failed:/
        );
    });
});

describe('getScriptTrimmerChunkSizes', () => {
    it('requires SCRIPT_TRIMMER_CHUNK_SIZE', () => {
        delete process.env.SCRIPT_TRIMMER_CHUNK_SIZE;
        assert.throws(
            () => getScriptTrimmerChunkSizes(),
            /SCRIPT_TRIMMER_CHUNK_SIZE is required/
        );
    });
});
