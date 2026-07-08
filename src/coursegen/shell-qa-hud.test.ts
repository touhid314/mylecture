import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { analyzeStageHudText, collectStageHudFindings } from './shell-qa.ts';

test('analyzeStageHudText flags duplicate score HUD text', () => {
  assert.ok(analyzeStageHudText('Score: 0 / 100'));
  assert.ok(analyzeStageHudText('Goal: reach 70 / 100'));
});

test('analyzeStageHudText ignores math fractions without HUD keywords', () => {
  assert.equal(analyzeStageHudText('Simplify 3/4 before solving.'), null);
});

test('analyzeStageHudText ignores long instructional goal prose', () => {
  assert.equal(
    analyzeStageHudText('Goal: get 4 of 5 correct in this longer instructional paragraph about practicing.'),
    null
  );
});

test('collectStageHudFindings detects stage score bar in shell walk area', async () => {
  const html = `<!DOCTYPE html>
<html data-shell-version="1">
<head><meta charset="utf-8"><title>HUD fixture</title></head>
<body>
  <div id="shell-stage-inner"><div class="stage-score">Score: 0 / 100</div></div>
</body>
</html>`;
  const dir = mkdtempSync(path.join(tmpdir(), 'shell-hud-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    const findings = await collectStageHudFindings(page, 'desktop shell walk');
    assert.ok(findings.some(f => f.includes('[stage-fixable]')));
  } finally {
    await browser.close();
  }
});

test('collectStageHudFindings detects game-hud class in stage', async () => {
  const html = `<!DOCTYPE html>
<html data-shell-version="1">
<head><meta charset="utf-8"><title>HUD class fixture</title></head>
<body>
  <div id="shell-stage-inner"><div class="game-hud"><span>Timer</span></div></div>
</body>
</html>`;
  const dir = mkdtempSync(path.join(tmpdir(), 'shell-hud-class-'));
  const htmlPath = path.join(dir, 'index.html');
  writeFileSync(htmlPath, html, 'utf8');
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    const findings = await collectStageHudFindings(page, 'desktop shell walk');
    assert.ok(findings.some(f => f.includes('game-hud')));
  } finally {
    await browser.close();
  }
});
