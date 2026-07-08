import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  aggregatePersistentOverflow,
  collectVideoFrameFindings,
  evaluateVideoFrameMetrics,
  formatVideoFrameFindings,
  isContentBearingElement,
  mergeBestVideoFrameMetrics,
  probeTimesForSegmentDuration
} from './video-frame-qa.ts';

function box(
  left: number,
  top: number,
  right: number,
  bottom: number,
  content = true
) {
  return { left, top, right, bottom, visible: true, content };
}

function contractScript(renderLogic: string, duration = 4) {
  return `<script>
window.__VIDEO_PLAN__ = [{ id: 'main', kind: 'visual-only', duration: ${duration} }];
window.__RENDER_SECTION__ = function(segment, localTime, globalTime) {
  ${renderLogic}
};
document.addEventListener('DOMContentLoaded', function() {
  window.__RENDER_SECTION__(window.__VIDEO_PLAN__[0], 0, 0);
});
</script>`;
}

test('isContentBearingElement distinguishes media, text, and empty wrappers', () => {
  assert.equal(isContentBearingElement('DIV', false, 1, ''), false);
  assert.equal(isContentBearingElement('P', true, 0, 'Hello'), true);
  assert.equal(isContentBearingElement('IMG', false, 0, ''), true);
});

test('probeTimesForSegmentDuration clamps to segment duration', () => {
  assert.deepEqual(probeTimesForSegmentDuration(1), [0.5, 1]);
  assert.ok(probeTimesForSegmentDuration(4).includes(2));
});

test('evaluateVideoFrameMetrics passes full-viewport content', () => {
  const metrics = evaluateVideoFrameMetrics(1920, 1080, [box(0, 0, 1920, 1080)]);
  assert.equal(metrics.fillsFrame, true);
  assert.equal(metrics.noVisibleContent, false);
  assert.equal(metrics.hasHorizontalOverflow, false);
  assert.equal(metrics.hasVerticalOverflow, false);
});

test('evaluateVideoFrameMetrics passes tall centered column when only one axis is narrow', () => {
  const metrics = evaluateVideoFrameMetrics(1920, 1080, [box(432, 81, 1488, 999)]);
  assert.equal(metrics.fillsFrame, true);
  assert.equal(
    formatVideoFrameFindings(metrics, 'index.html').some(f => f.includes('letterboxed')),
    false
  );
});

test('evaluateVideoFrameMetrics ignores decorative wrappers without content', () => {
  const metrics = evaluateVideoFrameMetrics(1920, 1080, [
    box(0, 0, 1920, 1080, false),
    box(760, 430, 1160, 650, true)
  ]);
  assert.equal(metrics.fillsFrame, false);
  assert.equal(metrics.noVisibleContent, false);
});

test('evaluateVideoFrameMetrics passes sparse content inside a full-viewport container', () => {
  const metrics = evaluateVideoFrameMetrics(1920, 1080, [
    { ...box(0, 0, 1920, 1080, false), container: true },
    box(660, 300, 1260, 480, true)
  ]);
  assert.equal(metrics.fillsFrame, true);
  assert.equal(
    formatVideoFrameFindings(metrics, 'index.html').some(f => f.includes('letterboxed')),
    false
  );
});

test('evaluateVideoFrameMetrics fails sparse content when its container is also small', () => {
  const metrics = evaluateVideoFrameMetrics(1920, 1080, [
    { ...box(320, 180, 1320, 742, false), container: true },
    box(660, 300, 1260, 480, true)
  ]);
  assert.equal(metrics.fillsFrame, false);
});

test('evaluateVideoFrameMetrics reports no visible content when content boxes are empty', () => {
  const metrics = evaluateVideoFrameMetrics(1920, 1080, [box(0, 0, 100, 100, false)]);
  assert.equal(metrics.noVisibleContent, true);
  const findings = formatVideoFrameFindings(metrics, 'index.html');
  assert.ok(findings.some(f => f.includes('no visible content')));
});

test('evaluateVideoFrameMetrics fails letterboxed stage and overflow', () => {
  const metrics = evaluateVideoFrameMetrics(1920, 1080, [
    box(320, 180, 1600, 900),
    box(-20, 100, 100, 200, false),
    box(1900, 100, 1940, 200, false),
    box(100, 1090, 200, 1120, false)
  ]);
  assert.equal(metrics.fillsFrame, false);
  assert.equal(metrics.hasHorizontalOverflow, true);
  assert.equal(metrics.hasVerticalOverflow, true);
  const findings = formatVideoFrameFindings(metrics, 'index.html');
  assert.equal(findings.length, 3);
  assert.ok(findings.some(f => f.includes('letterboxed on both axes')));
});

