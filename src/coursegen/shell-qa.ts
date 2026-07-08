import type { Page } from 'playwright';
import { collectOverlapFindings } from './layout-overlap.ts';

export const MAX_SHELL_WALK_FINDINGS = 4;

export const MAX_STAGE_HUD_FINDINGS = 2;

const LABELED_HUD_PATTERN = /\b(score|streak|goal)\s*[:\-]\s*\d+/i;
const SHORT_HUD_TEXT_MAX = 40;
const STAGE_HUD_CLASS_PATTERN = /\b(game-hud|stage-hud|custom-streak)\b/i;

export function analyzeStageHudText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (LABELED_HUD_PATTERN.test(trimmed)) {
    return 'stage renders its own score HUD that duplicates shell chrome';
  }
  if (
    trimmed.length <= SHORT_HUD_TEXT_MAX &&
    /\b(score|streak|goal)\b/i.test(trimmed) &&
    /\b\d+\s*\/\s*\d+\b/.test(trimmed)
  ) {
    return 'stage renders its own score/progress HUD that duplicates shell chrome';
  }
  return null;
}

export async function collectStageHudFindings(page: Page, context: string): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const inner = document.getElementById('shell-stage-inner');
    if (!inner) return { texts: [] as string[], classHits: [] as string[] };
    const texts: string[] = [];
    const classHits: string[] = [];
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode as Element | null;
    while (node) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) texts.push(text);
      const className = typeof node.className === 'string' ? node.className : '';
      if (className) classHits.push(className);
      node = walker.nextNode() as Element | null;
    }
    return { texts, classHits };
  });

  const findings: string[] = [];
  const seen = new Set<string>();
  for (const className of raw.classHits) {
    if (STAGE_HUD_CLASS_PATTERN.test(className)) {
      const key = `class:${className}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push(
          `[stage-fixable] stage renders its own HUD chrome (class "${className}") — remove it; the shell owns score/progress/timers`
        );
      }
    }
    if (findings.length >= MAX_STAGE_HUD_FINDINGS) {
      return findings.map(f => `[${context}] ${f}`).slice(0, MAX_STAGE_HUD_FINDINGS);
    }
  }
  for (const text of raw.texts) {
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const issue = analyzeStageHudText(text);
    if (issue) {
      findings.push(`[stage-fixable] ${issue} (element text: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}")`);
    }
    if (findings.length >= MAX_STAGE_HUD_FINDINGS) break;
  }
  return findings.map(f => `[${context}] ${f}`).slice(0, MAX_STAGE_HUD_FINDINGS);
}



export type ShellQaSnapshot = {

  version?: string;

  activityIds?: string[];

  currentActivityId?: string;

  currentActivityMode?: string;

  itemCount?: number;

  currentIndex?: number;

  correctCount?: number;

  completed?: boolean;

};

// Small slack for sub-pixel rounding; anything beyond this is real clipping.
export const STAGE_FIT_TOLERANCE_PX = 4;

export async function measureStageOverflow(page: Page): Promise<{ vertical: number; horizontal: number } | null> {
  return page.evaluate(() => {
    const inner = document.getElementById('shell-stage-inner');
    if (!inner) return null;
    return {
      vertical: inner.scrollHeight - inner.clientHeight,
      horizontal: inner.scrollWidth - inner.clientWidth
    };
  });
}



type ShellWalkOptions = {

  onAdvancedToItem2?: () => Promise<void>;

};



async function readShellQa(page: Page): Promise<ShellQaSnapshot | null> {

  return page.evaluate(() => {

    const qa = (window as unknown as { __SHELL_QA__?: ShellQaSnapshot }).__SHELL_QA__;

    return qa ?? null;

  });

}



