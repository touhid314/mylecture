import type { Page } from 'playwright';

// Computed typography requirements enforced by automated QA. Keep aligned with
// prompts/interactive-practice.md.
export const MIN_VISIBLE_TEXT_PX = 14;
export const MIN_BODY_TEXT_PX = 16;
export const MAX_FINDINGS_PER_CATEGORY = 3;

export type ReadabilityIssue = {
  message: string;
  shellChrome: boolean;
};

export async function collectReadabilityIssues(page: Page): Promise<ReadabilityIssue[]> {
  // Inline browser function — must not pass a module-level function reference (tsx __name helper breaks evaluate).
  return page.evaluate(({ minVisibleTextPx, minBodyTextPx, maxFindingsPerCategory }) => {
    const issues: Array<{ message: string; shellChrome: boolean }> = [];
    const de = document.documentElement;
    const body = document.body;
    if (!body) return issues;

    const isShellPage = Boolean(de.getAttribute('data-shell-version'));
    const stageInner = document.getElementById('shell-stage-inner');

    if (de.scrollWidth > de.clientWidth + 2 || body.scrollWidth > de.clientWidth + 2) {
      issues.push({
        message: `page overflows horizontally (content ${Math.max(de.scrollWidth, body.scrollWidth)}px wide, viewport ${de.clientWidth}px)`,
        shellChrome: isShellPage
      });
    }
    if (de.scrollHeight > de.clientHeight + 2 || body.scrollHeight > de.clientHeight + 2) {
      issues.push({
        message: `page overflows vertically (content ${Math.max(de.scrollHeight, body.scrollHeight)}px tall, viewport ${de.clientHeight}px)`,
        shellChrome: isShellPage
      });
    }

    const internalScroll: Array<{ message: string; shellChrome: boolean }> = [];
    const ignoreScrollSelector = 'html, body, pre, code, textarea, select, option, .katex-mathml, .katex-mathml *';
    const allElements = Array.from(body.querySelectorAll<HTMLElement>('*'));
    for (const el of allElements) {
      if (el.matches(ignoreScrollSelector)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < 0 || rect.top > de.clientHeight || rect.right < 0 || rect.left > de.clientWidth) continue;

      const verticalOverflow = el.scrollHeight - el.clientHeight;
      const horizontalOverflow = el.scrollWidth - el.clientWidth;
      const clipsOrScrollsY = style.overflowY !== 'visible';
      const clipsOrScrollsX = style.overflowX !== 'visible';
      if (verticalOverflow > 4 && clipsOrScrollsY) {
        let label = el.id ? `#${el.id}` : el.tagName.toLowerCase();
        if (!el.id) {
          const classes = Array.from(el.classList).slice(0, 2);
          for (let ci = 0; ci < classes.length; ci++) label += `.${classes[ci]}`;
        }
        internalScroll.push({
          message: `${label} has internal vertical overflow (${el.scrollHeight}px content, ${el.clientHeight}px visible)`,
          shellChrome: isShellPage && (!stageInner || !stageInner.contains(el))
        });
      }
      if (horizontalOverflow > 4 && clipsOrScrollsX) {
        let label = el.id ? `#${el.id}` : el.tagName.toLowerCase();
        if (!el.id) {
          const classes = Array.from(el.classList).slice(0, 2);
          for (let ci = 0; ci < classes.length; ci++) label += `.${classes[ci]}`;
        }
        internalScroll.push({
          message: `${label} has internal horizontal overflow (${el.scrollWidth}px content, ${el.clientWidth}px visible)`,
          shellChrome: isShellPage && (!stageInner || !stageInner.contains(el))
        });
      }
    }
    for (const item of internalScroll.slice(0, maxFindingsPerCategory)) {
      issues.push({ message: `internal scroll/clipping: ${item.message}`, shellChrome: item.shellChrome });
    }

    const tiny: Array<{ message: string; shellChrome: boolean }> = [];
    const undersizedBody: Array<{ message: string; shellChrome: boolean }> = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const controlSelector = 'button, input, select, textarea, [role="tab"], [data-activity-tab], .badge, .chip, .tag, .axis, .tick, .caption, .label, svg';
    const bodySelector = 'p, li, #activity-instructions, #activity-stage, #activity-controls, main, aside, section, article, .prompt, .instructions, .feedback, .question, .card';

    while (walker.nextNode()) {
      const text = (walker.currentNode.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3) continue;
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < 0 || rect.top > de.clientHeight || rect.right < 0 || rect.left > de.clientWidth) continue;
      const fontSize = Number.parseFloat(style.fontSize);
      if (!Number.isFinite(fontSize)) continue;
      const controlLike = Boolean(el.closest(controlSelector));
      const bodyLike = text.length >= 18 && !controlLike && Boolean(el.closest(bodySelector));
      const shellChrome = isShellPage && (!stageInner || !stageInner.contains(el));
      if (fontSize < minVisibleTextPx) {
        tiny.push({ message: `"${text.slice(0, 40)}" renders at ${fontSize.toFixed(1)}px`, shellChrome });
      } else if (fontSize < minBodyTextPx && bodyLike) {
        undersizedBody.push({ message: `"${text.slice(0, 40)}" renders at ${fontSize.toFixed(1)}px`, shellChrome });
      }
    }
    for (const item of tiny.slice(0, maxFindingsPerCategory)) {
      issues.push({ message: `text below ${minVisibleTextPx}px minimum: ${item.message}`, shellChrome: item.shellChrome });
    }
    for (const item of undersizedBody.slice(0, maxFindingsPerCategory)) {
      issues.push({ message: `body/prompt text below ${minBodyTextPx}px target: ${item.message}`, shellChrome: item.shellChrome });
    }
    return issues;
  }, {
    minVisibleTextPx: MIN_VISIBLE_TEXT_PX,
    minBodyTextPx: MIN_BODY_TEXT_PX,
    maxFindingsPerCategory: MAX_FINDINGS_PER_CATEGORY
  });
}

export function formatReadabilityIssue(issue: ReadabilityIssue, context: string): string {
  const prefix = issue.shellChrome ? '[shell-chrome] ' : '';
  return `[${context}] ${prefix}${issue.message}`;
}