test('aggregatePersistentOverflow requires overflow at every probe', () => {
  assert.deepEqual(
    aggregatePersistentOverflow([
      { hasHorizontalOverflow: true, hasVerticalOverflow: false },
      { hasHorizontalOverflow: false, hasVerticalOverflow: false }
    ]),
    { hasHorizontalOverflow: false, hasVerticalOverflow: false }
  );
  assert.deepEqual(
    aggregatePersistentOverflow([
      { hasHorizontalOverflow: true, hasVerticalOverflow: false },
      { hasHorizontalOverflow: true, hasVerticalOverflow: false }
    ]),
    { hasHorizontalOverflow: true, hasVerticalOverflow: false }
  );
});

test('mergeBestVideoFrameMetrics prefers higher coverage', () => {
  const worse = evaluateVideoFrameMetrics(1920, 1080, [box(760, 430, 1160, 650)]);
  const better = evaluateVideoFrameMetrics(1920, 1080, [box(0, 0, 1920, 1080)]);
  const merged = mergeBestVideoFrameMetrics(worse, better);
  assert.equal(merged.fillsFrame, true);
});

test('collectVideoFrameFindings passes full viewport and fade-in fixtures with contract', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'video-frame-qa-'));
  const passHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; background: #123456; }
#stage { opacity: 0; }
</style></head>
<body><div id="stage">Full frame lesson</div>
${contractScript("var stage = document.getElementById('stage'); if (stage) stage.style.opacity = '1';")}
</body></html>`;
  const fadeHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; background: #123456; }
#stage { opacity: 0; }
</style></head>
<body><div id="stage">Fade in lesson</div>
${contractScript("var stage = document.getElementById('stage'); if (stage) stage.style.opacity = localTime >= 0.5 ? '1' : '0';")}
</body></html>`;
  const sparseHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 100vw; height: 100vh; }
#stage { width: 100vw; height: 100vh; background: #111; position: relative; }
#header { position: absolute; top: 20px; left: 30px; color: #888; }
#expr { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%); color: #fff; font-size: 72px; }
</style></head>
<body><div id="stage"><div id="header">ALGEBRA</div><div id="expr">6 - 2 (-4)</div></div>
${contractScript("")}
</body></html>`;
  const passPath = path.join(dir, 'pass.html');
  const fadePath = path.join(dir, 'fade.html');
  const sparsePath = path.join(dir, 'sparse.html');
  writeFileSync(passPath, passHtml, 'utf8');
  writeFileSync(fadePath, fadeHtml, 'utf8');
  writeFileSync(sparsePath, sparseHtml, 'utf8');

  assert.equal((await collectVideoFrameFindings([passPath], { width: 1920, height: 1080 })).length, 0);
  assert.equal((await collectVideoFrameFindings([fadePath], { width: 1920, height: 1080 })).length, 0);
  assert.deepEqual(await collectVideoFrameFindings([sparsePath], { width: 1920, height: 1080 }), []);
});

test('collectVideoFrameFindings flags literal entities and overlapping text', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'video-frame-qa-'));
  const defectHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; }
.expr { position: absolute; top: 200px; left: 400px; font-size: 60px; }
</style></head>
<body><div id="stage">
<div class="expr" id="a">12 ÷ (-3)</div>
<div class="expr" id="b">6 + 2</div>
<div style="position:absolute;top:500px;left:400px;font-size:40px" id="c"></div>
</div>
${contractScript("document.getElementById('c').innerText = '&divide; (-3)';")}
</body></html>`;
  const cleanHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; }
</style></head>
<body><div id="stage"><div style="position:absolute;top:200px;left:200px">12 \u00f7 (-3) = -4</div><div style="position:absolute;top:400px;left:200px">Positive \u00f7 Negative = Negative</div></div>
${contractScript("")}
</body></html>`;
  const defectPath = path.join(dir, 'text-defects.html');
  const cleanPath = path.join(dir, 'clean-text.html');
  writeFileSync(defectPath, defectHtml, 'utf8');
  writeFileSync(cleanPath, cleanHtml, 'utf8');

  const findings = await collectVideoFrameFindings([defectPath], { width: 1920, height: 1080 });
  assert.ok(findings.some(f => f.includes('literal HTML entity')));
  assert.ok(findings.some(f => f.includes('overlapping text elements')));

  assert.deepEqual(await collectVideoFrameFindings([cleanPath], { width: 1920, height: 1080 }), []);
});

test('collectVideoFrameFindings catches defects in later segments', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'video-frame-qa-'));
  const midDefectHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; }
#stray { position: absolute; top: 200px; left: -60px; width: 100px; height: 40px; background: teal; display: none; }
</style></head>
<body><div id="stage">Lesson text<div id="stray"></div></div>
<script>
window.__VIDEO_PLAN__ = [
  { id: 's1', kind: 'visual-only', duration: 3 },
  { id: 's2', kind: 'visual-only', duration: 3 }
];
window.__RENDER_SECTION__ = function(segment, localTime, globalTime) {
  document.getElementById('stray').style.display = segment.id === 's2' ? 'block' : 'none';
};
document.addEventListener('DOMContentLoaded', function() {
  window.__RENDER_SECTION__(window.__VIDEO_PLAN__[0], 0, 0);
});
</script>
</body></html>`;
  const midPath = path.join(dir, 'mid-defect.html');
  writeFileSync(midPath, midDefectHtml, 'utf8');

  const findings = await collectVideoFrameFindings([midPath], { width: 1920, height: 1080 });
  assert.ok(findings.some(f => f.includes('horizontal overflow')));
});

