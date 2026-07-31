export const ELEVENLABS_VOICES = [
  { id: "bIHbv24MWmeRgasZH58o", label: "Will" },
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam" },
  { id: "nPczCjzI2devNBz1zQrb", label: "Brian" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah" },
  { id: "hpp4J3VqNfWAUOO0d1Us", label: "Bella" },
] as const;

export const ELEVENLABS_VOICE_IDS = new Set<string>(
  ELEVENLABS_VOICES.map((voice) => voice.id),
);

export const DEFAULT_ELEVENLABS_VOICE_ID = ELEVENLABS_VOICES[0].id;

const LEGACY_ELEVENLABS_VOICE_IDS: Record<string, string> = {
  "21m00Tcm4TlvDq8ikWAM": "EXAVITQu4vr4xnSDxMaL",
  ErXwobaYiN019PkySvjV: "nPczCjzI2devNBz1zQrb",
};

const KOKORO_VOICE_PATTERN = /^(af|am|bf|bm)_/i;

export function normalizeElevenLabsVoiceId(voice: string | null | undefined): string | null {
  const trimmed = String(voice ?? "").trim();
  if (!trimmed) return null;

  const legacy = LEGACY_ELEVENLABS_VOICE_IDS[trimmed];
  if (legacy) return legacy;

  if (ELEVENLABS_VOICE_IDS.has(trimmed)) return trimmed;

  if (KOKORO_VOICE_PATTERN.test(trimmed)) {
    return DEFAULT_ELEVENLABS_VOICE_ID;
  }

  return null;
}

export function isKnownRenderVoice(voice: string): boolean {
  return normalizeElevenLabsVoiceId(voice) !== null;
}

export function resolveRenderVoice(raw: unknown): string {
  return normalizeElevenLabsVoiceId(typeof raw === "string" ? raw : "") ?? DEFAULT_ELEVENLABS_VOICE_ID;
}
