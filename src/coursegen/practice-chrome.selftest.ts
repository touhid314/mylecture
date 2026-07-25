/**
 * Self-check for practice chrome CSS parse + injection.
 * Run: node --import tsx src/coursegen/practice-chrome.selftest.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  PRACTICE_CHROME_STYLE_ID,
  collectInlineCssParseFindings,
  ensurePracticeChromeStyles
} from './practice-chrome.ts';

const LECTURE5_BUG_CSS = `
.switch-container {
  display: flex;
  align-items: center;
  cursor: pointer;

.switch-label {
  font-size: 16px;
}

.btn {
  font-size: 16px;
}
`;

const BALANCED_CSS = `
.switch-container {
  display: flex;
  cursor: pointer;
}
.btn {
  font-size: 16px;
}
`;

function assertUnbalancedFindings() {
  const html = `<!doctype html><html><head><style>${LECTURE5_BUG_CSS}</style></head><body></body></html>`;
  const findings = collectInlineCssParseFindings(html);
  assert.ok(findings.length > 0, 'expected non-empty findings for unbalanced CSS');
  assert.match(findings[0], /unclosed CSS block/);
  console.log('PASS 1: unbalanced CSS → findings non-empty');
  console.log(`  ${findings[0]}`);
}

function assertBalancedFindings() {
  const html = `<!doctype html><html><head><style>${BALANCED_CSS}</style></head><body></body></html>`;
  const findings = collectInlineCssParseFindings(html);
  assert.deepEqual(findings, [], 'expected empty findings for balanced CSS');
  console.log('PASS 2: balanced CSS → empty findings');
}

function assertEnsureChromeIdempotent() {
  const dir = mkdtempSync(path.join(tmpdir(), 'practice-chrome-'));
  const htmlPath = path.join(dir, 'index.html');
  try {
    writeFileSync(
      htmlPath,
      `<!doctype html><html><head><style>${LECTURE5_BUG_CSS}</style></head><body><button class="btn">Reset Outlier Position</button></body></html>`,
      'utf8'
    );
    const changed1 = ensurePracticeChromeStyles(htmlPath);
    assert.equal(changed1, true, 'first ensure should modify file');
    const after1 = readFileSync(htmlPath, 'utf8');
    assert.ok(
      after1.includes(`id="${PRACTICE_CHROME_STYLE_ID}"`),
      'chrome style id missing after ensure'
    );
    assert.ok(after1.includes('font-size: 16px !important'), 'chrome CSS missing');

    const changed2 = ensurePracticeChromeStyles(htmlPath);
    assert.equal(changed2, false, 'second ensure should be idempotent');
    const after2 = readFileSync(htmlPath, 'utf8');
    assert.equal(after2, after1, 'idempotent ensure must not rewrite content');
    console.log('PASS 3: ensurePracticeChromeStyles injects chrome and is idempotent');
    return htmlPath;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function assertPlaywrightFontSize(htmlPath: string) {
  // htmlPath is the temp file from assertEnsureChromeIdempotent; we own cleanup.
  const dir = path.dirname(htmlPath);
  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 30000 });
    const fontSize = await page.evaluate(() => {
      const btn = document.querySelector('button.btn');
      if (!btn) return null;
      return getComputedStyle(btn).fontSize;
    });
    assert.equal(fontSize, '16px', `expected button.btn computed fontSize 16px, got ${fontSize}`);
    console.log('PASS 4: Playwright smoke — button.btn computed fontSize is 16px');
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  assertUnbalancedFindings();
  assertBalancedFindings();
  const htmlPath = assertEnsureChromeIdempotent();
  await assertPlaywrightFontSize(htmlPath);
  console.log('\nAll practice-chrome self-tests passed.');
}

main().catch(error => {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
