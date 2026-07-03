import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { LLM_Model } from '../../packages/lecture-agent/src/llm_model.ts';
import type { GameSpec, InteractiveSpec } from './types.ts';

const PROMPTS_DIR = path.join(import.meta.dirname, 'prompts');

export type RubricResult = {
  passed: boolean;
  findings: string[];
};

export type ScreenshotCaptureResult = {
  screenshotPaths: string[];
  pageErrors: string[];
};

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
      } catch {
        // ignore tab click failures
      }
    }
  } finally {
    await browser.close();
  }

  return { screenshotPaths, pageErrors };
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
  const { screenshotPaths, pageErrors } = await capturePracticeScreenshots(options.htmlPath, options.screenshotDir);
  if (pageErrors.length > 0) {
    return { passed: false, findings: [`Page JavaScript error: ${pageErrors[0]}`] };
  }
  if (screenshotPaths.length === 0) {
    return { passed: false, findings: ['Could not capture screenshots'] };
  }

  const model = options.model || process.env.AGENT_MODEL;
  if (!model) {
    return { passed: false, findings: ['No model configured for practice QA (set AGENT_MODEL)'] };
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
