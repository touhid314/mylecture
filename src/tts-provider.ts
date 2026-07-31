import { isKnownRenderVoice, resolveRenderVoice } from "./voice-allowlist.ts";

const KOKORO_VOICE_PATTERN = /^(af|am|bf|bm)_/i;

const GEMINI_VOICES = new Set([
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Zephyr",
]);

export const ELEVENLABS_VOICE_IDS = new Set([
  "bIHbv24MWmeRgasZH58o", // Will
  "21m00Tcm4TlvDq8ikWAM", // Rachel
  "pNInz6obpgDQGcFmaJgB", // Adam
  "ErXwobaYiN019PkySvjV", // Antoni
  "EXAVITQu4vr4xnSDxMaL", // Bella
]);

export const DEFAULT_ELEVENLABS_VOICE_ID = "bIHbv24MWmeRgasZH58o";

export function isElevenLabsVoiceId(voice: string): boolean {
  const trimmed = voice.trim();
  if (!trimmed) return false;
  if (ELEVENLABS_VOICE_IDS.has(trimmed)) return true;
  // ElevenLabs IDs are typically 20+ alphanumeric chars (not Kokoro/Gemini names).
  return (
    trimmed.length >= 20 &&
    /^[A-Za-z0-9]+$/.test(trimmed) &&
    !KOKORO_VOICE_PATTERN.test(trimmed) &&
    !GEMINI_VOICES.has(trimmed)
  );
}

export function detectTtsProviderFromVoice(voice: string | null | undefined): string {
  const trimmed = String(voice ?? "").trim();
  if (!trimmed) return resolveTtsProviderFromEnv();

  if (isElevenLabsVoiceId(trimmed)) {
    return "elevenlabs";
  }
  if (KOKORO_VOICE_PATTERN.test(trimmed) || isKnownRenderVoice(trimmed)) {
    return "kokoro";
  }
  if (GEMINI_VOICES.has(trimmed)) {
    return "google";
  }
  return resolveTtsProviderFromEnv();
}

export function resolveTtsProviderFromEnv(): string {
  const raw = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (raw === "elevenlabs" || raw === "11labs") return "elevenlabs";
  if (raw) return raw;
  return "kokoro";
}

export function resolveTtsProvider(
  voice: string | null | undefined,
  override?: string | null,
): string {
  const fromOverride = override?.trim().toLowerCase();
  if (fromOverride) {
    return fromOverride === "11labs" ? "elevenlabs" : fromOverride;
  }
  const fromEnv = resolveTtsProviderFromEnv();
  if (fromEnv !== "kokoro") {
    return fromEnv;
  }
  return detectTtsProviderFromVoice(voice);
}

export function resolveTtsVoice(provider: string, raw: unknown): string {
  const voice = typeof raw === "string" ? raw.trim() : "";
  const normalizedProvider = provider === "11labs" ? "elevenlabs" : provider;

  if (normalizedProvider === "elevenlabs") {
    if (isElevenLabsVoiceId(voice)) {
      return voice;
    }
    return (
      process.env.ELEVENLABS_TTS_VOICE?.trim() ||
      process.env.ELEVENLABS_VOICE_ID?.trim() ||
      DEFAULT_ELEVENLABS_VOICE_ID
    );
  }

  return resolveRenderVoice(raw);
}
