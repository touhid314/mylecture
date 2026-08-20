/**
 * Canonical TTS text normalizer (single source for Live TTS and build-plan).
 * Captions keep the original text; only spoken output is rewritten.
 *
 * Pronunciation exceptions live in tts-pronunciation-overrides.ts.
 */
import { TTS_PRONUNCIATION_OVERRIDES } from './tts-pronunciation-overrides.js';

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

const ORDINAL_ONES = [
  'zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth',
  'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
  'seventeenth', 'eighteenth', 'nineteenth',
];

const ORDINAL_TENS = [
  '', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth',
  'eightieth', 'ninetieth',
];

const SCALE_ORDINALS: Record<string, string> = {
  hundred: 'hundredth',
  thousand: 'thousandth',
  million: 'millionth',
  billion: 'billionth',
  trillion: 'trillionth',
};

function cardinalUnder1000(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10;
    return rest ? `${TENS[Math.floor(n / 10)]} ${ONES[rest]}` : TENS[Math.floor(n / 10)];
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return rest
    ? `${ONES[hundreds]} hundred ${cardinalUnder1000(rest)}`
    : `${ONES[hundreds]} hundred`;
}

function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${numberToWords(-n)}`;
  if (n === 0) return 'zero';
  if (n < 1000) return cardinalUnder1000(n);

  const scales = [
    { value: 1_000_000_000_000, name: 'trillion' },
    { value: 1_000_000_000, name: 'billion' },
    { value: 1_000_000, name: 'million' },
    { value: 1_000, name: 'thousand' },
  ] as const;

  for (const scale of scales) {
    if (n >= scale.value) {
      const quotient = Math.floor(n / scale.value);
      const rest = n % scale.value;
      const head = `${numberToWords(quotient)} ${scale.name}`;
      return rest ? `${head} ${numberToWords(rest)}` : head;
    }
  }

  return String(n);
}

function digitToWord(digit: string): string {
  return ONES[Number(digit)] ?? digit;
}

function hasLeadingZeros(token: string): boolean {
  const intPart = token.split('.')[0];
  return intPart.length > 1 && intPart.startsWith('0');
}

function shouldSpeakDigitByDigit(token: string): boolean {
  const intPart = token.split('.')[0];
  return hasLeadingZeros(intPart) || intPart.length > 15;
}

function digitByDigit(token: string): string {
  if (token.includes('.')) {
    const [intPart, fracPart] = token.split('.');
    const intWords = intPart.split('').map(digitToWord).join(' ');
    const fracWords = fracPart.split('').map(digitToWord).join(' ');
    return `${intWords} point ${fracWords}`;
  }
  return token.split('').map(digitToWord).join(' ');
}

function isVersionLikeToken(token: string): boolean {
  return (token.match(/\./g) || []).length >= 2;
}

function isYearToken(token: string): boolean {
  if (token.includes('.')) return false;
  if (token.length !== 4) return false;
  if (hasLeadingZeros(token)) return false;
  const n = Number(token);
  return n >= 1000 && n <= 2099;
}

function yearToWords(year: number): string {
  const high = Math.floor(year / 100);
  const low = year % 100;

  if (high === 20 && low <= 9) {
    if (low === 0) return 'two thousand';
    return `two thousand ${ONES[low]}`;
  }

  if (low === 0) return `${cardinalUnder1000(high)} hundred`;
  if (low < 10) return `${cardinalUnder1000(high)} oh ${ONES[low]}`;
  return `${cardinalUnder1000(high)} ${cardinalUnder1000(low)}`;
}

/** Digits with optional thousands commas and optional decimal: 1,700 or 12,345.67 */
const GROUPED_NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

function numericTokenToWords(token: string): string {
  if (isVersionLikeToken(token)) return token;

  // Comma-grouped quantities are never years — strip commas only for parsing.
  if (token.includes(',')) {
    const cleaned = token.replace(/,/g, '');
    if (shouldSpeakDigitByDigit(cleaned)) return digitByDigit(cleaned);
    if (cleaned.includes('.')) {
      const [intPart, fracPart] = cleaned.split('.');
      const intWords = intPart ? numberToWords(Number(intPart)) : 'zero';
      const fracWords = fracPart.split('').map(digitToWord).join(' ');
      return `${intWords} point ${fracWords}`;
    }
    return numberToWords(Number(cleaned));
  }

  if (shouldSpeakDigitByDigit(token)) return digitByDigit(token);
  if (token.includes('.')) {
    const [intPart, fracPart] = token.split('.');
    const intWords = intPart ? numberToWords(Number(intPart)) : 'zero';
    const fracWords = fracPart.split('').map(digitToWord).join(' ');
    return `${intWords} point ${fracWords}`;
  }
  if (isYearToken(token)) return yearToWords(Number(token));
  return numberToWords(Number(token));
}

function lastWordToOrdinal(word: string): string {
  const onesIdx = ONES.indexOf(word);
  if (onesIdx >= 0) return ORDINAL_ONES[onesIdx];

  const tensIdx = TENS.indexOf(word);
  if (tensIdx >= 0) return ORDINAL_TENS[tensIdx];

  if (word in SCALE_ORDINALS) return SCALE_ORDINALS[word];
  if (word.endsWith('y')) return `${word.slice(0, -1)}ieth`;
  return `${word}th`;
}

function ordinalToWords(n: number): string {
  if (n < 20) return ORDINAL_ONES[n];
  if (n < 100) {
    const ones = n % 10;
    if (ones === 0) return ORDINAL_TENS[Math.floor(n / 10)];
    return `${TENS[Math.floor(n / 10)]} ${ORDINAL_ONES[ones]}`;
  }

  const words = numberToWords(n).split(' ');
  words[words.length - 1] = lastWordToOrdinal(words[words.length - 1]);
  return words.join(' ');
}

function expandCurrency(text: string): string {
  const amount = GROUPED_NUMBER;
  const withAttributiveAmounts = text.replace(
    new RegExp(
      String.raw`\b(a|an)\s+\$(${amount})(?:\s+(thousand|million|billion|trillion))?\s+([A-Za-z][A-Za-z-]*)`,
      'g'
    ),
    (_match, article: string, value: string, scale: string | undefined, noun: string) =>
      `${article} ${value}${scale ? ` ${scale}` : ''} dollar ${noun}`
  );

  return withAttributiveAmounts.replace(
    new RegExp(String.raw`\$(${amount})((?:\s(?:thousand|million|billion|trillion))?)`, 'gi'),
    (_match, value: string, scale: string) => {
      const unit = value.replace(/,/g, '') === '1' && !scale ? 'dollar' : 'dollars';
      return `${value}${scale} ${unit}`;
    }
  );
}

function expandPercent(text: string): string {
  return text.replace(new RegExp(String.raw`(${GROUPED_NUMBER})%`, 'g'), '$1 percent');
}

function expandRanges(text: string): string {
  return text.replace(
    /(?<!\d)(?<!\d-)(\d+(?:\.\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?)(?!\d)(?!\-\d)/g,
    (match, start: string, end: string) => {
      if (/^\d{3}$/.test(start) && /^\d{4}$/.test(end)) return match;
      return `${numericTokenToWords(start)} to ${numericTokenToWords(end)}`;
    }
  );
}

function expandFractions(text: string): string {
  return text.replace(
    /(?<![\d/])(\d+)\s*\/\s*(\d+)(?![\d/])(?!\s*\/\s*\d)/g,
    (_match, numerator: string, denominator: string) =>
      `${numberToWords(Number(numerator))} over ${numberToWords(Number(denominator))}`
  );
}

function expandOrdinals(text: string): string {
  return text.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_match, digits: string) => {
    if (isYearToken(digits)) {
      const words = yearToWords(Number(digits)).split(' ');
      words[words.length - 1] = lastWordToOrdinal(words[words.length - 1]);
      return words.join(' ');
    }
    return ordinalToWords(Number(digits));
  });
}

function expandNegativeNumbers(text: string): string {
  return text.replace(
    /(^|[\s([{"'])-(\d+(?:\.\d+)?)\b/g,
    (_match, prefix: string, digits: string) => `${prefix}minus ${numericTokenToWords(digits)}`
  );
}

function expandRemainingNumbers(text: string): string {
  return text.replace(
    new RegExp(String.raw`\d+(?:\.\d+){2,}|\b(?:${GROUPED_NUMBER})\b`, 'g'),
    (match) => {
      if (isVersionLikeToken(match)) return match;
      return numericTokenToWords(match);
    }
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLowercaseWordKey(key: string): boolean {
  return /^[a-z]+(?:['-][a-z]+)*$/.test(key);
}

/**
 * Lowercase keys also match sentence case (`cosine` + `Cosine`).
 * ALL CAPS keys stay exact so `US` never rewrites `us`.
 */
function overridePattern(key: string): RegExp {
  if (isLowercaseWordKey(key)) {
    const titled = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    return new RegExp(`\\b(?:${escapeRegExp(key)}|${escapeRegExp(titled)})\\b`, 'g');
  }
  if (/^\w+$/.test(key)) {
    return new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g');
  }
  return new RegExp(escapeRegExp(key), 'g');
}

/** Replace listed tokens with their spoken form. Longer keys win. */
function applyPronunciationOverrides(text: string): string {
  const keys = Object.keys(TTS_PRONUNCIATION_OVERRIDES).sort((left, right) => right.length - left.length);
  let result = text;
  for (const key of keys) {
    const spoken = TTS_PRONUNCIATION_OVERRIDES[key];
    if (!key || spoken == null) continue;
    result = result.replace(overridePattern(key), spoken);
  }
  return result;
}

function spaceAcronyms(text: string): string {
  return text.replace(/\b[A-Z]{2,6}\b/g, (match) => {
    if (Object.hasOwn(TTS_PRONUNCIATION_OVERRIDES, match)) return match;
    return match.split('').join(' ');
  });
}

function collapseSpaces(text: string): string {
  return text.replace(/ {2,}/g, ' ');
}

export function normalizeTtsText(text: string): string {
  let result = String(text ?? '');
  result = expandCurrency(result);
  result = expandPercent(result);
  result = expandRanges(result);
  result = expandFractions(result);
  result = expandOrdinals(result);
  result = expandNegativeNumbers(result);
  result = expandRemainingNumbers(result);
  result = applyPronunciationOverrides(result);
  result = spaceAcronyms(result);
  result = collapseSpaces(result);
  return result;
}
