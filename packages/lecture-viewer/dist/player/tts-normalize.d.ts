/**
 * Keep in sync with mylecture/src/tts-normalize.ts.
 * Browser Live TTS uses this; build-plan uses the Node copy for rendered audio.
 * Captions keep the original text; only spoken output is rewritten.
 */
export declare function normalizeTtsText(text: string): string;
