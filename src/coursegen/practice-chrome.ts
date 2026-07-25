import { readFileSync, writeFileSync } from 'node:fs';

export const PRACTICE_CHROME_STYLE_ID = 'mylecture-practice-chrome';

/** MyLecture practice chrome floor — keeps controls readable when author CSS fails. */
const PRACTICE_CHROME_CSS = `/* MyLecture practice chrome floor — do not remove */
button, .btn, .tab-button, [role="tab"], input[type="button"], input[type="submit"] {
  font-size: 16px !important;
  font-family: inherit !important;
}
`;

const MAX_CSS_PARSE_FINDINGS = 3;

const STYLE_TAG_RE = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const STYLE_ID_RE = /\bid\s*=\s*(["'])([^"']*)\1/i;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Brace-balance scan for `{` / `}`. Ignores braces inside single/double-quoted
 * strings and CSS string escapes. Simple scan — good enough to catch unclosed blocks.
 */
function countUnbalancedBraces(css: string): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\' && i + 1 < css.length) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  return depth;
}

function extractStyleId(attrs: string): string | null {
  const match = attrs.match(STYLE_ID_RE);
  return match ? match[2] : null;
}

/**
 * Scan inline `<style>` blocks (except the practice chrome id) for unbalanced braces.
 * Returns human-readable findings capped at ~3.
 */
export function collectInlineCssParseFindings(html: string): string[] {
  const findings: string[] = [];
  let styleIndex = 0;
  STYLE_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STYLE_TAG_RE.exec(html)) !== null) {
    styleIndex += 1;
    const attrs = match[1] || '';
    const css = match[2] || '';
    const id = extractStyleId(attrs);
    if (id === PRACTICE_CHROME_STYLE_ID) continue;

    const stripped = stripCssComments(css);
    const imbalance = countUnbalancedBraces(stripped);
    if (imbalance === 0) continue;

    if (imbalance > 0) {
      findings.push(
        `inline <style> #${styleIndex}: unclosed CSS block (${imbalance} more '{' than '}'); later rules may be dropped — fix missing '}'`
      );
    } else {
      findings.push(
        `inline <style> #${styleIndex}: extra closing brace (${-imbalance} more '}' than '{'); CSS may be invalid — fix brace mismatch`
      );
    }
    if (findings.length >= MAX_CSS_PARSE_FINDINGS) break;
  }
  return findings;
}

function buildChromeStyleTag(): string {
  return `<style id="${PRACTICE_CHROME_STYLE_ID}">\n${PRACTICE_CHROME_CSS}</style>`;
}

function replaceExistingChromeStyle(html: string): { html: string; changed: boolean } | null {
  const re = new RegExp(
    `<style\\b([^>]*\\bid\\s*=\\s*["']${PRACTICE_CHROME_STYLE_ID}["'][^>]*)>([\\s\\S]*?)<\\/style>`,
    'i'
  );
  const match = html.match(re);
  if (!match) return null;
  const next = buildChromeStyleTag();
  const previous = match[0];
  if (previous === next) {
    return { html, changed: false };
  }
  return { html: html.replace(re, next), changed: true };
}

/**
 * Ensure the practice chrome floor `<style id="mylecture-practice-chrome">` is present.
 * Replaces contents if already present. Returns true if the file was modified.
 */
export function ensurePracticeChromeStyles(htmlPath: string): boolean {
  const original = readFileSync(htmlPath, 'utf8');
  const replaced = replaceExistingChromeStyle(original);
  let next: string;
  let changed: boolean;

  if (replaced) {
    next = replaced.html;
    changed = replaced.changed;
  } else {
    const tag = buildChromeStyleTag();
    const closeHead = original.match(/<\/head\s*>/i);
    if (closeHead && closeHead.index !== undefined) {
      next = `${original.slice(0, closeHead.index)}${tag}\n${original.slice(closeHead.index)}`;
      changed = true;
    } else {
      const openHead = original.match(/<head\b[^>]*>/i);
      if (openHead && openHead.index !== undefined) {
        const insertAt = openHead.index + openHead[0].length;
        next = `${original.slice(0, insertAt)}\n${tag}${original.slice(insertAt)}`;
        changed = true;
      } else {
        const firstStyle = original.match(/<style\b/i);
        if (firstStyle && firstStyle.index !== undefined) {
          next = `${original.slice(0, firstStyle.index)}${tag}\n${original.slice(firstStyle.index)}`;
          changed = true;
        } else {
          const closeBody = original.match(/<\/body\s*>/i);
          if (closeBody && closeBody.index !== undefined) {
            next = `${original.slice(0, closeBody.index)}${tag}\n${original.slice(closeBody.index)}`;
            changed = true;
          } else {
            next = `${original}\n${tag}\n`;
            changed = true;
          }
        }
      }
    }
  }

  if (!changed) return false;
  writeFileSync(htmlPath, next, 'utf8');
  return true;
}
