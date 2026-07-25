const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MIN_VISIBLE_TEXT_PX = 14;
const MIN_BODY_TEXT_PX = 16;
const VIEWPORT = { width: 1280, height: 720 };
const MAX_FINDINGS_PER_CATEGORY = 3;

async function dismissStartOverlay(page) {
  const startButton = page.getByRole('button', {
    name: /^(start|begin|continue|got it|close|dismiss|let'?s go|play|try|start .*)/i
  }).first();
  try {
    await startButton.click({ timeout: 700 });
    await page.waitForTimeout(250);
  } catch {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    } catch {
      // ignore overlay dismissal failures
    }
  }
}

async function collectFindings(page, context) {
  const findings = await page.evaluate(({ minVisibleTextPx, minBodyTextPx, maxFindingsPerCategory }) => {
    const issues = [];
    const de = document.documentElement;
    const body = document.body;
    if (!body) return issues;

    const maxScrollWidth = Math.max(de.scrollWidth, body.scrollWidth);
    const maxScrollHeight = Math.max(de.scrollHeight, body.scrollHeight);
    if (maxScrollWidth > de.clientWidth + 2) {
      issues.push(`page overflows horizontally (content ${maxScrollWidth}px wide, viewport ${de.clientWidth}px)`);
    }
    if (maxScrollHeight > de.clientHeight + 2) {
      issues.push(`page overflows vertically (content ${maxScrollHeight}px tall, viewport ${de.clientHeight}px)`);
    }

    function describeElement(el) {
      if (el.id) return `#${el.id}`;
      const className = Array.from(el.classList).slice(0, 2).map(name => `.${name}`).join('');
      return `${el.tagName.toLowerCase()}${className}`;
    }

    const internalScroll = [];
    const ignoreScrollSelector = 'html, body, pre, code, textarea, select, option, .katex-mathml, .katex-mathml *';
    for (const el of Array.from(body.querySelectorAll('*'))) {
      if (el.matches(ignoreScrollSelector)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < 0 || rect.top > de.clientHeight || rect.right < 0 || rect.left > de.clientWidth) continue;

      const verticalOverflow = el.scrollHeight - el.clientHeight;
      const horizontalOverflow = el.scrollWidth - el.clientWidth;
      if (verticalOverflow > 4 && style.overflowY !== 'visible') {
        internalScroll.push(`${describeElement(el)} has internal vertical overflow (${el.scrollHeight}px content, ${el.clientHeight}px visible)`);
      }
      if (horizontalOverflow > 4 && style.overflowX !== 'visible') {
        internalScroll.push(`${describeElement(el)} has internal horizontal overflow (${el.scrollWidth}px content, ${el.clientWidth}px visible)`);
      }
    }
    for (const item of internalScroll.slice(0, maxFindingsPerCategory)) {
      issues.push(`internal scroll/clipping: ${item}`);
    }

    const tiny = [];
    const undersizedBody = [];
    const seen = new Set();
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
      if (fontSize < minVisibleTextPx) {
        tiny.push(`"${text.slice(0, 40)}" renders at ${fontSize.toFixed(1)}px`);
      } else if (fontSize < minBodyTextPx && bodyLike) {
        undersizedBody.push(`"${text.slice(0, 40)}" renders at ${fontSize.toFixed(1)}px`);
      }
    }
    for (const item of tiny.slice(0, maxFindingsPerCategory)) {
      issues.push(`text below ${minVisibleTextPx}px minimum: ${item}`);
    }
    for (const item of undersizedBody.slice(0, maxFindingsPerCategory)) {
      issues.push(`body/prompt text below ${minBodyTextPx}px target: ${item}`);
    }

    return issues;
  }, {
    minVisibleTextPx: MIN_VISIBLE_TEXT_PX,
    minBodyTextPx: MIN_BODY_TEXT_PX,
    maxFindingsPerCategory: MAX_FINDINGS_PER_CATEGORY
  });

  return findings.map(finding => `[${context}] ${finding}`);
}

async function main() {
  const htmlPath = process.argv[2];
  if (!htmlPath) {
    console.error('Usage: node validate_practice_page.cjs <path-to-index.html>');
    process.exit(2);
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    console.log(`Practice readability validation skipped: Playwright not available (${error.message || error})`);
    return;
  }

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const pageErrors = [];
  const findings = [];
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('pageerror', err => {
      pageErrors.push(err instanceof Error ? err.message : String(err));
    });
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(600);
    findings.push(...await collectFindings(page, 'initial screen'));
    await dismissStartOverlay(page);
    findings.push(...await collectFindings(page, 'active screen'));

    const tabSelectors = ['[data-activity-tab]', '.tab-button', 'button[role="tab"]', '#activity-header button', '.activity-tab'];
    let tabs = [];
    for (const selector of tabSelectors) {
      tabs = await page.$$(selector);
      if (tabs.length > 1) break;
    }
    for (let index = 0; index < Math.min(tabs.length, 4); index += 1) {
      try {
        await tabs[index].click();
        await page.waitForTimeout(250);
        findings.push(...await collectFindings(page, `tab ${index + 1}`));
      } catch {
        // ignore tab click failures
      }
    }
  } finally {
    await browser.close();
  }

  if (pageErrors.length > 0) {
    console.error(`Practice readability validation failed: Page JavaScript error: ${pageErrors[0]}`);
    process.exit(1);
  }

  const uniqueFindings = [...new Set(findings)];
  if (uniqueFindings.length > 0) {
    console.error([
      'Practice readability validation failed at 1280x720:',
      ...uniqueFindings.map(finding => `- ${finding}`),
      'Fix by reducing content, compacting chrome, resizing visuals, or splitting steps.'
    ].join('\n'));
    process.exit(1);
  }

  console.log(`Practice readability validation passed for ${htmlPath}: no page overflow, no internal clipping/scroll, visible text >= ${MIN_VISIBLE_TEXT_PX}px, body/prompt text >= ${MIN_BODY_TEXT_PX}px`);
}

main().catch(error => {
  console.error(`Practice readability validation failed: ${error.name || 'Error'}: ${error.message || error}`);
  process.exit(1);
});
