// Read-only native CLI catalogs through the real Electron IPC and sidebar.
// No user inference prompt is sent. All settings are isolated in a temp folder.
const { _electron } = require('../../../mylecture-local-ide/node_modules/playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mylecture-native-catalogs-'));
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'ide-app.mjs'), '--force-device-scale-factor=1'], env: { ...process.env, ML_TEST_DIR: dir, ML_TEST_HIDDEN: '1' } });
  try {
    const page = await app.firstWindow();
    // Exercise the visible-tab polling branch without displaying a test window.
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('[data-view="create"]').click();
    assert.equal(await page.locator('.ide-controls button[title="Closed captions"]').count(), 0);
    await page.getByRole('button', { name: 'Agent model settings', exact: true }).click();
    const provider = page.getByLabel('Agent provider', { exact: true });
    const model = page.getByLabel('Agent model', { exact: true });
    const effort = page.getByLabel('Thinking level', { exact: true });
    const ready = async source => page.waitForFunction(source => {
      const text = document.querySelector('.agent-model-status').textContent;
      return text.includes(source) && !text.includes('Checking');
    }, source);
    await provider.selectOption('claude-code');
    await ready('Claude Code initialize');
    const claude = await page.evaluate(() => ml.engines.models('claude-code'));
    assert(claude.length > 4);
    const capable = claude.find(m => m.efforts.includes('xhigh'));
    await model.selectOption(capable.id === 'default' ? '' : capable.id);
    await page.waitForFunction(() => [...document.querySelector('[aria-label="Thinking level"]').options].some(o => o.value === 'xhigh'));
    await effort.selectOption('xhigh');
    await page.waitForFunction(async () => (await ml.settings.get()).codexEffort === 'xhigh');
    assert.deepEqual(await effort.locator('option').evaluateAll(nodes => nodes.map(n => n.value).filter(Boolean)), capable.efforts);
    const noEffort = claude.find(m => m.efforts.length === 0);
    if (noEffort) {
      await model.selectOption(noEffort.id);
      await page.waitForFunction(() => document.querySelector('[aria-label="Thinking level"]').disabled);
      assert.equal(await effort.inputValue(), '');
    }
    // Canonical provider IDs keep the alias's actual reported capabilities.
    await model.selectOption('__custom');
    await page.getByLabel('Custom model ID', { exact: true }).fill(capable.resolvedModel);
    await page.getByLabel('Custom model ID', { exact: true }).press('Tab');
    await page.waitForFunction(() => !document.querySelector('[aria-label="Thinking level"]').disabled);
    await effort.selectOption('max');
    await page.waitForFunction(async () => (await ml.settings.get()).codexEffort === 'max');
    console.log('CLAUDE_NATIVE_OK', claude.length, capable.efforts);
    await provider.selectOption('codex');
    await ready('Codex app-server model/list');
    const codex = await page.evaluate(() => ml.engines.models('codex'));
    const defaultModel = codex.find(m => m.isDefault);
    assert((await page.getByRole('button', { name: 'Agent model settings', exact: true }).textContent()).includes(defaultModel.label));
    await page.screenshot({ path: path.join(dir, 'provider-and-default-model.png') });
    await model.selectOption(codex[0].id);
    await page.waitForFunction(() => [...document.querySelector('[aria-label="Thinking level"]').options].some(o => o.value === 'ultra'));
    console.log('CODEX_NATIVE_OK', codex.length, codex[0].efforts);
    await provider.selectOption('antigravity');
    await ready('Antigravity CLI models');
    const agy = await page.evaluate(() => ml.engines.models('antigravity'));
    const variant = agy.find(m => m.effortVariants.length > 1);
    await model.selectOption(variant.id);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Thinking level"]').disabled);
    const levels = await effort.locator('option').evaluateAll(nodes => nodes.map(n => n.value));
    assert.deepEqual(levels, variant.efforts);
    const next = variant.effortVariants.at(-1);
    await effort.selectOption(next.level);
    await page.waitForFunction(async expected => (await ml.settings.get()).models.antigravity === expected, next.model);
    console.log('AGY_NATIVE_OK', agy.length, levels);
    const status = page.locator('.agent-model-status');
    const before = await status.textContent();
    await new Promise(r => setTimeout(r, 1100));
    await page.getByRole('button', { name: 'Refresh provider models', exact: true }).click();
    await page.waitForFunction(before => {
      const text = document.querySelector('.agent-model-status').textContent;
      return text.includes('Antigravity CLI models') && text !== before;
    }, before);
    const manual = await status.textContent();
    console.log('MANUAL_REFRESH_OK', manual);
    await page.screenshot({ path: path.join(dir, 'native-model-picker.png') });
    // Leave the real 60-second polling timer running without any interaction.
    await page.waitForFunction(previous => {
      const text = document.querySelector('.agent-model-status').textContent;
      return text.includes('Antigravity CLI models') && text !== previous;
    }, manual, { timeout: 70000 });
    console.log('AUTOMATIC_POLL_OK', await status.textContent());
    assert.deepEqual(errors, []);
    console.log('NATIVE_PROVIDER_POLLING_OK', dir);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
