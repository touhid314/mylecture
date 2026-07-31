import assert from 'node:assert/strict';
import { invokeRenderSection } from '../packages/lecture-viewer/src/player/invoke-render-section.ts';

type Call = string;

function createWin(hooks: Record<string, () => void> = {}) {
  const calls: Call[] = [];
  const win: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(hooks)) {
    win[name] = (..._args: unknown[]) => {
      calls.push(name);
    };
  }
  return { win, calls };
}

const segment = { id: 'scene1' };

assert.doesNotThrow(() => {
  const { win, calls } = createWin({
    __AI_RENDER_SECTION__: () => {},
    __HTML_RENDER_SECTION__: () => {}
  });
  invokeRenderSection(win, segment, 1, 2);
  assert.deepEqual(calls, ['__AI_RENDER_SECTION__', '__HTML_RENDER_SECTION__']);
});

assert.doesNotThrow(() => {
  const { win, calls } = createWin({
    __RENDER_SECTION__: () => {}
  });
  invokeRenderSection(win, segment, 1, 2);
  assert.deepEqual(calls, ['__RENDER_SECTION__']);
});

assert.doesNotThrow(() => {
  const { win, calls } = createWin({
    __RENDER_SECTION__: () => {},
    __AI_RENDER_SECTION__: () => {},
    __HTML_RENDER_SECTION__: () => {}
  });
  invokeRenderSection(win, segment, 1, 2);
  assert.deepEqual(calls, ['__AI_RENDER_SECTION__', '__HTML_RENDER_SECTION__']);
});

console.log('invoke-render-section.test.ts: ok');
