/**
 * Canonical TTS text normalizer (single source for Live TTS and build-plan).
 * Captions keep the original text; only spoken output is rewritten.
 */
export declare function normalizeTtsText(text: string): string;
