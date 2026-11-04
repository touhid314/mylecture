import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApiEngine } from '../electron/engines/api.js';
import { withEngine } from '../electron/lecturegen/run.js';

test('pipeline bridge forwards image files and extracted document reference without changing the stage', async () => {
  const attachments = [{ name: 'lesson.docx', path: 'lesson.docx', mime: 'application/msword', text: 'Reference fact: 42.' }];
  let received;
  const result = await withEngine({ engine: { generate: async request => { received = request; return { text: 'Answer' }; } }, signal: new AbortController().signal, attachments }, () => globalThis.__ML_LLM__.generate({ system: 'Original stage', user: 'Question', purpose: 'lecturegen_answer_generator' }));
  assert.equal(result, 'Answer');
  assert.equal(received.system, 'Original stage');
  assert.match(received.user, /Reference fact: 42/);
  assert.match(received.user, /untrusted/);
  assert.equal(received.attachments, attachments);
});

test('Gemini and LiteLLM receive actual image data along with the user message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-image-transport-'));
  const file = path.join(dir, 'pixel.png');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZXsAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(file, bytes);
  const original = globalThis.fetch;
  try {
    for (const provider of ['gemini', 'compatible']) {
      let body;
      globalThis.fetch = async (_url, opts) => {
        body = JSON.parse(opts.body);
        const payload = provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'Visible image' }] } }] } : { choices: [{ delta: { content: 'Visible image' } }] };
        return new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      };
      const engine = makeApiEngine(() => ({ provider, baseUrl: 'https://test.invalid/v1', apiKey: 'test', model: 'vision-model' }));
      const result = await engine.generate({ system: 'Describe', user: 'What is this?', attachments: [{ name: 'pixel.png', path: file, mime: 'image/png' }], onDelta() {} });
      assert.equal(result.text, 'Visible image');
      if (provider === 'gemini') {
        assert.equal(body.contents[0].parts[0].text, 'What is this?');
        assert.equal(body.contents[0].parts[1].inlineData.data, bytes.toString('base64'));
      } else {
        assert.equal(body.messages[1].content[0].text, 'What is this?');
        assert.equal(body.messages[1].content[1].image_url.url, `data:image/png;base64,${bytes.toString('base64')}`);
      }
    }
  } finally { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
});
