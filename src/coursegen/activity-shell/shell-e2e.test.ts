import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium, type Page } from 'playwright';
import { assembleActivityHtml, buildActivityShellConfig } from './assemble.ts';
import { collectReadabilityIssues } from '../readability-qa.ts';
import { STAGE_FIT_TOLERANCE_PX, collectShellWalkFindings, measureStageOverflow } from '../shell-qa.ts';

const FIXTURE_STAGE = readFileSync(
  path.join(import.meta.dirname, '../../../tests/fixtures/activity-shell/stage.js'),
  'utf8'
);

function buildFixtureHtml(): string {
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: 'Pick an answer.',
      learnerAction: 'Select the correct choice, then check.',
      controls: ['choices', 'check', 'next'],
      feedback: 'Shows correctness.',
      successCriterion: 'Get 3 correct answers.'
    }]
  }, { title: 'Fixture practice', objective: 'Add small numbers.' });
  return assembleActivityHtml({ config, stageJs: FIXTURE_STAGE });
}

function buildLongStringFixtureHtml(): string {
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Practice with extended labels for readability regression coverage',
      mode: 'practice',
      visibleSetup: 'Pick an answer from the choices shown on screen and use the check button when you are ready to verify your selection.',
      learnerAction: 'Select the correct choice from the list, then press the check answer button to submit your response.',
      controls: ['choices', 'check', 'next'],
      feedback: 'Shows whether your answer was correct or incorrect with a short explanation when available.',
      successCriterion: 'Reach a streak of 4 correct answers in a row'
    }]
  }, {
    title: 'Extended readability fixture for phone viewport shell chrome sweep testing',
    objective: 'Verify shell chrome text meets minimum body font sizes at 390px width.'
  });
  return assembleActivityHtml({ config, stageJs: FIXTURE_STAGE });
}

async function assertShellChromeReadabilityClean(page: Page, label: string) {
  const issues = await collectReadabilityIssues(page);
  const shellChromeViolations = issues.filter(issue => issue.shellChrome);
  assert.equal(
    shellChromeViolations.length,
    0,
    `${label}: shell chrome readability violations: ${shellChromeViolations.map(i => i.message).join('; ')}`
  );
}

async function assertNoDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const body = document.body;
    return {
      h: Math.max(de.scrollWidth, body?.scrollWidth || 0) > de.clientWidth + 2,
      v: Math.max(de.scrollHeight, body?.scrollHeight || 0) > de.clientHeight + 2
    };
  });
  assert.equal(overflow.h, false, 'horizontal document overflow');
  assert.equal(overflow.v, false, 'vertical document overflow');
}

async function runHappyPath(page: Page, label: string) {
  for (const id of ['activity-header', 'activity-instructions', 'activity-stage', 'activity-controls']) {
    assert.ok(await page.locator(`#${id}`).count() > 0, `${label}: missing #${id}`);
  }

  const counter = await page.locator('#shell-progress').textContent();
  assert.equal(counter?.trim(), '1 of 3', `${label}: counter start`);

  await assertNoDocumentOverflow(page);

  const checkBtn = page.locator('#shell-check-btn');
  assert.equal(await checkBtn.isDisabled(), true, `${label}: check disabled before response`);

  await page.locator('#activity-stage .stage-choice', { hasText: '4' }).first().click();
  assert.equal(await checkBtn.isDisabled(), false, `${label}: check enabled after response`);

  await checkBtn.click();
  await page.waitForSelector('#shell-feedback-banner[data-visible="true"]');
  const qa1 = await page.evaluate(() => (window as unknown as { __SHELL_QA__?: { correctCount?: number } }).__SHELL_QA__);
  assert.equal(qa1?.correctCount, 1, `${label}: correctCount after first check`);

  await page.locator('#shell-next-btn').click();
  const counter2 = await page.locator('#shell-progress').textContent();
  assert.equal(counter2?.trim(), '2 of 3', `${label}: counter after next`);

  const qa2 = await page.evaluate(() => (window as unknown as { __SHELL_QA__?: { currentIndex?: number } }).__SHELL_QA__);
  assert.equal(qa2?.currentIndex, 1, `${label}: currentIndex after next`);
}

async function answerRemainingCorrectly(page: Page) {
  const answers = ['6', '2'];
  for (const answer of answers) {
    await page.locator('#activity-stage .stage-choice', { hasText: answer }).first().click();
    await page.locator('#shell-check-btn').click();
    await page.waitForTimeout(200);
    const feedback = await page.locator('#shell-feedback-banner').getAttribute('data-correct');
    assert.equal(feedback, 'true');
    if (answer !== answers[answers.length - 1]) {
      await page.locator('#shell-next-btn').click();
      await page.waitForTimeout(200);
    }
  }
  await page.locator('#shell-next-btn').click();
  await page.waitForTimeout(200);
}

