import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { assembleActivityHtml, buildActivityShellConfig } from './activity-shell/assemble.ts';
import { collectShellWalkFindings } from './shell-qa.ts';

const learnStageJs = `
window.registerStage({
  activities: {
    explore: {
      createItems: function () { return [{ label: 'sandbox' }]; },
      renderItem: function (ctx, item, el) {
        var p = document.createElement('p');
        p.textContent = item.label;
        el.appendChild(p);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Tap me';
        btn.onclick = function () { ctx.setResponse('ok'); };
        el.appendChild(btn);
      }
    }
  }
});
`;

test('collectShellWalkFindings learn mode does not require check button', async () => {
  const config = buildActivityShellConfig('interactive', {
    activities: [{
      id: 'explore',
      title: 'Explore',
      mode: 'learn',
      visibleSetup: 'Look around.',
      learnerAction: 'Try the controls.',
      controls: ['tap'],
      feedback: 'Explore freely.',
      successCriterion: 'Mark as done when finished.'
    }]
  }, { title: 'Learn fixture', objective: 'Explore.' });
  const html = assembleActivityHtml({ config, stageJs: learnStageJs });
  const dir = mkdtempSync(path.join(tmpdir(), 'shell-qa-learn-'));
  mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const findings = await collectShellWalkFindings(page, 'phone shell walk');
    assert.equal(findings.length, 0, findings.join('; '));
    const mode = await page.evaluate(() => (window as unknown as { __SHELL_QA__?: { currentActivityMode?: string } }).__SHELL_QA__?.currentActivityMode);
    assert.equal(mode, 'learn');
  } finally {
    await browser.close();
  }
});

test('collectShellWalkFindings practice mode flags missing check flow', async () => {
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
  }, { title: 'Broken', objective: 'Test.' });
  const brokenStage = `
    window.registerStage({
      activities: {
        main: {
          createItems: function () { return [{}]; },
          renderItem: function (ctx, item, el) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = 'orphan';
            el.appendChild(b);
          },
          checkAnswer: function () { return { correct: false }; }
        }
      }
    });
  `;
  const html = assembleActivityHtml({ config, stageJs: brokenStage });
  const dir = mkdtempSync(path.join(tmpdir(), 'shell-qa-practice-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const findings = await collectShellWalkFindings(page, 'desktop shell walk');
    assert.ok(findings.some(f => f.includes('Check button stayed disabled') || f.includes('could not click')));
  } finally {
    await browser.close();
  }
});
