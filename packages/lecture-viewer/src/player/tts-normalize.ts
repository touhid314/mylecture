/**
 * Keep in sync with mylecture/src/tts-normalize.ts.
 * Browser Live TTS uses this; build-plan uses the Node copy for rendered audio.
 * Captions keep the original text; only spoken output is rewritten.
 */

function stripDigitGroupCommas(text: string): string {
  let result = text;
  while (/\d,\d{3}(?!\d)/.test(result)) {
    result = result.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  }
  return result;
}

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