export async function collectShellWalkFindings(

  page: Page,

  context: string,

  options?: ShellWalkOptions

): Promise<string[]> {

  const hudFindings = await collectStageHudFindings(page, context);
  const walkFindings: string[] = [];

  const finish = () => [
    ...hudFindings.slice(0, MAX_STAGE_HUD_FINDINGS),
    ...walkFindings.map(f => `[${context}] ${f}`).slice(0, MAX_SHELL_WALK_FINDINGS)
  ];

  const qa = await readShellQa(page);

  if (!qa || !qa.itemCount || qa.itemCount < 1) {

    walkFindings.push('shell QA hook missing or reports zero items');

    return finish();

  }

  const stageOverflow = await measureStageOverflow(page);
  if (stageOverflow && (stageOverflow.vertical > STAGE_FIT_TOLERANCE_PX || stageOverflow.horizontal > STAGE_FIT_TOLERANCE_PX)) {
    const axis = stageOverflow.vertical > STAGE_FIT_TOLERANCE_PX
      ? `${stageOverflow.vertical}px too tall`
      : `${stageOverflow.horizontal}px too wide`;
    walkFindings.push(
      `[stage-fixable] stage content does not fit its box (${axis}) and gets clipped — remove or defer content (put explanations in checkAnswer.explanation for the shell banner; do not stack a second in-stage explanation panel or rebuild HUD). Never shrink text below readability floors or add scrolling.`
    );
  }

  const preOverlap = await collectOverlapFindings(page, {
    rootSelector: '#shell-stage-inner',
    maxFindings: 2,
    messageSuffix:
      ' — separate competing stage layers or simplify the item; do not shrink fonts to hide collisions'
  });
  for (const finding of preOverlap) {
    walkFindings.push(`[stage-fixable] ${finding}`);
  }



  const progressText = await page.locator('#shell-progress').textContent();

  const expectedCounter = `${(qa.currentIndex ?? 0) + 1} of ${qa.itemCount}`;

  if ((progressText || '').trim() !== expectedCounter) {

    walkFindings.push(`progress counter shows "${(progressText || '').trim()}" but expected "${expectedCounter}"`);

  }



  const mode = qa.currentActivityMode || 'practice';



  if (mode === 'learn') {

    const markDoneBtn = page.locator('#shell-mark-done-btn');

    if (await markDoneBtn.count() === 0) {

      walkFindings.push('missing #shell-mark-done-btn in learn mode');

    } else if (await markDoneBtn.isHidden()) {

      walkFindings.push('#shell-mark-done-btn is hidden in learn mode');

    }

    return finish();

  }



  const stageControl = page.locator(

    '#activity-stage button, #activity-stage [role="button"], #activity-stage input[type="radio"], #activity-stage label'

  ).first();



  if (await stageControl.count() > 0) {

    try {

      await stageControl.click({ timeout: 2000 });

      await page.waitForTimeout(150);

    } catch {

      walkFindings.push('could not click a response control inside #activity-stage');

    }

  }



  const checkBtn = page.locator('#shell-check-btn');

  if (await checkBtn.count() === 0) {

    walkFindings.push('missing #shell-check-btn');

    return finish();

  }



  const wasDisabled = await checkBtn.isDisabled();

  if (wasDisabled && await stageControl.count() > 0) {

    walkFindings.push('Check button stayed disabled after selecting a stage response');

  }



  if (!wasDisabled) {

    try {

      await checkBtn.click({ timeout: 2000 });

      await page.waitForTimeout(400);

    } catch {

      walkFindings.push('could not click #shell-check-btn');

    }



    const feedbackVisible = await page.locator('#shell-feedback-banner[data-visible="true"]').count() > 0;
    const summaryVisible = await page.locator('#shell-summary:not([hidden])').count() > 0;
    if (!feedbackVisible && !summaryVisible) {
      walkFindings.push('feedback banner or summary did not become visible after Check');
    }

    const postOverflow = await measureStageOverflow(page);
    if (postOverflow && (postOverflow.vertical > STAGE_FIT_TOLERANCE_PX || postOverflow.horizontal > STAGE_FIT_TOLERANCE_PX)) {
      const axis = postOverflow.vertical > STAGE_FIT_TOLERANCE_PX
        ? `${postOverflow.vertical}px too tall`
        : `${postOverflow.horizontal}px too wide`;
      walkFindings.push(
        `[stage-fixable] after Check, stage content does not fit (${axis}) — feedback/explanation expanded the layout; put explanations in checkAnswer.explanation only (shell banner) and remove in-stage explanation panels. Never shrink text to fit.`
      );
    }
    const postOverlap = await collectOverlapFindings(page, {
      rootSelector: '#shell-stage-inner',
      maxFindings: 2,
      messageSuffix:
        ' — after Check, competing layers collided; remove in-stage explanation panels or simplify the item'
    });
    for (const finding of postOverlap) {
      walkFindings.push(`[stage-fixable] ${finding}`);
    }

    const nextBtn = page.locator('#shell-next-btn');
    if (await nextBtn.isVisible()) {

      const beforeIndex = (await readShellQa(page))?.currentIndex ?? qa.currentIndex ?? 0;

      try {

        await nextBtn.click({ timeout: 2000 });

        await page.waitForTimeout(300);

      } catch {

        walkFindings.push('could not click #shell-next-btn');

      }

      const afterQa = await readShellQa(page);

      if (afterQa && afterQa.currentIndex !== undefined && afterQa.currentIndex <= beforeIndex) {

        walkFindings.push('currentIndex did not advance after Next');

      }

      const afterCounter = await page.locator('#shell-progress').textContent();

      const expectedAfter = `${(afterQa?.currentIndex ?? 0) + 1} of ${afterQa?.itemCount ?? qa.itemCount}`;

      if ((afterCounter || '').trim() !== expectedAfter) {

        walkFindings.push(`counter after Next shows "${(afterCounter || '').trim()}" but expected "${expectedAfter}"`);

      }

      if (afterQa?.currentIndex === 1 && options?.onAdvancedToItem2) {

        await options.onAdvancedToItem2();

      }

    }

  }



  return finish();

}


