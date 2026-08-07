/** Format target seconds as a generationLength string accepted by lecture-agent (e.g. 90s, 2:30). */
export function formatGenerationLengthFromSeconds(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
