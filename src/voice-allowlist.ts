const KNOWN_RENDER_VOICES = new Set([
  "af_heart",
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  "bf_emma",
  "bf_isabella",
  "bf_alice",
  "bf_lily",
  "bm_george",
  "bm_lewis",
  "bm_daniel",
  "bm_fable",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Zephyr",
]);

const DEFAULT_RENDER_VOICE = "af_heart";

export function isKnownRenderVoice(voice: string): boolean {
  return KNOWN_RENDER_VOICES.has(voice);
}

export function resolveRenderVoice(raw: unknown): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return DEFAULT_RENDER_VOICE;
  return isKnownRenderVoice(trimmed) ? trimmed : DEFAULT_RENDER_VOICE;
}
