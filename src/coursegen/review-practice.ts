import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { LLM_Model } from '../../packages/lecture-agent/src/llm_model.ts';
import { collectInteractionFindings, analyzeInteractionDom, collectInteractionDomSnapshot } from './interaction-qa.ts';
import { collectReadabilityIssues, formatReadabilityIssue } from './readability-qa.ts';
import { collectShellWalkFindings } from './shell-qa.ts';
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
  interactionFindings: string[];
};

type ReviewViewport = {
  name: string;
  width: number;
  height: number;
  isMobile?: boolean;
};

// Typography thresholds live in readability-qa.ts (shared with shell e2e tests).

async function collectReadabilityFindings(page: Page, context: string): Promise<string[]> {
  const issues = await collectReadabilityIssues(page);
  return issues.map(issue => formatReadabilityIssue(issue, context));
}

const REVIEW_VIEWPORTS: ReviewViewport[] = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'phone', width: 390, height: 844, isMobile: true }
];

const PRACTICE_RUBRIC = readFileSync(path.join(PROMPTS_DIR, 'practice-rubric.md'), 'utf8').trim();

export function validatePracticeHtmlStructure(html: string): string[] {
  const findings: string[] = [];
  const lower = html.toLowerCase();
  const headClose = lower.indexOf('</head>');
  const bodyOpen = lower.indexOf('<body');

  if (headClose >= 0) {
    const beforeHeadClose = lower.slice(0, headClose);
    const lastStyleOpen = beforeHeadClose.lastIndexOf('<style');
    const lastStyleClose = beforeHeadClose.lastIndexOf('</style>');
    if (lastStyleOpen >= 0 && lastStyleOpen > lastStyleClose) {
      findings.push(
        'HTML structure error: missing closing </style> tag before </head>, causing the browser to parse the body as CSS and render a blank page.'
      );
    }

    const lastScriptOpen = beforeHeadClose.lastIndexOf('<script');
    const lastScriptClose = beforeHeadClose.lastIndexOf('</script>');
    if (lastScriptOpen >= 0 && lastScriptOpen > lastScriptClose) {
      findings.push(
        'HTML structure error: missing closing </script> tag before </head>, causing the browser to parse later markup as script and potentially render a blank page.'
      );
    }
  }

  if (bodyOpen < 0) {
    findings.push('HTML structure error: missing <body> tag, so the practice page may not render its learner UI.');
  }

  return findings;
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
      `successCriterion: ${game.successCriterion}`,
      `pacing: ${game.pacing ?? 'steady'} (timer seconds come from shell config — do not invent raw durations)`
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

async function collectShellInteractionFindings(
  page: Page,
  viewportName: string,
  walkOptions?: { onAdvancedToItem2?: () => Promise<void> }
): Promise<string[]> {
  const findings: string[] = [];
  findings.push(...await collectShellWalkFindings(page, `${viewportName} shell walk`, walkOptions));
  const domSnapshot = await collectInteractionDomSnapshot(page);
  findings.push(
    ...analyzeInteractionDom(domSnapshot).map(finding => `[${viewportName} stage DOM] ${finding}`)
  );
  return findings;
}

function formatReadabilityFinding(finding: string, isShellPage: boolean): string {
  if (finding.includes('[shell-chrome]')) {
    return `Responsive readability check: ${finding}. Shell chrome QA failure (coursegen bug, not repairable by the practice agent): fix in src/coursegen/activity-shell (shell.css / shell.js), not in stage.js.`;
  }
  if (isShellPage) {
    return `Responsive readability check: ${finding}. Fix stage content or stage.css inside #activity-stage / #shell-stage-inner — remove or defer content (explanations in checkAnswer.explanation); never shrink text below readability floors.`;
  }
  return `Responsive readability check: ${finding}. Fix by reducing content, compacting chrome, switching to a one-column/touch layout, or splitting steps — never shrink text below readability floors.`;
}

function formatInteractionFinding(finding: string): string {
  const isShellFinding = /shell walk\]|stage DOM\]/i.test(finding);
  if (isShellFinding) {
    return `Interaction check: ${finding}. Fix stage.js: wire response controls with ctx.setResponse, implement renderItem and checkAnswer consistently, and remove answer leakage before submit.`;
  }
  return `Interaction check: ${finding}. Fix by wiring click/tap handlers for every described action, hiding filled placement markers, and showing drop previews only while an item is selected or dragged.`;
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

