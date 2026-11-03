// Production Electron UI + generator + original answer/script prompt stages.
// Model output is deliberately stubbed to isolate streaming, persistence and
// cancellation. This is not an end-to-end model-quality or video-generation test.
const { _electron } = require('../../../mylecture-local-ide/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mylecture-study-answer-'));
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'study-app.mjs'), '--force-device-scale-factor=1'], cwd: root, env: { ...process.env, ML_TEST_DIR: dir } });
  try {
    const page = await app.firstWindow();
    await page.locator('#view-study .composer textarea').waitFor();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(async () => {
      await ml.settings.set({ engine: 'antigravity', length: 'deep', voiceEngine: 'system' });
      window.studyTestEvents = [];
      ml.gen.onEvent(ev => window.studyTestEvents.push(ev));
    });
    assert.equal(await page.locator('#view-study [title="Lesson length"]').count(), 0);
    assert.equal(await page.locator('#view-study .composer-bar .seg').count(), 0);
    for (const [question, expected] of [['What is 2 + 2?', '4.'], ['Explain multiplication in detail', 'Multiplication combines equal groups.']]) {
      await page.locator('#view-study .composer textarea').fill(question);
      await page.locator('#view-study .send-btn').click();
      await page.waitForFunction(() => window.studyTestEvents.some(ev => ev.type === 'answer' && ev.done));
      const answer = page.locator('.study-answer').last();
      assert((await answer.textContent()).startsWith(expected));
      assert(await answer.isVisible());
      assert.equal(await page.locator('.lec-card .player').last().isVisible(), false);
      const events = await page.evaluate(() => window.studyTestEvents);
      const id = events.find(ev => ev.type === 'started').lectureId;
      const job = events.find(ev => ev.type === 'started').jobId;
      assert(events.filter(ev => ev.type === 'answer').length >= 3, 'Both token chunks and completion must be emitted');
      const saved = await page.evaluate(id => ml.lectures.get(id), id);
      assert.equal(saved.length, null, 'Study must ignore the saved 5-minute preference');
      assert((saved.answer || '').startsWith(expected));
      await page.screenshot({ path: path.join(dir, question.startsWith('What') ? 'short-answer.png' : 'long-answer.png') });
      await page.evaluate(id => ml.gen.cancel(id), job);
      await page.waitForFunction(() => window.studyTestEvents.some(ev => ev.type === 'done'), {}, { timeout: 20000 });
      const kept = await page.evaluate(id => ml.lectures.get(id), id);
      assert.equal(kept.answer, saved.answer, 'Answer survives stopped visual generation');
      await page.evaluate(() => { window.studyTestEvents = []; });
    }
    const calls = await app.evaluate(() => globalThis.studyTestCalls);
    const answerCalls = calls.filter(c => c.system.includes('# Study conversation'));
    assert.equal(answerCalls.length, 2);
    assert(answerCalls[1].user.includes('User: What is 2 + 2?\nTutor: 4.'));
    assert(answerCalls.every(c => !c.user.includes('Requested Length:')));
    // Reopening the saved session restores both answer blocks without any model call.
    const sessions = await page.evaluate(() => ml.sessions.list());
    await page.locator('#view-study .sessions .sess').first().click();
    assert.equal(await page.locator('.study-answer:visible').count(), 2);
    assert.deepEqual(errors, []);
    console.log('STUDY_ANSWER_WORKFLOW_OK', JSON.stringify({ dir, sessions: sessions.length, answers: 2, modelOutputsStubbed: true }));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
