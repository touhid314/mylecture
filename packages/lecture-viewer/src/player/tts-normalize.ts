/**
 * Canonical TTS text normalizer (single source for Live TTS and build-plan).
 * Captions keep the original text; only spoken output is rewritten.
 */

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

function numericTokenToWords(token: string): string {
  if (isVersionLikeToken(token)) return token;
  if (shouldSpeakDigitByDigit(token)) return digitByDigit(token);
  if (token.includes('.')) {
    const [intPart, fracPart] = token.split('.');
    const intWords = intPart ? numberToWords(Number(intPart)) : 'zero';
    const fracWords = fracPart.split('').map(digitToWord).join(' ');
    return `${intWords} point ${fracWords}`;
  }
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

function stripDigitGroupCommas(text: string): string {
  let result = text;
  while (/\d,\d{3}(?!\d)/.test(result)) {
    result = result.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  }
  return result;
}

function expandCurrency(text: string): string {
  const withAttributiveAmounts = text.replace(
    /\b(a|an)\s+\$(\d+(?:\.\d+)?)(?:\s+(thousand|million|billion|trillion))?\s+([A-Za-z][A-Za-z-]*)/g,
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

function expandRanges(text: string): string {
  return text.replace(
    /(?<!\d)(?<!\d-)(\d+(?:\.\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?)(?!\d)(?!\-\d)/g,
    (_match, start: string, end: string) =>
      `${numericTokenToWords(start)} to ${numericTokenToWords(end)}`
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
  return text.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_match, digits: string) =>
    ordinalToWords(Number(digits))
  );
}

function expandNegativeNumbers(text: string): string {
  return text.replace(
    /(^|[\s([{"'])-(\d+(?:\.\d+)?)\b/g,
    (_match, prefix: string, digits: string) => `${prefix}minus ${numericTokenToWords(digits)}`
  );
}

function expandRemainingNumbers(text: string): string {
  return text.replace(/\d+(?:\.\d+){2,}|\b\d+(?:\.\d+)?\b/g, (match) => {
    if (isVersionLikeToken(match)) return match;
    return numericTokenToWords(match);
  });
}

function spaceAcronyms(text: string): string {
  return text.replace(/\b[A-Z]{2,6}\b/g, (match) => match.split('').join(' '));
}

function collapseSpaces(text: string): string {
  return text.replace(/ {2,}/g, ' ');
}

export function normalizeTtsText(text: string): string {
  let result = String(text ?? '');
  result = stripDigitGroupCommas(result);
  result = expandCurrency(result);
  result = expandPercent(result);
  result = expandRanges(result);
  result = expandFractions(result);
  result = expandOrdinals(result);
  result = expandNegativeNumbers(result);
  result = expandRemainingNumbers(result);
  result = spaceAcronyms(result);
  result = collapseSpaces(result);
  return result;
}