test('collectVideoFrameFindings flags stateful seek/replay content loss', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'video-frame-qa-'));
  // Segment 2 empties a span that segment 1's render never rebuilds, so
  // seeking back to segment 1 loses the "-4" — the node-05 bug shape.
  const statefulHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; }
#expr { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); font-size: 72px; }
</style></head>
<body><div id="stage"><div id="expr"><span id="lead">6 - 2 x (</span><span id="neg4">-4</span><span id="close">)</span></div></div>
<script>
window.__VIDEO_PLAN__ = [
  { id: 's1', kind: 'visual-only', duration: 3 },
  { id: 's2', kind: 'visual-only', duration: 3 }
];
window.__RENDER_SECTION__ = function(segment, localTime, globalTime) {
  if (segment.id === 's2' && localTime >= 1) {
    document.getElementById('neg4').innerHTML = '';
  }
};
document.addEventListener('DOMContentLoaded', function() {
  window.__RENDER_SECTION__(window.__VIDEO_PLAN__[0], 0, 0);
});
</script>
</body></html>`;
  const statefulPath = path.join(dir, 'stateful-seek.html');
  writeFileSync(statefulPath, statefulHtml, 'utf8');

  const findings = await collectVideoFrameFindings([statefulPath], { width: 1920, height: 1080 });
  assert.ok(findings.some(f => f.includes('seek/replay is stateful')));
});

test('collectVideoFrameFindings fails letterboxed, overflow, and wrapper-masked stages', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'video-frame-qa-'));
  const failHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 100vw; height: 100vh; background: #000; display: flex; align-items: center; justify-content: center; }
#stage { width: 1280px; height: 720px; background: #fff; position: relative; overflow: visible; }
#clip { position: absolute; left: 1610px; width: 200px; height: 40px; background: red; }
</style></head>
<body><div id="stage">Lesson<div id="clip"></div></div>
${contractScript("var stage = document.getElementById('stage'); if (stage) stage.style.opacity = '1';")}
</body></html>`;
  const wrapperHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 100vw; height: 100vh; }
#wrapper { width: 100vw; height: 100vh; background: #000; display: flex; align-items: center; justify-content: center; }
#stage { width: 480px; height: 270px; background: #fff; }
</style></head>
<body><div id="wrapper"><div id="stage">Small lesson</div></div>
${contractScript("var stage = document.getElementById('stage'); if (stage) stage.style.opacity = '1';")}
</body></html>`;
  const transientOverflowHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; }
#flyer { position: absolute; top: 100px; width: 120px; height: 40px; background: red; }
</style></head>
<body><div id="stage">Slide lesson<div id="flyer"></div></div>
${contractScript("var flyer = document.getElementById('flyer'); if (flyer) flyer.style.left = (localTime < 1 ? '2000' : '100') + 'px';")}
</body></html>`;
  const persistentOverflowHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body, #stage { margin: 0; width: 100vw; height: 100vh; }
#flyer { position: absolute; top: 100px; left: 2000px; width: 120px; height: 40px; background: red; }
</style></head>
<body><div id="stage">Overflow lesson<div id="flyer"></div></div>
${contractScript("")}
</body></html>`;
  const failPath = path.join(dir, 'fail.html');
  const wrapperPath = path.join(dir, 'wrapper.html');
  const transientPath = path.join(dir, 'transient.html');
  const persistentPath = path.join(dir, 'persistent.html');
  writeFileSync(failPath, failHtml, 'utf8');
  writeFileSync(wrapperPath, wrapperHtml, 'utf8');
  writeFileSync(transientPath, transientOverflowHtml, 'utf8');
  writeFileSync(persistentPath, persistentOverflowHtml, 'utf8');

  const failFindings = await collectVideoFrameFindings([failPath], { width: 1920, height: 1080 });
  assert.ok(failFindings.some(f => f.includes('letterboxed on both axes')));
  assert.ok(failFindings.some(f => f.includes('horizontal overflow')));

  const wrapperFindings = await collectVideoFrameFindings([wrapperPath], { width: 1920, height: 1080 });
  assert.ok(wrapperFindings.some(f => f.includes('letterboxed on both axes')));

  const transientFindings = await collectVideoFrameFindings([transientPath], { width: 1920, height: 1080 });
  assert.equal(transientFindings.some(f => f.includes('overflow')), false);

  const persistentFindings = await collectVideoFrameFindings([persistentPath], { width: 1920, height: 1080 });
  assert.ok(persistentFindings.some(f => f.includes('horizontal overflow')));
});
