import {app} from 'electron';
import fs from 'node:fs';
app.on('before-quit', e => e.preventDefault());
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) console.log('RENDERER_ERROR',message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const until = Date.now() + 20000;
        while (!document.querySelector('.engine-pill .usage-details summary')?.textContent.includes('%')) {
          if (Date.now() > until) throw new Error('Usage bar did not load: ' + document.querySelector('.usage-details')?.textContent);
          await new Promise(r => setTimeout(r, 100));
        }
        if (document.querySelector('.usage-bar')) throw new Error('Top bar still exists'); const details = document.querySelector('.engine-pill .usage-details'); if (!details) throw new Error('Usage not in model description'); details.querySelector('summary').click(); if (!details.open) throw new Error('did not open'); details.querySelector('.usage-popover button[aria-label="Close usage details"]').click(); if (details.open) throw new Error('X did not close'); details.querySelector('summary').click(); document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); if (details.open) throw new Error('outside click did not close'); details.querySelector('summary').click(); if (!document.getElementById('view-study').classList.contains('active')) throw new Error('Usage click opened settings');
        await new Promise(r => setTimeout(r, 3000));
        const panel = document.querySelector('.usage-popover').getBoundingClientRect();
        if (panel.right > innerWidth || panel.bottom > innerHeight) throw new Error('Panel overflow');
        const bars = document.querySelectorAll('.usage-bucket progress');
        if (bars.length < 2) throw new Error('Missing limit bars');
        return {summary: document.querySelector('.usage-details summary').textContent, bars: bars.length, resetTimes: document.querySelector('.usage-body').textContent.includes('Resets')};
      })()`);
      fs.writeFileSync('tests/scratch/usage-compact.png', (await win.webContents.capturePage()).toPNG());
      console.log('USAGE_UI_OK', JSON.stringify(result)); app.exit(0);
    } catch(e) { console.error(e); app.exit(1); }
  });
});
await import('../../electron/main.js');