test('activity shell e2e: phone viewport shell chrome readability sweep with long strings', async () => {
  const html = buildLongStringFixtureHtml();
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-readability-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await assertShellChromeReadabilityClean(page, 'phone long strings');
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: stage content undersized text is flagged but not shell chrome', async () => {
  const tinyTextStage = `
    window.registerStage({
      activities: {
        main: {
          createItems: function () { return [{ id: 1 }]; },
          renderItem: function (ctx, item, el) {
            var p = document.createElement('p');
            p.className = 'stage-tiny-prompt';
            p.style.fontSize = '15px';
            p.textContent = 'This stage prompt is intentionally too small for phone readability QA thresholds.';
            el.appendChild(p);
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'stage-choice';
            b.textContent = 'ok';
            b.onclick = function () { ctx.setResponse('ok'); };
            el.appendChild(b);
          },
          checkAnswer: function () { return { correct: true }; }
        }
      }
    });
  `;
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Tiny text stage',
      mode: 'practice',
      visibleSetup: '',
      learnerAction: 'Answer.',
      controls: [],
      feedback: '',
      successCriterion: 'Get 1 correct.'
    }]
  }, { title: 'Tiny stage', objective: 'Flag stage violations.' });
  const html = assembleActivityHtml({ config, stageJs: tinyTextStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-stage-tiny-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const issues = await collectReadabilityIssues(page);
    const stageViolations = issues.filter(issue => !issue.shellChrome && (
      issue.message.includes('body/prompt text below') || issue.message.includes('text below')
    ));
    assert.ok(stageViolations.length > 0, 'expected stage content readability violation');
    const shellChromeViolations = issues.filter(issue => issue.shellChrome);
    assert.equal(shellChromeViolations.length, 0, 'shell chrome should not be flagged when only stage text is undersized');
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: oversized stage is never scaled or scrolled, and QA flags the overflow', async () => {
  const tallStage = `
    window.registerStage({
      activities: {
        main: {
          createItems: function () { return [{ id: 1 }]; },
          renderItem: function (ctx, item, el) {
            for (var i = 0; i < 14; i++) {
              var row = document.createElement('div');
              row.style.height = '60px';
              row.style.margin = '6px 0';
              row.style.background = '#222';
              row.textContent = 'Row ' + (i + 1);
              el.appendChild(row);
            }
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'stage-choice';
            b.id = 'stage-last-btn';
            b.textContent = 'Bottom answer';
            b.onclick = function () { ctx.setResponse('ok'); };
            el.appendChild(b);
          },
          checkAnswer: function () { return { correct: true }; }
        }
      }
    });
  `;
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Tall stage',
      mode: 'practice',
      visibleSetup: '',
      learnerAction: 'Answer.',
      controls: [],
      feedback: '',
      successCriterion: 'Get 1 correct.'
    }]
  }, { title: 'Tall stage', objective: 'Fit to one page.' });
  const html = assembleActivityHtml({ config, stageJs: tallStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-fit-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const fit = await page.evaluate(() => {
      const inner = document.getElementById('shell-stage-inner')!;
      const style = getComputedStyle(inner);
      return {
        innerOverflow: inner.scrollHeight - inner.clientHeight,
        transform: style.transform,
        zoom: style.zoom,
        overflowY: style.overflowY
      };
    });
    // The shell must not "fix" oversized content itself — no scale, no scroll.
    assert.equal(fit.transform, 'none', 'stage must not be transform-scaled');
    assert.ok(fit.zoom === '1' || fit.zoom === 'normal' || fit.zoom === '', `stage must not be zoomed, got ${fit.zoom}`);
    assert.equal(fit.overflowY, 'hidden', 'stage must not scroll');
    assert.ok(fit.innerOverflow > STAGE_FIT_TOLERANCE_PX, `fixture should genuinely overflow, got ${fit.innerOverflow}px`);
    await assertNoDocumentOverflow(page);

    // QA must catch it and route it to a stage repair.
    const overflow = await measureStageOverflow(page);
    assert.ok(overflow && overflow.vertical > STAGE_FIT_TOLERANCE_PX, 'measureStageOverflow must report the clipping');
    const findings = await collectShellWalkFindings(page, 'phone main screen');
    assert.ok(
      findings.some(f => f.includes('[stage-fixable]') && f.includes('does not fit')),
      `expected a stage-fixable fit finding, got: ${findings.join(' | ')}`
    );
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: fixture flow at desktop and phone viewports', async () => {
  const html = buildFixtureHtml();
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-e2e-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await runHappyPath(page, 'desktop');

    await answerRemainingCorrectly(page);
    const completeDesktop = await page.evaluate(() => ({
      dataset: document.documentElement.dataset.activityComplete,
      qa: (window as unknown as { __SHELL_QA__?: { completed?: boolean } }).__SHELL_QA__
    }));
    assert.equal(completeDesktop.dataset, 'true');
    assert.equal(completeDesktop.qa?.completed, true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await runHappyPath(page, 'phone');
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: stage renderItem throw shows error and pageerror', async () => {
  const badStage = `
    window.registerStage({
      activities: {
        main: {
          createItems: function () { return [{ x: 1 }]; },
          renderItem: function () { throw new Error('stage render failed'); },
          checkAnswer: function () { return { correct: false }; }
        }
      }
    });
  `;
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: '',
      learnerAction: 'Answer.',
      controls: [],
      feedback: '',
      successCriterion: 'Get 1 correct.'
    }]
  }, { title: 'Error test', objective: 'Test errors.' });
  const html = assembleActivityHtml({ config, stageJs: badStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-err-'));
  mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', err => {
      pageErrors.push(err instanceof Error ? err.message : String(err));
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    const errorCount = await page.locator('.shell-error').count();
    assert.ok(errorCount > 0, 'expected visible shell error state');
    assert.ok(pageErrors.some(msg => msg.includes('render failed') || msg.includes('renderItem')));
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: double requestCheck scores once', async () => {
  const autoCheckStage = `
    window.registerStage({
      activities: {
        main: {
          createItems: function () { return [{ id: 1 }]; },
          renderItem: function (ctx) {
            ctx.setResponse('ready');
            ctx.requestCheck();
            ctx.requestCheck();
          },
          checkAnswer: function () { return { correct: true }; }
        }
      }
    });
  `;
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: '',
      learnerAction: 'Answer.',
      controls: [],
      feedback: '',
      successCriterion: 'Get 1 correct.'
    }]
  }, { title: 'Auto check', objective: 'Guard.' });
  const html = assembleActivityHtml({ config, stageJs: autoCheckStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-double-check-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const qa = await page.evaluate(() => (window as unknown as { __SHELL_QA__?: { correctCount?: number } }).__SHELL_QA__);
    assert.equal(qa?.correctCount, 1);
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: tab switching preserves per-activity progress', async () => {
  const twoActivityStage = `
    window.registerStage({
      activities: {
        a: {
          createItems: function () { return [{ n: 1 }, { n: 2 }]; },
          renderItem: function (ctx, item, el) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'stage-choice';
            b.textContent = String(item.n);
            b.onclick = function () { ctx.setResponse(String(item.n)); };
            el.appendChild(b);
          },
          checkAnswer: function (ctx) { return { correct: ctx.getResponse() === '1' }; }
        },
        b: {
          createItems: function () { return [{ n: 9 }]; },
          renderItem: function (ctx, item, el) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'stage-choice';
            b.textContent = String(item.n);
            b.onclick = function () { ctx.setResponse(String(item.n)); };
            el.appendChild(b);
          },
          checkAnswer: function (ctx) { return { correct: true }; }
        }
      }
    });
  `;
  const config = buildActivityShellConfig('interactive', {
    activities: [
      {
        id: 'a',
        title: 'First',
        mode: 'practice',
        visibleSetup: '',
        learnerAction: 'Pick 1.',
        controls: [],
        feedback: '',
        successCriterion: 'Get 1 correct.'
      },
      {
        id: 'b',
        title: 'Second',
        mode: 'practice',
        visibleSetup: '',
        learnerAction: 'Pick 9.',
        controls: [],
        feedback: '',
        successCriterion: 'Get 1 correct.'
      }
    ]
  }, { title: 'Two tabs', objective: 'Tab progress.' });
  const html = assembleActivityHtml({ config, stageJs: twoActivityStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-tabs-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('#activity-stage .stage-choice', { hasText: '1' }).click();
    await page.locator('#shell-check-btn').click();
    await page.waitForTimeout(200);
    await page.locator('[data-activity-tab="b"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-activity-tab="a"]').click();
    await page.waitForTimeout(300);
    const qa = await page.evaluate(() => (window as unknown as { __SHELL_QA__?: { correctCount?: number; currentIndex?: number } }).__SHELL_QA__);
    assert.equal(qa?.correctCount, 1);
    assert.equal(qa?.currentIndex, 0);
    assert.equal(await page.locator('#shell-check-btn').isDisabled(), true);
    await page.locator('#shell-check-btn').click({ force: true });
    await page.waitForTimeout(150);
    const qaAfter = await page.evaluate(() => (window as unknown as { __SHELL_QA__?: { correctCount?: number } }).__SHELL_QA__);
    assert.equal(qaAfter?.correctCount, 1);
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: completion postMessage payload', async () => {
  const html = buildFixtureHtml();
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-msg-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { type?: string } | null;
        if (data?.type === 'mylecture:activity-complete') {
          const w = window as unknown as { __completionMsgs?: unknown[] };
          w.__completionMsgs = w.__completionMsgs || [];
          w.__completionMsgs.push(data);
        }
      });
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('#activity-stage .stage-choice', { hasText: '4' }).first().click();
    await page.locator('#shell-check-btn').click();
    await page.locator('#shell-next-btn').click();
    await page.locator('#activity-stage .stage-choice', { hasText: '6' }).first().click();
    await page.locator('#shell-check-btn').click();
    await page.locator('#shell-next-btn').click();
    await page.locator('#activity-stage .stage-choice', { hasText: '2' }).first().click();
    await page.locator('#shell-check-btn').click();
    await page.locator('#shell-next-btn').click();
    await page.waitForTimeout(300);
    const messages = await page.evaluate(() => (window as unknown as { __completionMsgs?: Array<Record<string, unknown>> }).__completionMsgs);
    assert.equal(messages?.length, 1);
    assert.equal(messages?.[0]?.type, 'mylecture:activity-complete');
    assert.equal(messages?.[0]?.correct, true);
    assert.equal(typeof messages?.[0]?.hintsUsed, 'number');
    assert.equal(typeof messages?.[0]?.retries, 'number');
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: summary try again when target unmet', async () => {
  const hardStage = `
    window.registerStage({
      activities: {
        main: {
          createItems: function () {
            return [{ answer: 'no' }];
          },
          renderItem: function (ctx, item, el) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'stage-choice';
            b.textContent = 'pick';
            b.onclick = function () { ctx.setResponse('no'); };
            el.appendChild(b);
          },
          checkAnswer: function () { return { correct: false }; }
        }
      }
    });
  `;
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'main',
      title: 'Practice',
      mode: 'practice',
      visibleSetup: '',
      learnerAction: 'Answer.',
      controls: [],
      feedback: '',
      successCriterion: 'Get 2 correct.'
    }]
  }, { title: 'Hard', objective: 'Fail then retry.' });
  const html = assembleActivityHtml({ config, stageJs: hardStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-summary-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('#activity-stage .stage-choice').first().click();
    await page.locator('#shell-check-btn').click();
    await page.waitForSelector('#shell-summary:not([hidden])');
    const summary = await page.locator('#shell-summary').textContent();
    assert.match(summary || '', /goal not reached/i);
    await page.locator('#shell-try-again-btn').click();
    const counter = await page.locator('#shell-progress').textContent();
    assert.equal(counter?.trim(), '1 of 1');
  } finally {
    await browser.close();
  }
});