async function captureViewportScreenshots(
  page: Page,
  htmlPath: string,
  outDir: string,
  viewport: ReviewViewport
): Promise<{ screenshotPaths: string[]; readabilityFindings: string[]; interactionFindings: string[] }> {
  const screenshotPaths: string[] = [];
  const readabilityFindings: string[] = [];
  const interactionFindings: string[] = [];

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);

  const shellVersion = await page.evaluate(() => document.documentElement.getAttribute('data-shell-version'));

  const mainPath = path.join(outDir, `${viewport.name}-screen-main.png`);
  await page.screenshot({ path: mainPath, fullPage: false });
  screenshotPaths.push(mainPath);

  await dismissStartOverlay(page);
  const activePath = path.join(outDir, `${viewport.name}-screen-active.png`);
  await page.screenshot({ path: activePath, fullPage: false });
  screenshotPaths.push(activePath);
  readabilityFindings.push(...await collectReadabilityFindings(page, `${viewport.name} main screen`));

  if (shellVersion) {
    const item2Path = viewport.isMobile
      ? path.join(outDir, `${viewport.name}-screen-item-2.png`)
      : undefined;
    interactionFindings.push(...await collectShellInteractionFindings(page, viewport.name, item2Path
      ? {
          onAdvancedToItem2: async () => {
            await page.screenshot({ path: item2Path, fullPage: false });
            screenshotPaths.push(item2Path);
          }
        }
      : undefined));
  } else {
    interactionFindings.push(...await collectInteractionFindings(page, `${viewport.name} interaction smoke test`));
  }

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

  const maxTabs = Math.min(tabs.length, viewport.isMobile ? 2 : 4);
  for (let index = 0; index < maxTabs; index += 1) {
    try {
      await tabs[index].click();
      await page.waitForTimeout(500);
      const tabPath = path.join(outDir, `${viewport.name}-screen-tab-${index}.png`);
      await page.screenshot({ path: tabPath, fullPage: false });
      screenshotPaths.push(tabPath);
      readabilityFindings.push(...await collectReadabilityFindings(page, `${viewport.name} tab ${index + 1}`));
    } catch {
      // ignore tab click failures
    }
  }

  return { screenshotPaths, readabilityFindings, interactionFindings };
}

export async function capturePracticeScreenshots(htmlPath: string, outDir: string): Promise<ScreenshotCaptureResult> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files']
  });
  const screenshotPaths: string[] = [];
  const pageErrors: string[] = [];
  const readabilityFindings: string[] = [];
  const interactionFindings: string[] = [];

  try {
    const page = await browser.newPage();
    page.on('pageerror', err => {
      pageErrors.push(err instanceof Error ? err.message : String(err));
    });

    for (const viewport of REVIEW_VIEWPORTS) {
      const result = await captureViewportScreenshots(page, htmlPath, outDir, viewport);
      screenshotPaths.push(...result.screenshotPaths);
      readabilityFindings.push(...result.readabilityFindings);
      interactionFindings.push(...result.interactionFindings);
    }
  } finally {
    await browser.close();
  }

  return {
    screenshotPaths,
    pageErrors: [...new Set(pageErrors)],
    readabilityFindings: [...new Set(readabilityFindings)],
    interactionFindings: [...new Set(interactionFindings)]
  };
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

const HTML_SOURCE_MAX_CHARS = 60_000;

function loadHtmlSourceForRubric(htmlPath: string): string {
  const full = readFileSync(htmlPath, 'utf8');
  if (full.length <= HTML_SOURCE_MAX_CHARS) {
    return full;
  }
  return `${full.slice(0, HTML_SOURCE_MAX_CHARS)}\n[truncated: showing first ${HTML_SOURCE_MAX_CHARS} of ${full.length} characters]`;
}

export async function reviewPracticeWithRubric(options: {
  objective: string;
  htmlPath: string;
  kind: 'interactive' | 'game';
  spec: InteractiveSpec | GameSpec;
  screenshotDir: string;
  model?: string;
}): Promise<RubricResult> {
  const htmlSource = readFileSync(options.htmlPath, 'utf8');
  const isShellPage = htmlSource.includes('data-shell-version');
  const staticFindings = validatePracticeHtmlStructure(htmlSource);
  if (staticFindings.length > 0) {
    return { passed: false, findings: staticFindings };
  }

  const { screenshotPaths, pageErrors, readabilityFindings, interactionFindings } =
    await capturePracticeScreenshots(options.htmlPath, options.screenshotDir);
  if (screenshotPaths.length === 0) {
    return { passed: false, findings: ['Could not capture screenshots'] };
  }

  const combined: string[] = [];
  for (const error of pageErrors) {
    combined.push(`Page JavaScript error: ${error}`);
  }
  combined.push(
    ...readabilityFindings.map(finding => formatReadabilityFinding(finding, isShellPage))
  );
  combined.push(
    ...interactionFindings.map(finding => formatInteractionFinding(finding))
  );
  if (combined.length > 0) {
    return { passed: false, findings: combined };
  }

  const model = options.model || process.env.AGENT_MODEL;
  if (!model) {
    return { passed: false, findings: ['No model configured for practice QA (set AGENT_MODEL)'] };
  }

  const llm = new LLM_Model(model, PRACTICE_RUBRIC, null, true);

  const userPrompt = [
    `Learning objective: ${options.objective}`,
    '',
    formatSpecForRubric(options.kind, options.spec),
    '',
    '--- page HTML source ---',
    loadHtmlSourceForRubric(options.htmlPath)
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
