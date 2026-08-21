/**
 * Spoken-form overrides for TTS. Captions keep authored text; only speech uses this list.
 *
 * Key: the whole word as it appears in narration.
 * Value: what we send to the TTS engine.
 *
 * - ALL CAPS keys match that casing only (`NASA`, never `nasa` / `us` vs `US`).
 * - lowercase keys also match sentence case (`cosine` and `Cosine`).
 * - Same key and value (`NASA: 'NASA'`) means "say this as one word"
 *   instead of letter-spacing (`N A S A`).
 * - Different value (`cosine: 'cosign'`) means "say it this way instead".
 *
 * Unlisted 2–6 letter ALL CAPS tokens are still spelled out (`RSA` → `R S A`).
 *
 * Add a line when you hear a wrong pronunciation. Next resolve/live TTS pick it up.
 * Keep in sync: mylecture-agent/src/resolve-render/tts-pronunciation-overrides.ts
 */
export declare const TTS_PRONUNCIATION_OVERRIDES: Record<string, string>;