test('activity shell e2e: challenge scoring path', async () => {
  const challengeStage = `
    window.registerStage({
      activities: {
        game: {
          createItems: function () { return [{}, {}, {}]; },
          renderItem: function (ctx, item, el) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'stage-choice';
            b.textContent = 'score';
            b.onclick = function () { ctx.setResponse(1); };
            el.appendChild(b);
          },
          checkAnswer: function () { return { correct: true, scoreDelta: 40 }; }
        }
      }
    });
  `;
  const config = buildActivityShellConfig('game', {
    mission: 'Score points.',
    visibleSetup: '',
    learnerAction: 'Answer challenges.',
    controls: [],
    feedback: '',
    successCriterion: 'Reach 80 points.'
  }, { title: 'Challenge', objective: 'Score.' });
  const html = assembleActivityHtml({ config, stageJs: challengeStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'activity-shell-challenge-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    for (let i = 0; i < 2; i += 1) {
      await page.locator('#activity-stage .stage-choice').first().click();
      await page.locator('#shell-check-btn').click();
      await page.waitForTimeout(150);
      if (i < 1) await page.locator('#shell-next-btn').click();
    }
    const scoreText = await page.locator('#shell-score').textContent();
    assert.match(scoreText || '', /80/);
    await page.locator('#shell-next-btn').click();
    await page.locator('#activity-stage .stage-choice').first().click();
    await page.locator('#shell-check-btn').click();
    await page.locator('#shell-next-btn').click();
    const complete = await page.evaluate(() => document.documentElement.dataset.activityComplete);
    assert.equal(complete, 'true');
  } finally {
    await browser.close();
  }
});
