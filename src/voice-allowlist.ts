export const ELEVENLABS_VOICES = [
  { id: "iP95p4xoKVk53GoZ742B", label: "Chris" },
  { id: "kdnRe2koJdOK4Ovxn2DI", label: "Eryn" },
  { id: "BtWabtumIemAotTjP5sk", label: "Robert" },
] as const;

export const ELEVENLABS_VOICE_IDS = new Set<string>(
  ELEVENLABS_VOICES.map((voice) => voice.id),
);

export const DEFAULT_ELEVENLABS_VOICE_ID = ELEVENLABS_VOICES[0].id;

const LEGACY_ELEVENLABS_VOICE_IDS: Record<string, string> = {
  "21m00Tcm4TlvDq8ikWAM": "iP95p4xoKVk53GoZ742B",
  ErXwobaYiN019PkySvjV: "iP95p4xoKVk53GoZ742B",
  iEOxQFQCsS8EZp02fvAX: "iP95p4xoKVk53GoZ742B",
  bIHbv24MWmeRgasZH58o: "iP95p4xoKVk53GoZ742B",
  pNInz6obpgDQGcFmaJgB: "iP95p4xoKVk53GoZ742B",
  nPczCjzI2devNBz1zQrb: "iP95p4xoKVk53GoZ742B",
  EXAVITQu4vr4xnSDxMaL: "iP95p4xoKVk53GoZ742B",
  hpp4J3VqNfWAUOO0d1Us: "iP95p4xoKVk53GoZ742B",
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

export function isElevenLabsCatalogVoice(voice: string | null | undefined): boolean {
  const trimmed = String(voice ?? "").trim();
  if (!trimmed) return false;
  return Boolean(LEGACY_ELEVENLABS_VOICE_IDS[trimmed]) || ELEVENLABS_VOICE_IDS.has(trimmed);
}

export function isKnownRenderVoice(voice: string): boolean {
  return normalizeElevenLabsVoiceId(voice) !== null;
}

export function resolveRenderVoice(raw: unknown): string {
  return normalizeElevenLabsVoiceId(typeof raw === "string" ? raw : "") ?? DEFAULT_ELEVENLABS_VOICE_ID;
}
