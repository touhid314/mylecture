import type { Page } from 'playwright';

// Keep aligned with prompts/interactive-practice.md (Interaction engineering section).
export const MAX_INTERACTION_FINDINGS = 3;

export type RectSnapshot = {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type InteractionDomSnapshot = {
  instructionText: string;
  hasPracticeOrChallenge: boolean;
  dashedMarkersInStage: RectSnapshot[];
  placedItemsInStage: RectSnapshot[];
};

export type InteractionSelectionSnapshot = {
  selectedCount: number;
  readyToPlace: boolean;
};

export type InteractionPlacementSnapshot = {
  poolItemCount: number;
  placedItemCount: number;
};

function rectsOverlap(a: RectSnapshot, b: RectSnapshot): boolean {
  const overlapX = Math.min(a.width, b.width) * 0.5;
  const overlapY = Math.min(a.height, b.height) * 0.5;
  return Math.abs(a.centerX - b.centerX) < overlapX && Math.abs(a.centerY - b.centerY) < overlapY;
}

export function analyzeInteractionDom(snapshot: InteractionDomSnapshot): string[] {
  const findings: string[] = [];
  const { instructionText, hasPracticeOrChallenge, dashedMarkersInStage, placedItemsInStage } = snapshot;
  const mentionsClickOrTap = /\b(click|tap)\b/i.test(instructionText);
  const mentionsPlacementAction =
    /\b(place|position|drop|slot|tick|marker|drag|move|put|match|connect|draw|plot|point)\b/i.test(instructionText);

  if (
    hasPracticeOrChallenge &&
    dashedMarkersInStage.length >= 2 &&
    mentionsPlacementAction
  ) {
    findings.push(
      'practice/challenge stage shows multiple visible dashed placement markers before any attempt; hide empty drop targets until hover/drag/select, and never mark correct answer positions before submit'
    );
  }

  for (const placed of placedItemsInStage) {
    for (const marker of dashedMarkersInStage) {
      if (rectsOverlap(placed, marker)) {
        findings.push(
          'a placed item overlaps a dashed placement marker; remove or hide the marker when its slot is filled'
        );
        break;
      }
    }
    if (findings.length >= MAX_INTERACTION_FINDINGS) break;
  }

  if (mentionsClickOrTap && mentionsPlacementAction && dashedMarkersInStage.length >= 2) {
    findings.push(
      'instructions describe click/tap placement, but visible dashed markers may confuse the flow; show placement previews only while an item is selected or being dragged'
    );
  }

  return [...new Set(findings)].slice(0, MAX_INTERACTION_FINDINGS);
}

// Inlined in page.evaluate — nested arrow functions break under tsx (esbuild injects
// __name helpers that do not exist in the browser context).
export async function collectInteractionDomSnapshot(page: Page): Promise<InteractionDomSnapshot> {
  return page.evaluate(() => {
    const instructionText = [
      document.getElementById('activity-instructions')?.textContent || '',
      document.querySelector('.control-tip')?.textContent || '',
      document.querySelector('#activity-controls p')?.textContent || ''
    ].join(' ').replace(/\s+/g, ' ').trim();

    const activeTab = document.querySelector('[data-activity-tab][data-active="true"]');
    const activeTabText = activeTab?.textContent || '';
    const hasPracticeOrChallenge =
      /practice|challenge/i.test(activeTabText) ||
      /practice|challenge/i.test(instructionText) ||
      document.querySelector('[data-activity-tab][data-active="true"][data-mode="practice"], [data-activity-tab][data-active="true"][data-mode="challenge"]') !== null;

    const stage = document.getElementById('activity-stage');
    const dashedMarkersInStage: Array<{ width: number; height: number; centerX: number; centerY: number }> = [];
    const placedItemsInStage: Array<{ width: number; height: number; centerX: number; centerY: number }> = [];

    if (stage) {
      for (const el of Array.from(stage.querySelectorAll<HTMLElement>('*'))) {
        const visStyle = getComputedStyle(el);
        if (visStyle.display === 'none' || visStyle.visibility === 'hidden' || Number(visStyle.opacity) === 0) continue;
        const visRect = el.getBoundingClientRect();
        if (visRect.width <= 0 || visRect.height <= 0) continue;

        const style = getComputedStyle(el);
        const hasDashedBorder = style.borderStyle.includes('dashed');
        const hasDashedOutline = style.outlineStyle.includes('dashed');
        if (hasDashedBorder || hasDashedOutline) {
          dashedMarkersInStage.push({
            width: visRect.width,
            height: visRect.height,
            centerX: visRect.left + visRect.width / 2,
            centerY: visRect.top + visRect.height / 2
          });
        }
      }

      const placedSelectors = [
        '#placed-chips-container > *',
        '.placed-items > *',
        '[data-placed="true"]',
        '.integer-chip.placed',
        '.chip.placed',
        '.placed'
      ];
      for (const selector of placedSelectors) {
        for (const el of Array.from(stage.querySelectorAll<HTMLElement>(selector))) {
          const visStyle = getComputedStyle(el);
          if (visStyle.display === 'none' || visStyle.visibility === 'hidden' || Number(visStyle.opacity) === 0) continue;
          const visRect = el.getBoundingClientRect();
          if (visRect.width <= 0 || visRect.height <= 0) continue;
          placedItemsInStage.push({
            width: visRect.width,
            height: visRect.height,
            centerX: visRect.left + visRect.width / 2,
            centerY: visRect.top + visRect.height / 2
          });
        }
      }
    }

    return {
      instructionText,
      hasPracticeOrChallenge,
      dashedMarkersInStage,
      placedItemsInStage
    };
  });
}

function looksLikePlacementActivity(snapshot: InteractionDomSnapshot): boolean {
  return /\b(place|position|drag|drop|tap|click|slot|tick)\b/i.test(snapshot.instructionText);
}

export async function runInteractionSmokeTest(page: Page): Promise<string[]> {
  const snapshot = await collectInteractionDomSnapshot(page);
  if (!looksLikePlacementActivity(snapshot)) {
    return [];
  }

  const findings: string[] = [];
  const mentionsClickOrTap = /\b(click|tap)\b/i.test(snapshot.instructionText);

  const chipLocator = page.locator(
    [
      '#chips-pool > *',
      '.chips-pool > *',
      '[data-chip-pool] > *',
      '#activity-controls [draggable="true"]',
      '#activity-stage [draggable="true"]'
    ].join(', ')
  ).first();

  if (await chipLocator.count() === 0) {
    return findings;
  }

  try {
    await chipLocator.click({ timeout: 2000 });
    await page.waitForTimeout(300);
  } catch {
    return findings;
  }

  const afterSelect = await page.evaluate(() => {
    const selectedCount = document.querySelectorAll(
      '.selected, .is-selected, [data-selected="true"], [aria-selected="true"], [aria-pressed="true"]'
    ).length;
    const readyToPlace = Boolean(
      document.querySelector('.ready-to-place, [data-ready-to-place="true"]')
    );
    return { selectedCount, readyToPlace };
  });

  if (mentionsClickOrTap && afterSelect.selectedCount === 0 && !afterSelect.readyToPlace) {
    findings.push(
      'instructions describe click/tap to select movable items, but clicking a source item does not update visible selection state'
    );
    return findings.slice(0, MAX_INTERACTION_FINDINGS);
  }

  if (!mentionsClickOrTap) {
    return findings;
  }

  const stageLocator = page.locator(
    '#activity-stage, #number-line-container, .drop-zone, [data-drop-target]'
  ).first();
  if (await stageLocator.count() === 0) {
    return findings;
  }

  const beforePlace = await page.evaluate(() => ({
    poolItemCount: document.querySelectorAll('#chips-pool > *, .chips-pool > *').length,
    placedItemCount: document.querySelectorAll(
      '#placed-chips-container > *, .placed-items > *, #activity-stage .placed, #activity-stage .integer-chip.placed'
    ).length
  }));

  try {
    const box = await stageLocator.boundingBox();
    if (!box) return findings;
    await stageLocator.click({
      position: { x: Math.max(20, box.width * 0.5), y: Math.max(20, box.height * 0.35) },
      timeout: 2000
    });
    await page.waitForTimeout(300);
  } catch {
    return findings;
  }

  const afterPlace = await page.evaluate(() => ({
    poolItemCount: document.querySelectorAll('#chips-pool > *, .chips-pool > *').length,
    placedItemCount: document.querySelectorAll(
      '#placed-chips-container > *, .placed-items > *, #activity-stage .placed, #activity-stage .integer-chip.placed'
    ).length
  }));

  const poolChanged = afterPlace.poolItemCount < beforePlace.poolItemCount;
  const placedChanged = afterPlace.placedItemCount > beforePlace.placedItemCount;
  if (!poolChanged && !placedChanged) {
    findings.push(
      'instructions describe click-to-place, but selecting a source item and clicking the stage does not place it (verify click handlers on both source items and the drop target)'
    );
  }

  const postPlaceSnapshot = await collectInteractionDomSnapshot(page);
  findings.push(...analyzeInteractionDom(postPlaceSnapshot));

  return [...new Set(findings)].slice(0, MAX_INTERACTION_FINDINGS);
}

async function runPrimaryCheckSmokeTest(page: Page): Promise<string[]> {
  const findings: string[] = [];
  const checkButton = page.getByRole('button', {
    name: /^(check|check answer|submit|submit answer|done)$/i
  }).first();

  if (await checkButton.count() === 0) {
    return findings;
  }

  const before = await page.evaluate(() => ({
    bodyText: document.body?.innerText || '',
    shownFeedbackCount: document.querySelectorAll(
      '.show, .visible, [role="alert"], .correct-banner, .incorrect-banner, .feedback.show, .feedback-banner.show'
    ).length,
    buttonText: Array.from(document.querySelectorAll('button'))
      .map(button => button.textContent?.replace(/\s+/g, ' ').trim() || '')
      .find(text => /^(check|check answer|submit|submit answer|done)$/i.test(text)) || ''
  }));

  const candidateAnswer = page.locator(
    [
      '.key-btn:not(.action-key)',
      '[data-answer]',
      '.answer-choice',
      '.choice',
      'button[aria-label^="Answer"]'
    ].join(', ')
  ).first();

  try {
    if (await candidateAnswer.count() > 0) {
      await candidateAnswer.click({ timeout: 1500 });
      await page.waitForTimeout(150);
    }
  } catch {
    // Some check flows do not need preselection; the button click below is the important smoke test.
  }

  try {
    await checkButton.click({ timeout: 2000 });
    await page.waitForTimeout(400);
  } catch {
    findings.push('primary Check/Submit button could not be clicked');
    return findings;
  }

  const after = await page.evaluate(() => ({
    bodyText: document.body?.innerText || '',
    shownFeedbackCount: document.querySelectorAll(
      '.show, .visible, [role="alert"], .correct-banner, .incorrect-banner, .feedback.show, .feedback-banner.show'
    ).length,
    hasNextAction: Array.from(document.querySelectorAll('button')).some(button =>
      /\b(next|continue|summary|again)\b/i.test(button.textContent || '')
    )
  }));

  const bodyChanged = before.bodyText !== after.bodyText;
  const feedbackShown = after.shownFeedbackCount > before.shownFeedbackCount;
  if (!bodyChanged && !feedbackShown && !after.hasNextAction) {
    findings.push(
      'primary Check/Submit button does not visibly respond after an answer selection; verify answer state, click handler globals, feedback rendering, and next-action updates'
    );
  }

  return findings;
}

export async function collectInteractionFindings(page: Page, context: string): Promise<string[]> {
  const snapshot = await collectInteractionDomSnapshot(page);
  const staticFindings = analyzeInteractionDom(snapshot);
  const smokeFindings = await runInteractionSmokeTest(page);
  const checkFindings = await runPrimaryCheckSmokeTest(page);
  return [...new Set([...staticFindings, ...smokeFindings, ...checkFindings])]
    .slice(0, MAX_INTERACTION_FINDINGS)
    .map(finding => `[${context}] ${finding}`);
}
