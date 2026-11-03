// Visual and interaction checks for the single-agent panel, with isolated data.
const { _electron } = require('../../../mylecture-local-ide/node_modules/playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mylecture-agent-theme-'));
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'ide-app.mjs'), '--force-device-scale-factor=1'], env: { ...process.env, ML_TEST_DIR: dir, ML_TEST_HIDDEN: '1' } });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));
    await page.locator('[data-view="create"]').click();
    await page.getByText('What will you teach?', { exact: true }).waitFor();
    const durations = await page.getByRole('slider', { name: 'Target video length', exact: true }).evaluate(el => {
      const values = [];
      for (let i = Number(el.min); i <= Number(el.max); i++) {
        el.value = String(i); el.dispatchEvent(new Event('input', { bubbles: true }));
        values.push(el.parentElement.querySelector('.input').value);
      }
      el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true }));
      return values;
    });
    assert.deepEqual(durations, ['0:15','0:30','0:45','1:00','2:00','3:00','4:00','5:00','6:00','7:00','8:00','9:00','10:00']);
    await page.screenshot({ path: path.join(dir, 'empty.png') });
    await page.getByRole('button', { name: 'Explain a concept', exact: true }).click();
    assert.equal(await page.locator('.ide-input').inputValue(), 'Create a video explaining ');
    assert.equal(await page.locator('.agent-box .agent-video-selects select').count(), 4);
    assert.equal(await page.locator('.ide-center .p-bar button[title="Captions (C)"]').getAttribute('class'), '');
    await page.getByLabel('Video aspect', { exact: true }).selectOption('9:16');
    await page.getByLabel('Video theme', { exact: true }).selectOption('hand-drawn');
    await page.waitForFunction(async () => (await ml.settings.get()).lgTheme === 'hand-drawn');
    const voiceIds = await page.getByLabel('Video voice', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(n => n.value));
    assert(!voiceIds.some(v => v.startsWith('system:')));
    assert(voiceIds.some(v => v.startsWith('kokoro:')) && voiceIds.some(v => v.startsWith('omnivoice:')));
    assert.equal(await page.getByLabel('Video theme', { exact: true }).inputValue(), 'hand-drawn');
    await page.screenshot({ path: path.join(dir, 'options.png') });
    await page.getByRole('button', { name: 'Agent model settings', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.agent-model-options').isVisible(), false);
    await page.getByRole('button', { name: 'Agent model settings', exact: true }).click();
    await page.locator('.ide-right-head').click();
    assert.equal(await page.locator('.agent-model-options').isVisible(), false);
    // Exercise the real IPC listeners with presentation-only status events.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.webContents.send('ide:job', { projectId: 'theme-preview', type: 'generation', state: 'running' });
      w.webContents.send('ide:log', { text: 'Writing the explanation…' });
      w.webContents.send('ide:log', { text: 'Animating scene 1…' });
      w.webContents.send('ide:log', { text: 'Scene 1 validated.', kind: 'done' });
    });
    await page.locator('.agent-status.working').waitFor();
    await page.screenshot({ path: path.join(dir, 'working.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('ide:job', { projectId: 'theme-preview', state: 'idle' }));
    await page.waitForFunction(() => !document.querySelector('.agent-work').open);
    await page.locator('.agent-work summary').click();
    assert(await page.getByText('Animating scene 1…', { exact: true }).isVisible());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 640));
    await page.screenshot({ path: path.join(dir, 'compact.png') });
    assert(await page.locator('.agent-send:not(.agent-stop)').isVisible());
    assert(await page.getByLabel('Video voice', { exact: true }).isVisible());
    const boxes = await page.locator('.agent-video-selects select').evaluateAll(nodes => nodes.map(n => ({ top: n.getBoundingClientRect().top, right: n.getBoundingClientRect().right })));
    assert(boxes.every(b => Math.abs(b.top - boxes[0].top) < 1), 'All four selectors must be in a single row');
    assert(boxes.at(-1).right <= await page.locator('.agent-box').evaluate(n => n.getBoundingClientRect().right));
    await page.evaluate(() => document.body.classList.add('light'));
    await page.screenshot({ path: path.join(dir, 'light.png') });
    assert.deepEqual(errors, []);
    console.log('AGENT_THEME_OK', dir);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
