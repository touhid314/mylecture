/**
 * tts-normalize.ts
 *
 * Minimal deterministic normalization applied to narration text right before
 * it is sent to the TTS engine. Captions and on-screen text keep the original
 * formatting; only the spoken text is rewritten.
 *
 * Intentionally limited to mechanical, unambiguous cases that TTS engines
 * consistently misread. Context-dependent verbalization (years, ratios,
 * ranges, names) is the script generator's responsibility.
 */

/** Strip comma separators inside digit groups: "1,700" -> "1700". */
function stripDigitGroupCommas(text: string): string {
  let result = text;
  while (/\d,\d{3}(?!\d)/.test(result)) {
    result = result.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  }
  return result;
}

/** Expand "$X" (optionally "$X million" etc.) to "X [scale] dollars". */
function expandCurrency(text: string): string {
  const withAttributiveAmounts = text.replace(
    /\b(a|an)\s+\$(\d+(?:\.\d+)?)(?:\s+(thousand|million|billion|trillion))?\s+([a-z][a-z-]*)/gi,
    (_match, article: string, amount: string, scale: string | undefined, noun: string) =>
      `${article} ${amount}${scale ? ` ${scale}` : ''} dollar ${noun}`
  );

  return withAttributiveAmounts.replace(
    /\$(\d+(?:\.\d+)?)((?:\s(?:thousand|million|billion|trillion))?)/gi,
    (_match, amount: string, scale: string) => {
      const unit = amount === '1' && !scale ? 'dollar' : 'dollars';
      return `${amount}${scale} ${unit}`;
    }
  );
}

/** Expand "X%" to "X percent". */
function expandPercent(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?)%/g, '$1 percent');
}

export function normalizeTtsText(text: string): string {
  let result = String(text ?? '');
  result = stripDigitGroupCommas(result);
  result = expandCurrency(result);
  result = expandPercent(result);
  return result;
}
