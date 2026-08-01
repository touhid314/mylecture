/**
 * ElevenLabs continuity helpers for narration batches.
 */

export const ELEVENLABS_CONTEXT_MAX_CHARS = 500;

/** Tail of prior narration — end of everything said before this cue. */
export function truncateElevenLabsPreviousText(
  text: string | null | undefined,
  maxChars = ELEVENLABS_CONTEXT_MAX_CHARS
): string | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(-maxChars);
}

/** Start of following narration — beginning of everything still to come. */
export function truncateElevenLabsNextText(
  text: string | null | undefined,
  maxChars = ELEVENLABS_CONTEXT_MAX_CHARS
): string | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars);
}

export type NarrationSpokenItem = { id: string; text: string };

export function narrationSpokenTextsInOrder(
  plan: Array<{ id?: string; kind?: string; text?: string; ttsText?: string }>,
  normalizeSectionKind: (kind: string | undefined) => string,
  normalizeTtsText: (text: string) => string
): NarrationSpokenItem[] {
  const items: NarrationSpokenItem[] = [];
  for (const section of plan) {
    if (!section?.id) continue;
    if (normalizeSectionKind(section.kind) !== 'narration+visual') continue;
    const spoken = section.ttsText ?? section.text;
    if (!String(spoken ?? '').trim()) continue;
    items.push({ id: section.id, text: normalizeTtsText(String(spoken)) });
  }
  return items;
}

/** Cumulative scene context for one cue (truncated to ElevenLabs limits). */
export function elevenLabsContextForSection(
  narrationItems: NarrationSpokenItem[],
  sectionId: string,
  crossScene?: {
    priorSceneText?: string | null;
    followingSceneText?: string | null;
  }
): { previousText: string | null; nextText: string | null } {
  const idx = narrationItems.findIndex((item) => item.id === sectionId);
  if (idx < 0) return { previousText: null, nextText: null };

  const inFilePrior = narrationItems
    .slice(0, idx)
    .map((item) => item.text)
    .join(' ');
  const inFileFollowing = narrationItems
    .slice(idx + 1)
    .map((item) => item.text)
    .join(' ');

  const priorParts: string[] = [];
  if (idx === 0 && crossScene?.priorSceneText?.trim()) {
    priorParts.push(crossScene.priorSceneText.trim());
  }
  if (inFilePrior.trim()) priorParts.push(inFilePrior.trim());

  const followingParts: string[] = [];
  if (inFileFollowing.trim()) followingParts.push(inFileFollowing.trim());
  if (
    idx === narrationItems.length - 1 &&
    crossScene?.followingSceneText?.trim()
  ) {
    followingParts.push(crossScene.followingSceneText.trim());
  }

  const priorCombined = priorParts.join(' ');
  const followingCombined = followingParts.join(' ');

  const previousText = priorCombined.trim()
    ? truncateElevenLabsPreviousText(priorCombined)
    : null;
  const nextText = followingCombined.trim()
    ? truncateElevenLabsNextText(followingCombined)
    : null;
  return { previousText, nextText };
}
