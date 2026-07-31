import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  isKnownRenderVoice,
  normalizeElevenLabsVoiceId,
} from "./voice-allowlist.ts";

export {
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_VOICE_IDS,
  ELEVENLABS_VOICES,
  isKnownRenderVoice,
  normalizeElevenLabsVoiceId,
  resolveRenderVoice,
} from "./voice-allowlist.ts";

export function resolveTtsProviderFromEnv(): string {
  return "elevenlabs";
}

export function resolveTtsProvider(
  _voice?: string | null,
  _override?: string | null,
): string {
  return "elevenlabs";
}

export function resolveTtsVoice(_provider: string, raw: unknown): string {
  return (
    normalizeElevenLabsVoiceId(typeof raw === "string" ? raw : "") ??
    DEFAULT_ELEVENLABS_VOICE_ID
  );
}

export function isElevenLabsVoiceId(voice: string): boolean {
  return isKnownRenderVoice(voice);
}
