const {_electron}=require('../../../mylecture-local-ide/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mylecture-artifact-drawer-'));
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'ide-app.mjs'),'--force-device-scale-factor=1'],env:{...process.env,ML_TEST_DIR:dir,ML_TEST_HIDDEN:'1'}});
 try {
  const page=await app.firstWindow(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('[data-view="create"]').click();
  assert.equal(await page.locator('.ide-left .ide-actions').count(),0);
  assert.equal(await page.locator('.ide-right').getByRole('button',{name:'Resolve',exact:true}).count(),1);
  assert.equal(await page.locator('.ide-right').getByRole('button',{name:'Render',exact:true}).count(),1);
  assert.equal(await page.locator('.artifact-body').isVisible(),false);
  const id=await page.evaluate(async()=>{const l=await ml.lectures.create({title:'Artifact drawer check'}); l.format='lecturegen-1'; l.scenes=[];await ml.lectures.save(l);return l.id;});
  await page.locator('[data-view="study"]').click();await page.locator('[data-view="create"]').click();
  await page.locator('.ide-proj',{hasText:'Artifact drawer check'}).click();
  assert.equal(await page.locator('.artifact-body').isVisible(),false);
  await page.getByRole('button',{name:/Artifacts/}).click();
  assert(await page.locator('.artifact-body').isVisible());
  // Poll through the real job event and backend files as an artifact arrives.
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].webContents.send('ide:job',{projectId:id,type:'generation',state:'running'}),id);
  fs.writeFileSync(path.join(dir,'library',id,'answer.md'),'# Produced explanation\nAn artifact has arrived.');
  await page.locator('.ide-file',{hasText:'answer.md'}).waitFor({timeout:10000});
  await page.locator('.ide-file',{hasText:'answer.md'}).click();
  await page.getByText('An artifact has arrived.',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Artifacts/}).click();
  const grip=page.getByRole('separator',{name:'Resize artifacts'});const b=await grip.boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+3);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y-210,{steps:8});await page.mouse.up();
  assert(await page.locator('.artifact-body').isVisible());
  assert((await page.locator('.artifact-drawer').boundingBox()).height>150);
  await page.screenshot({path:path.join(dir,'expanded.png')});
  await page.getByRole('button',{name:/Artifacts/}).click();
  await page.screenshot({path:path.join(dir,'collapsed.png')});
  assert.deepEqual(errors,[]);console.log('ARTIFACT_DRAWER_OK',dir);
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
