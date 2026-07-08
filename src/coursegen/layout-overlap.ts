import type { Page } from 'playwright';

/** Minimum box area (px²) to consider for content-overlap checks. */
export const MIN_OVERLAP_BOX_AREA = 80;

/** Intersection / min(area) above this counts as a collision. */
export const DEFAULT_OVERLAP_RATIO = 0.35;

export type LayoutBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  text?: string;
  tag?: string;
  /** Stable id for parent/child exclusion when available. */
  index?: number;
  parentIndex?: number | null;
};

export function boxArea(box: Pick<LayoutBox, 'left' | 'top' | 'right' | 'bottom'>): number {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

export function overlapRatio(
  a: Pick<LayoutBox, 'left' | 'top' | 'right' | 'bottom'>,
  b: Pick<LayoutBox, 'left' | 'top' | 'right' | 'bottom'>
): number {
  const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
  const overlapArea = overlapWidth * overlapHeight;
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller > 0 ? overlapArea / smaller : 0;
}

function boxLabel(box: LayoutBox): string {
  const text = (box.text || '').replace(/\s+/g, ' ').trim();
  if (text) return `"${text.slice(0, 40)}"`;
  return `<${(box.tag || 'el').toLowerCase()}>`;
}

export function findOverlappingPairs(
  boxes: LayoutBox[],
  options: {
    minRatio?: number;
    ignoreSameText?: boolean;
    maxFindings?: number;
    messageSuffix?: string;
  } = {}
): string[] {
  const minRatio = options.minRatio ?? DEFAULT_OVERLAP_RATIO;
  const ignoreSameText = options.ignoreSameText !== false;
  const maxFindings = options.maxFindings ?? 4;
  const suffix = options.messageSuffix
    ?? ' — separate competing layers or hide previous content; do not shrink fonts to hide collisions';
  const findings: string[] = [];

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (
        (a.parentIndex != null && a.parentIndex === b.index) ||
        (b.parentIndex != null && b.parentIndex === a.index)
      ) {
        continue;
      }
      if (ignoreSameText && a.text && b.text && a.text === b.text) continue;
      const ratio = overlapRatio(a, b);
      if (ratio < minRatio) continue;
      findings.push(`overlapping content: ${boxLabel(a)} collides with ${boxLabel(b)}${suffix}`);
      if (findings.length >= maxFindings) return findings;
    }
  }
  return findings;
}

/**
 * Collect visible content-bearing boxes under an optional root.
 * Runs in the page; returns serializable LayoutBox[].
 */
export async function collectVisibleContentBoxes(
  page: Page,
  rootSelector?: string
): Promise<LayoutBox[]> {
  return page.evaluate(({ rootSelector: root, minArea }) => {
    const skip = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'HEAD', 'HTML', 'BODY']);
    const media = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT']);
    const rootEl = root
      ? document.querySelector(root)
      : document.body;
    if (!rootEl) return [] as Array<{
      left: number;
      top: number;
      right: number;
      bottom: number;
      text?: string;
      tag?: string;
      index?: number;
      parentIndex?: number | null;
    }>;

    const elements = Array.from(rootEl.querySelectorAll('*'));
    const indexByEl = new Map<Element, number>();
    const boxes: Array<{
      left: number;
      top: number;
      right: number;
      bottom: number;
      text?: string;
      tag?: string;
      index?: number;
      parentIndex?: number | null;
    }> = [];

    elements.forEach(el => {
      if (skip.has(el.tagName)) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      if (rect.width * rect.height < minArea) return;

      let hasDirectText = false;
      let direct = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const part = (child.textContent || '').trim();
          if (part) {
            hasDirectText = true;
            direct += `${part} `;
          }
        }
      }
      const isMedia = media.has(el.tagName);
      const isContent = isMedia || hasDirectText;
      if (!isContent) return;

      const index = boxes.length;
      indexByEl.set(el, index);
      let parentIndex: number | null = null;
      let parent = el.parentElement;
      while (parent && parent !== rootEl) {
        if (indexByEl.has(parent)) {
          parentIndex = indexByEl.get(parent) ?? null;
          break;
        }
        parent = parent.parentElement;
      }

      boxes.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        text: direct.trim().replace(/\s+/g, ' ').slice(0, 80) || undefined,
        tag: el.tagName,
        index,
        parentIndex
      });
    });

    return boxes;
  }, { rootSelector: rootSelector ?? null, minArea: MIN_OVERLAP_BOX_AREA });
}

export async function collectOverlapFindings(
  page: Page,
  options: {
    rootSelector?: string;
    minRatio?: number;
    maxFindings?: number;
    messageSuffix?: string;
  } = {}
): Promise<string[]> {
  const boxes = await collectVisibleContentBoxes(page, options.rootSelector);
  return findOverlappingPairs(boxes, {
    minRatio: options.minRatio,
    maxFindings: options.maxFindings,
    messageSuffix: options.messageSuffix
  });
}
