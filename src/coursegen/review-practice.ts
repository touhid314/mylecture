import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { LLM_Model } from '../../../mylecture-agent/src/utils/llm_model.ts';
import { tryResolveReviewModel } from './models.ts';
import { collectInlineCssParseFindings } from './practice-chrome.ts';
import type { GameSpec, InteractiveSpec } from './types.ts';

const PROMPTS_DIR = path.join(import.meta.dirname, 'prompts');

export type RubricResult = {
  passed: boolean;
  findings: string[];
};

export type ScreenshotCaptureResult = {
  screenshotPaths: string[];
  pageErrors: string[];
  readabilityFindings: string[];
};

// Computed typography requirements enforced by automated QA.
const MIN_VISIBLE_TEXT_PX = 14;
const MIN_BODY_TEXT_PX = 16;
const MAX_FINDINGS_PER_CATEGORY = 3;

async function collectReadabilityFindings(page: Page, context: string): Promise<string[]> {
  const findings = await page.evaluate(({ minVisibleTextPx, minBodyTextPx, maxFindingsPerCategory }: { minVisibleTextPx: number; minBodyTextPx: number; maxFindingsPerCategory: number }) => {
    const issues: string[] = [];
    const de = document.documentElement;
    const body = document.body;
    if (!body) return issues;

    if (de.scrollWidth > de.clientWidth + 2 || body.scrollWidth > de.clientWidth + 2) {
      issues.push(`page overflows horizontally (content ${Math.max(de.scrollWidth, body.scrollWidth)}px wide, viewport ${de.clientWidth}px)`);
    }
    if (de.scrollHeight > de.clientHeight + 2 || body.scrollHeight > de.clientHeight + 2) {
      issues.push(`page overflows vertically (content ${Math.max(de.scrollHeight, body.scrollHeight)}px tall, viewport ${de.clientHeight}px)`);
    }

    const internalScroll: string[] = [];
    const ignoreScrollSelector = 'html, body, pre, code, textarea, select, option, .katex-mathml, .katex-mathml *';
    const allowedInternalScrollSelector = '.teaching-column, .left-panel, #left-panel, #info-panel, .guide-panel, .playground-left, aside.guide, [data-teaching-column]';
    const allElements = Array.from(body.querySelectorAll<HTMLElement>('*'));
    for (const el of allElements) {
      if (el.matches(ignoreScrollSelector)) continue;
      if (el.matches(allowedInternalScrollSelector)) continue;
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
        if (style.overflowY === 'auto' && el.matches('aside, .panel, [class*="teach"], [class*="guide"], [class*="left"]')) {
          continue;
        }
        const label = el.id
          ? `#${el.id}`
          : `${el.tagName.toLowerCase()}${Array.from(el.classList).slice(0, 2).map(name => `.${name}`).join('')}`;
        internalScroll.push(`${label} has internal vertical overflow (${el.scrollHeight}px content, ${el.clientHeight}px visible)`);
      }
      if (horizontalOverflow > 4 && clipsOrScrollsX) {
        if (style.overflowX === 'auto' && el.matches('aside, .panel, [class*="teach"], [class*="guide"], [class*="left"]')) {
          continue;
        }
        const label = el.id
          ? `#${el.id}`
          : `${el.tagName.toLowerCase()}${Array.from(el.classList).slice(0, 2).map(name => `.${name}`).join('')}`;
        internalScroll.push(`${label} has internal horizontal overflow (${el.scrollWidth}px content, ${el.clientWidth}px visible)`);
      }
    }
    for (const item of internalScroll.slice(0, maxFindingsPerCategory)) {
      issues.push(`internal scroll/clipping: ${item}`);
    }

    const tiny: string[] = [];
    const undersizedBody: string[] = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const controlSelector = 'button, input, select, textarea, [role="tab"], [data-activity-tab], .badge, .chip, .tag, .axis, .tick, .caption, .label, .control-label, svg';
      const headingSelector = 'h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"], [class*="label"]';
      // Do not include #activity-stage / main / aside — that made every 18-char
      // step title inside the stage count as body text and fail at 15px.
      const bodySelector = 'p, li, #activity-instructions, .prompt, .instructions, .feedback, .question';

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
      const headingLike = Boolean(el.closest(headingSelector));
      const bodyLike = text.length >= 18 && !controlLike && !headingLike && Boolean(el.closest(bodySelector));
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
  }, { minVisibleTextPx: MIN_VISIBLE_TEXT_PX, minBodyTextPx: MIN_BODY_TEXT_PX, maxFindingsPerCategory: MAX_FINDINGS_PER_CATEGORY });
  return findings.map(finding => `[${context}] ${finding}`);
}

function loadRubricPrompt() {
  return readFileSync(path.join(PROMPTS_DIR, 'practice-rubric.md'), 'utf8').trim();
}

function formatSpecForRubric(kind: 'interactive' | 'game', spec: InteractiveSpec | GameSpec) {
  if (kind === 'game') {
    const game = spec as GameSpec;
    return [
      'Type: game',
      `mission: ${game.mission}`,
      `visibleSetup: ${game.visibleSetup || 'Not specified'}`,
      `learnerAction: ${game.learnerAction || 'Not specified'}`,
      `controls: ${(game.controls || []).join('; ') || 'Not specified'}`,
      `feedback: ${game.feedback || 'Not specified'}`,
      `successCriterion: ${game.successCriterion}`
    ].join('\n');
  }
  const interactive = spec as InteractiveSpec;
  const activities = interactive.activities.map((activity, index) => {
    return [
      `Activity ${index + 1}: ${activity.title} (mode=${activity.mode})`,
      `  visibleSetup: ${activity.visibleSetup || 'Not specified'}`,
      `  learnerAction: ${activity.learnerAction}`,
      `  controls: ${(activity.controls || []).join('; ') || 'Not specified'}`,
      `  feedback: ${activity.feedback || 'Not specified'}`,
      `  successCriterion: ${activity.successCriterion}`
    ].join('\n');
  });
  return `Type: interactive\nActivity count: ${interactive.activities.length}\n${activities.join('\n')}`;
}

