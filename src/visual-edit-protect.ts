/**
 * Helpers for scoped visual edits: extract and restore protected narration blocks.
 */

function scanDelimitedBlock(
  html: string,
  startRe: RegExp,
  openChar: string,
  closeChar: string
): string | null {
  const startMatch = startRe.exec(html);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  const openIdx = startIdx + startMatch[0].length - 1;
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = openIdx; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === openChar) {
      depth++;
      continue;
    }
    if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        let j = i + 1;
        while (j < html.length && /\s/.test(html[j])) j++;
        if (html[j] === ';') return html.slice(startIdx, j + 1);
        return html.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

/** Brace-depth match for window.__VIDEO_METADATA__ = { ... }; */
export function matchVideoMetadataBlock(html: string): string | null {
  return scanDelimitedBlock(html, /window\.__VIDEO_METADATA__\s*=\s*\{/, '{', '}');
}

/** Bracket-depth match for window.__VIDEO_PLAN__ = [ ... ]; (inline array assignment). */
export function matchVideoPlanInlineBlock(html: string): string | null {
  return scanDelimitedBlock(html, /window\.__VIDEO_PLAN__\s*=\s*\[/, '[', ']');
}

/** Bracket-depth match for const/let/var VIDEO_PLAN = [ ... ]; */
export function matchVideoPlanConstBlock(html: string): string | null {
  return scanDelimitedBlock(html, /(?:const|let|var)\s+VIDEO_PLAN\s*=\s*\[/, '[', ']');
}

/** window.__VIDEO_PLAN__ assignment — inline array or VIDEO_PLAN reference. */
export function matchVideoPlanWindowAssignment(html: string): string | null {
  const inline = matchVideoPlanInlineBlock(html);
  if (inline) return inline;
  const refMatch = /window\.__VIDEO_PLAN__\s*=\s*VIDEO_PLAN\s*;/.exec(html);
  return refMatch ? refMatch[0] : null;
}

/** @deprecated Use matchVideoPlanInlineBlock or matchVideoPlanWindowAssignment */
export function matchVideoPlanBlock(html: string): string | null {
  return matchVideoPlanInlineBlock(html);
}

type ProtectedSegment = {
  name: string;
  matcher: (html: string) => string | null;
  original: string;
  insertBefore?: RegExp;
};

function collectProtectedSegments(original: string): ProtectedSegment[] {
  const metadata = matchVideoMetadataBlock(original);
  if (!metadata) {
    throw new Error('The source scene is missing required video metadata or narration plan.');
  }

  const segments: ProtectedSegment[] = [
    {
      name: 'metadata',
      matcher: matchVideoMetadataBlock,
      original: metadata,
      insertBefore: /(?:const|let|var)\s+VIDEO_PLAN\s*=/,
    },
  ];

  const planConst = matchVideoPlanConstBlock(original);
  if (planConst) {
    segments.push({
      name: 'planConst',
      matcher: matchVideoPlanConstBlock,
      original: planConst,
      insertBefore: /window\.__VIDEO_PLAN__\s*=/,
    });
  }

  const planAssign = matchVideoPlanWindowAssignment(original);
  if (!planAssign) {
    throw new Error('The source scene is missing required video metadata or narration plan.');
  }

  segments.push({
    name: 'planAssign',
    matcher: matchVideoPlanWindowAssignment,
    original: planAssign,
    insertBefore: /window\.__RENDER_SECTION__\s*=/,
  });

  return segments;
}

export function protectedVisualEditContent(html: string): { metadata: string; plan: string } {
  const metadata = matchVideoMetadataBlock(html);
  const planAssign = matchVideoPlanWindowAssignment(html);
  const planConst = matchVideoPlanConstBlock(html);
  const planParts = [planConst, planAssign].filter(Boolean);
  return {
    metadata: metadata || '',
    plan: planParts.join('\n'),
  };
}

function findProtectedBlockInsertionIndex(html: string): number {
  const renderSectionRe = /window\.__RENDER_SECTION__\s*=/;
  const renderMatch = renderSectionRe.exec(html);
  if (renderMatch) return renderMatch.index;

  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose >= 0) return bodyClose;

  return html.length;
}

function replaceOrInsertSegment(html: string, segment: ProtectedSegment): string {
  const found = segment.matcher(html);
  if (found) {
    const idx = html.indexOf(found);
    if (idx < 0) {
      throw new Error('Protected block span could not be located in the modified scene HTML.');
    }
    return html.slice(0, idx) + segment.original + html.slice(idx + found.length);
  }

  let insertAt = findProtectedBlockInsertionIndex(html);
  if (segment.insertBefore) {
    const beforeMatch = segment.insertBefore.exec(html);
    if (beforeMatch) insertAt = beforeMatch.index;
  }

  const prefix = insertAt > 0 && html[insertAt - 1] !== '\n' ? '\n' : '';
  return html.slice(0, insertAt) + prefix + segment.original + '\n' + html.slice(insertAt);
}

/**
 * Restore original metadata and plan bytes into a model-edited scene.
 */
export function restoreProtectedVisualBlocks(original: string, modified: string): string {
  const segments = collectProtectedSegments(original);
  let restored = modified;
  for (const segment of segments) {
    restored = replaceOrInsertSegment(restored, segment);
  }

  for (const segment of segments) {
    const after = segment.matcher(restored);
    if (!after) {
      throw new Error(
        'The visual edit produced corrupt HTML; required video metadata or narration plan could not be restored.'
      );
    }
  }
  return restored;
}

export function assertVisualEditPreservesNarration(original: string, modified: string): void {
  const segments = collectProtectedSegments(original);
  for (const segment of segments) {
    const after = segment.matcher(modified);
    if (!after) {
      throw new Error('The visual edit removed required video metadata or narration plan.');
    }
    if (after !== segment.original) {
      throw new Error(
        'The visual edit attempted to change narration, audio, or video metadata, so it was not applied.'
      );
    }
  }
}
