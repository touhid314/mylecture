/**
 * scene_layout_keys.cjs
 *
 * Static check: every SCENE_LAYOUT… property path used in lecture HTML must
 * exist on the SCENE_LAYOUT object literal. Skips lectures with no SCENE_LAYOUT.
 *
 * When multiple `const|let|var SCENE_LAYOUT = { … }` assignments exist in real
 * code (not strings/comments), the last complete (brace-balanced) literal wins.
 * Keys are extracted structurally only — no eval.
 */

'use strict';

const MAX_FINDINGS = 8;
const PARSE_FAIL =
  'SCENE_LAYOUT key check failed: could not parse SCENE_LAYOUT object literal';

/**
 * Find the end index (exclusive) of a `{…}` object literal starting at `openIdx`.
 * Respects strings, template literals, and nested braces.
 * @returns {number} end index after closing `}`, or -1 if unbalanced
 */
function findMatchingBrace(source, openIdx) {
  let i = openIdx + 1;
  let depth = 1;
  let quote = null;
  let escaped = false;
  let templateExprDepth = 0;

  while (i < source.length) {
    const ch = source[i];

    if (quote === '`') {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === '`' && templateExprDepth === 0) {
        quote = null;
        i += 1;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        templateExprDepth += 1;
        i += 2;
        continue;
      }
      if (ch === '}' && templateExprDepth > 0) {
        templateExprDepth -= 1;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      i += 1;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return -1;
}

function isIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || ch === '$';
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function readIdent(source, i) {
  if (i >= source.length || !isIdentStart(source[i])) return null;
  let j = i + 1;
  while (j < source.length && isIdentPart(source[j])) j += 1;
  return source.slice(i, j);
}

/**
 * If `i` starts a `const|let|var SCENE_LAYOUT = {` in code, return the `{` index.
 * Requires a non-identifier char (or start) before the keyword.
 */
function matchSceneLayoutAssignOpen(source, i) {
  if (i > 0 && isIdentPart(source[i - 1])) return null;

  let keyword = null;
  if (source.startsWith('const', i) && !isIdentPart(source[i + 5] || '')) {
    keyword = 'const';
  } else if (source.startsWith('let', i) && !isIdentPart(source[i + 3] || '')) {
    keyword = 'let';
  } else if (source.startsWith('var', i) && !isIdentPart(source[i + 3] || '')) {
    keyword = 'var';
  }
  if (!keyword) return null;

  let j = skipWsAndComments(source, i + keyword.length);
  if (!source.startsWith('SCENE_LAYOUT', j)) return null;
  j += 'SCENE_LAYOUT'.length;
  if (j < source.length && isIdentPart(source[j])) return null;

  j = skipWsAndComments(source, j);
  if (source[j] !== '=') return null;
  j = skipWsAndComments(source, j + 1);
  if (source[j] !== '{') return null;
  return j;
}

/**
 * Extract the last complete SCENE_LAYOUT object literal from real code
 * (assignments inside strings/comments are ignored).
 * @returns {{ literal: string, start: number, end: number } | null}
 */
function extractSceneLayoutLiteral(source) {
  let last = null;
  let i = 0;
  let quote = null;
  let escaped = false;
  let templateExprDepth = 0;

  while (i < source.length) {
    const ch = source[i];

    if (quote === '`') {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === '`' && templateExprDepth === 0) {
        quote = null;
        i += 1;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        templateExprDepth += 1;
        i += 2;
        continue;
      }
      if (ch === '}' && templateExprDepth > 0) {
        templateExprDepth -= 1;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    const openIdx = matchSceneLayoutAssignOpen(source, i);
    if (openIdx !== null) {
      const end = findMatchingBrace(source, openIdx);
      if (end >= 0) {
        last = {
          literal: source.slice(openIdx, end),
          start: openIdx,
          end,
        };
        i = end;
        continue;
      }
    }

    i += 1;
  }

  return last;
}

function skipWsAndComments(source, i) {
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Skip a JS value until the next `,` or `}` at depth 0 (of this value walk).
 */
function skipValue(source, i, end) {
  const limit = end == null ? source.length : end;
  i = skipWsAndComments(source, i);
  let depthBrace = 0;
  let depthBracket = 0;
  let depthParen = 0;
  let quote = null;
  let escaped = false;
  let started = false;

  while (i < limit) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      started = true;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      started = true;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < limit && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < limit - 1 && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (ch === '{') {
      depthBrace += 1;
      started = true;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (depthBrace === 0 && depthBracket === 0 && depthParen === 0) {
        return i;
      }
      depthBrace -= 1;
      i += 1;
      continue;
    }
    if (ch === '[') {
      depthBracket += 1;
      started = true;
      i += 1;
      continue;
    }
    if (ch === ']') {
      depthBracket -= 1;
      i += 1;
      continue;
    }
    if (ch === '(') {
      depthParen += 1;
      started = true;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depthParen -= 1;
      i += 1;
      continue;
    }

    if (
      started &&
      depthBrace === 0 &&
      depthBracket === 0 &&
      depthParen === 0 &&
      (ch === ',' || ch === '}')
    ) {
      return i;
    }

    if (!started && (ch === ',' || ch === '}')) {
      return i;
    }

    started = true;
    i += 1;
  }
  return i;
}

/**
 * Structurally extract nested keys from an object literal span.
 * Leaves are stored as `true`; nested objects as plain key trees.
 * @returns {Record<string, any> | null}
 */
function extractKeysFromLiteral(source, start, end) {
  if (typeof start !== 'number') {
    // Back-compat: full literal string
    if (!source || source[0] !== '{') return null;
    start = 0;
    end = source.length;
  }
  if (start >= end || source[start] !== '{') return null;

  const root = {};
  let i = start + 1;
  const limit = end;

  while (i < limit) {
    i = skipWsAndComments(source, i);
    if (i >= limit) break;
    if (source[i] === '}') break;
    if (source[i] === ',') {
      i += 1;
      continue;
    }

    let key = null;
    if (source[i] === '"' || source[i] === "'") {
      const q = source[i];
      i += 1;
      let raw = '';
      while (i < limit && source[i] !== q) {
        if (source[i] === '\\') {
          raw += source[i + 1] || '';
          i += 2;
          continue;
        }
        raw += source[i];
        i += 1;
      }
      if (source[i] === q) i += 1;
      key = raw;
    } else {
      const ident = readIdent(source, i);
      if (!ident) return null;
      key = ident;
      i += ident.length;
    }

    i = skipWsAndComments(source, i);
    if (source[i] !== ':') return null;
    i += 1;
    i = skipWsAndComments(source, i);

    if (source[i] === '{') {
      const nestedEnd = findMatchingBrace(source, i);
      if (nestedEnd < 0 || nestedEnd > limit) return null;
      const nested = extractKeysFromLiteral(source, i, nestedEnd);
      if (!nested) return null;
      root[key] = nested;
      i = nestedEnd;
    } else {
      root[key] = true;
      i = skipValue(source, i, limit);
    }
  }

  return root;
}

/**
 * Parse one SCENE_LAYOUT path starting after the name. Supports `.ident`, `?.ident`,
 * and `["ident"]` / `['ident']`. Returns { segments, nextIndex, computed }.
 */
function parseSceneLayoutPath(source, afterName) {
  let j = afterName;
  const segments = [];
  let computed = false;

  while (true) {
    j = skipWsAndComments(source, j);
    if (j >= source.length) break;

    // Optional chaining ?. or plain .
    if (source[j] === '?' && source[j + 1] === '.') {
      j += 2;
      j = skipWsAndComments(source, j);
      const ident = readIdent(source, j);
      if (!ident) break;
      segments.push(ident);
      j += ident.length;
      continue;
    }

    if (source[j] === '.') {
      j += 1;
      j = skipWsAndComments(source, j);
      const ident = readIdent(source, j);
      if (!ident) break;
      segments.push(ident);
      j += ident.length;
      continue;
    }

    if (source[j] === '[') {
      j += 1;
      j = skipWsAndComments(source, j);
      if (source[j] === '"' || source[j] === "'") {
        const q = source[j];
        j += 1;
        let raw = '';
        while (j < source.length && source[j] !== q) {
          if (source[j] === '\\') {
            raw += source[j + 1] || '';
            j += 2;
            continue;
          }
          raw += source[j];
          j += 1;
        }
        if (source[j] === q) j += 1;
        j = skipWsAndComments(source, j);
        if (source[j] === ']') {
          j += 1;
          segments.push(raw);
          continue;
        }
      }
      computed = true;
      break;
    }

    break;
  }

  return { segments, nextIndex: j, computed };
}

/**
 * Collect SCENE_LAYOUT property paths from source, skipping strings/comments and
 * an optional [skipStart, skipEnd) span (the definition literal).
 * @returns {string[][]}
 */
function collectSceneLayoutReferences(source, skipStart, skipEnd) {
  const paths = [];
  const hasSkip = typeof skipStart === 'number' && typeof skipEnd === 'number' && skipEnd > skipStart;
  let i = 0;
  let quote = null;
  let escaped = false;
  let templateExprDepth = 0;

  while (i < source.length) {
    if (hasSkip && i >= skipStart && i < skipEnd) {
      i = skipEnd;
      continue;
    }

    const ch = source[i];

    if (quote === '`') {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === '`' && templateExprDepth === 0) {
        quote = null;
        i += 1;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        templateExprDepth += 1;
        i += 2;
        continue;
      }
      if (ch === '}' && templateExprDepth > 0) {
        templateExprDepth -= 1;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (
      source.startsWith('SCENE_LAYOUT', i) &&
      (i === 0 || !isIdentPart(source[i - 1])) &&
      !isIdentPart(source[i + 'SCENE_LAYOUT'.length] || '')
    ) {
      const afterName = i + 'SCENE_LAYOUT'.length;
      const { segments, nextIndex, computed } = parseSceneLayoutPath(source, afterName);
      if (!computed && segments.length > 0) {
        paths.push(segments);
      }
      i = Math.max(nextIndex, afterName);
      continue;
    }

    i += 1;
  }

  return paths;
}

/**
 * Walk the key tree; return the failed path string (SCENE_LAYOUT.a.b) or null if ok.
 */
function findMissingPath(keyTree, segments) {
  let node = keyTree;
  const walked = [];
  for (const seg of segments) {
    walked.push(seg);
    if (node === true || node === null || typeof node !== 'object') {
      return `SCENE_LAYOUT.${walked.join('.')}`;
    }
    if (!Object.prototype.hasOwnProperty.call(node, seg)) {
      return `SCENE_LAYOUT.${walked.join('.')}`;
    }
    node = node[seg];
  }
  return null;
}

/**
 * Prefer inline <script> bodies so HTML text/attributes cannot supply a fake
 * assignment or reference. Falls back to full source when there are no scripts
 * (plain JS snippets / tests).
 */
function sourceForSceneLayoutCheck(htmlOrJs) {
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const bodies = [];
  let match;
  while ((match = scriptRe.exec(htmlOrJs)) !== null) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const code = match[2];
    if (code && code.trim()) bodies.push(code);
  }
  if (bodies.length === 0) return htmlOrJs;
  return bodies.join('\n');
}

/**
 * Check HTML/source text for SCENE_LAYOUT key reference errors.
 * @returns {string[]} error messages (empty if skip or all ok)
 */
function checkSceneLayoutKeys(htmlOrJs) {
  if (!htmlOrJs || !htmlOrJs.includes('SCENE_LAYOUT')) return [];

  const source = sourceForSceneLayoutCheck(htmlOrJs);
  if (!source.includes('SCENE_LAYOUT')) return [];

  const extracted = extractSceneLayoutLiteral(source);
  if (!extracted) return [];

  const keyTree = extractKeysFromLiteral(source, extracted.start, extracted.end);
  if (!keyTree) {
    return [PARSE_FAIL];
  }

  const refs = collectSceneLayoutReferences(source, extracted.start, extracted.end);

  const seen = new Set();
  const errors = [];

  for (const segments of refs) {
    const missing = findMissingPath(keyTree, segments);
    if (!missing) continue;
    if (seen.has(missing)) continue;
    seen.add(missing);
    errors.push(
      `SCENE_LAYOUT key check failed: ${missing} is referenced but not defined`
    );
    if (errors.length >= MAX_FINDINGS) break;
  }

  return errors;
}

module.exports = {
  checkSceneLayoutKeys,
  extractSceneLayoutLiteral,
  extractKeysFromLiteral,
  collectSceneLayoutReferences,
  findMissingPath,
  MAX_FINDINGS,
  PARSE_FAIL,
};