async function dismissStartOverlay(page: Page) {
  const startButton = page.getByRole('button', {
    name: /^(start|begin|continue|got it|close|dismiss|let'?s go|play|try|start .*)/i
  }).first();
  try {
    await startButton.click({ timeout: 700 });
    await page.waitForTimeout(400);
  } catch {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    } catch {
      // ignore overlay dismissal failures
    }
  }
}

export async function capturePracticeScreenshots(htmlPath: string, outDir: string): Promise<ScreenshotCaptureResult> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files']
  });
  const screenshotPaths: string[] = [];
  const pageErrors: string[] = [];
  const readabilityFindings: string[] = [];

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 }
    });
    page.on('pageerror', err => {
      pageErrors.push(err instanceof Error ? err.message : String(err));
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);

    const mainPath = path.join(outDir, 'screen-main.png');
    await page.screenshot({ path: mainPath, fullPage: false });
    screenshotPaths.push(mainPath);

    await dismissStartOverlay(page);
    const activePath = path.join(outDir, 'screen-active.png');
    await page.screenshot({ path: activePath, fullPage: false });
    screenshotPaths.push(activePath);
    readabilityFindings.push(...await collectReadabilityFindings(page, 'main screen'));

    const tabSelectors = [
      '[data-activity-tab]',
      '.tab-button',
      'button[role="tab"]',
      '#activity-header button',
      '.activity-tab'
    ];

    let tabs = [];
    for (const selector of tabSelectors) {
      tabs = await page.$$(selector);
      if (tabs.length > 1) break;
    }

    const maxTabs = Math.min(tabs.length, 4);
    for (let index = 0; index < maxTabs; index += 1) {
      try {
        await tabs[index].click();
        await page.waitForTimeout(500);
        const tabPath = path.join(outDir, `screen-tab-${index}.png`);
        await page.screenshot({ path: tabPath, fullPage: false });
        screenshotPaths.push(tabPath);
        readabilityFindings.push(...await collectReadabilityFindings(page, `tab ${index + 1}`));
      } catch {
        // ignore tab click failures
      }
    }
  } finally {
    await browser.close();
  }

  return { screenshotPaths, pageErrors, readabilityFindings: [...new Set(readabilityFindings)] };
}

function normalizeRubricResponse(raw: unknown): RubricResult {
  if (!raw || typeof raw !== 'object') {
    return { passed: false, findings: ['Rubric returned invalid JSON'] };
  }
  const result = raw as Record<string, unknown>;
  const passed = Boolean(result.passed);
  const findings = Array.isArray(result.findings)
    ? result.findings.map(item => String(item).trim()).filter(Boolean)
    : [];
  if (!passed && findings.length === 0) {
    findings.push('Review failed with no specific findings');
  }
  return { passed, findings };
}

export async function reviewPracticeWithRubric(options: {
  objective: string;
  htmlPath: string;
  kind: 'interactive' | 'game';
  spec: InteractiveSpec | GameSpec;
  screenshotDir: string;
  model?: string;
}): Promise<RubricResult> {
  // Fail-fast on author CSS brace bugs.
  const htmlForCssParse = readFileSync(options.htmlPath, 'utf8');
  const cssParseFindings = collectInlineCssParseFindings(htmlForCssParse);
  if (cssParseFindings.length > 0) {
    return {
      passed: false,
      findings: cssParseFindings.map(finding =>
        `CSS parse check: ${finding}. Fix missing braces / invalid CSS so later rules (including font-size) actually apply.`
      )
    };
  }

  const { screenshotPaths, pageErrors, readabilityFindings } = await capturePracticeScreenshots(options.htmlPath, options.screenshotDir);
  if (pageErrors.length > 0) {
    return { passed: false, findings: [`Page JavaScript error: ${pageErrors[0]}`] };
  }
  if (screenshotPaths.length === 0) {
    return { passed: false, findings: ['Could not capture screenshots'] };
  }
  if (readabilityFindings.length > 0) {
    // Fail before the LLM rubric: these are objective violations, and fixing them
    // changes the layout enough that a rubric pass now would be wasted.
    return {
      passed: false,
      findings: readabilityFindings.map(finding =>
        `Readability check (1280x720): ${finding}. Fix by reducing content, compacting chrome, or splitting steps.`
      )
    };
  }

  const model = tryResolveReviewModel(options.model);
  if (!model) {
    throw new Error(
      'No model configured for practice QA (set COURSEGEN_REVIEW_MODEL or AGENT_MODEL, or pass --model).'
    );
  }

  const llm = new LLM_Model(model, loadRubricPrompt(), null, true);

  const userPrompt = [
    `Learning objective: ${options.objective}`,
    '',
    formatSpecForRubric(options.kind, options.spec)
  ].join('\n');

  const attachments = screenshotPaths.map(screenshotPath => ({
    path: path.resolve(screenshotPath),
    kind: 'image' as const
  }));

  const raw = await llm.generate(userPrompt, null, null, null, attachments, true, false);
  return normalizeRubricResponse(raw);
}

export function cleanupScreenshotDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
