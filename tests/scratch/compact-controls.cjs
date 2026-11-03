const { _electron } = require('../../../mylecture-local-ide/node_modules/playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mylecture-compact-controls-'));
(async () => {
 const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'ide-app.mjs'), '--force-device-scale-factor=1'], env: {...process.env, ML_TEST_DIR: dir, ML_TEST_HIDDEN:'1'} });
 try {
  const page = await app.firstWindow(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.locator('[data-view="create"]').click();
  await page.getByRole('button',{name:'Choose provider',exact:true}).click();
  await page.locator('.menu').getByRole('button',{name:'Codex',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.agent-model-name').textContent.includes('GPT'));
  await page.getByRole('button',{name:'Choose model',exact:true}).click();
  assert(await page.locator('.menu').getByRole('button',{name:'GPT-6.1-Sol',exact:true}).isVisible());
  await page.locator('.menu').getByRole('button',{name:'GPT-6.1-Sol',exact:true}).click();
  await page.getByRole('button',{name:'Choose reasoning effort',exact:true}).click();
  await page.locator('.menu').getByRole('button',{name:'High',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.agent-thinking').textContent==='High');
  assert.equal(await page.locator('.agent-model-options').isVisible(),false);
  await page.getByRole('button',{name:'Choose voice',exact:true}).click();
  assert.equal(await page.locator('.voice-menu-row').count(),16);
  assert.equal(await page.locator('.voice-menu-row .voice-demo').count(),16);
  assert(!(await page.locator('.voice-menu').textContent()).includes('Windows'));
  const previous=await page.evaluate(()=>ml.settings.get());
  await page.getByRole('button',{name:'Play Heart (US, female) demo',exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('.voice-demo:disabled'));
  await page.waitForFunction(()=>!document.querySelector('.voice-demo:disabled'),{}, {timeout:90000});
  const current=await page.evaluate(()=>ml.settings.get());
  assert.equal(current.voiceEngine,previous.voiceEngine); assert.equal(current.voice,previous.voice);
  await page.locator('.voice-menu').getByRole('menuitem',{name:'Maruf',exact:true}).click();
  await page.waitForFunction(async()=> (await ml.settings.get()).omnivoiceVoice==='maruf' && (await ml.settings.get()).voiceEngine==='omnivoice');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,640));
  const rects=await page.locator('.agent-video-selects > *').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().top));
  assert(rects.every(v=>Math.abs(v-rects[0])<1));
  await page.screenshot({path:path.join(dir,'compact.png')});
  await page.locator('[data-view="settings"]').click();
  assert.equal(await page.getByRole('button',{name:'Windows voice',exact:true}).count(),0);
  assert.deepEqual(errors,[]); console.log('COMPACT_CONTROLS_OK',dir);
 } finally { await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
