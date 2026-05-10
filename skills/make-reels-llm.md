Make a video on the topic: how h3 GPS positioning works

Approximate length: 1 minute
Aspect ratio: 9:16 vertical

You are creating a short educational reel as HTML that will be rendered later by this repository's video pipeline. First write the script, then implement the HTML.

## Required Deliverables

Create this folder:

```text
inputs/<topic-slug>/
```

Create these files:

```text
inputs/<topic-slug>/script.md
inputs/<topic-slug>/index.html
inputs/<topic-slug>/description.txt
inputs/<topic-slug>/resolved.html
```

After writing `index.html`, generate `resolved.html` with:

```bash
npm run build:plan -- --input inputs/<topic-slug>/index.html --out inputs/<topic-slug>/resolved.html
```

Do not render the final video. The user will render it later.

## Script Requirements

Before writing HTML, create `script.md` with:

- A scene-by-scene timing plan.
- The exact audio transcript for every narration segment.
- A visual plan for what appears, changes, and disappears in each segment.
- A short note about the core concept being taught and the mental model the viewer should leave with.

Keep the narration around 140 words for a 1 minute video. Shorter is fine if the visual pacing is better. Use plain spoken language.

## Description Requirements

Create `description.txt` with one upload-ready sentence and relevant hashtags for Facebook/Instagram.

Example style:

```text
Bloom filters answer "definitely not" or "maybe" using tiny bit arrays and hash functions. #ComputerScience #DataStructures #Programming #LearnCS
```

## Renderer Contract

The HTML must define both globals:

```js
window.__VIDEO_PLAN__
window.__RENDER_SECTION__
```

The video plan must be an ordered array. Only these segment kinds are allowed:

```js
"visual-only"
"narration+visual"
```

Use `narration+visual` for voiceover segments:

```js
{
  id: "step-01-intro",
  kind: "narration+visual",
  audio: "audio/step-01-intro.wav",
  text: "Exact narration text for this segment."
}
```

The `audio` path must be a relative `.wav` path. If audio files do not exist yet, still include the intended relative paths so the build pipeline can resolve or generate them as configured.

Use `visual-only` only when there is no voiceover:

```js
{
  id: "pause-for-animation",
  kind: "visual-only",
  duration: 3
}
```

Define the render function exactly like this:

```js
function renderSection(segment, localTime, globalTime) {
  // Update the DOM for this exact moment.
}

window.__RENDER_SECTION__ = renderSection;
```

Rules:

- `segment` is the active plan item.
- `localTime` is seconds since the active segment started.
- `globalTime` is seconds since the video start.
- All visual state must be computed from `segment`, `localTime`, and `globalTime`.
- On-screen text must be rendered inside `renderSection` or derived from code.
- Do not use CSS animations or CSS transitions for motion. For exported video, motion must be controlled by `localTime` and `globalTime`.
- The HTML must support `?export=1`.
- In export mode, hide the play overlay and disable CSS animation/transition effects.

## Visual Style To Match

Use the style of the existing examples: `bloomfilter-modifier`, `bsp-tree`, and `cnn-shorts`.

Core look:

- Dark editor-like background: `#1e1e1e`.
- Text color: `#eceff4`.
- Roboto font from Google Fonts.
- Accent palette:
  - Blue `#61AFEF`
  - Green `#98c379`
  - Red `#E06C75`
  - Yellow `#E5C07B`
  - Purple `#C678DD` when a fifth color is needed
  - Node/card background `#282c34`
  - Edge color `#5c6370`
- Strong, readable educational diagrams using SVG, HTML/CSS grids, or simple DOM elements.
- Clean visual metaphors: arrays, grids, trees, arrows, scan lines, status labels, highlighted cells, progress meters.
- Use bold, concise subtitles near the lower safe area.

Safe area:

- Do not place key content in the top 15% or bottom 20%.
- Treat the center 65% as the main safe area for diagrams and important text.
- Keep subtitles above the platform UI area using `--reels-safe-bottom`.

Use this player/container pattern:

```html
<div id="player-container">
  <div id="play-overlay" onclick="startLecture()">
    <button id="play-btn">Play Lecture</button>
  </div>

  <div id="scene1" class="scene active"></div>
  <div id="scene2" class="scene"></div>
  <div id="scene3" class="scene"></div>

  <div id="progress-container">
    <div id="progress-bar"></div>
  </div>
  <div id="subtitle-caption"></div>
</div>
```

Use this base CSS pattern:

```css
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');

:root {
  --bg-color: #1e1e1e;
  --text-color: #eceff4;
  --accent-blue: #61AFEF;
  --accent-green: #98c379;
  --accent-red: #E06C75;
  --accent-yellow: #E5C07B;
  --accent-purple: #C678DD;
  --node-bg: #282c34;
  --edge-color: #5c6370;
}

body {
  margin: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: #000;
  font-family: 'Roboto', sans-serif;
}

body.export-mode *,
body.export-mode *::before,
body.export-mode *::after {
  animation: none !important;
  transition: none !important;
}

body.export-mode #play-overlay {
  display: none !important;
}

#player-container {
  position: relative;
  width: min(100vw, calc(100vh * 9 / 16));
  height: min(100vh, calc(100vw * 16 / 9));
  container-type: size;
  --reels-safe-bottom: clamp(240px, 22cqh, 430px);
  --subtitle-space: clamp(92px, 10cqh, 170px);
  background-color: var(--bg-color);
  color: var(--text-color);
  overflow: hidden;
  box-shadow: 0 0 20px rgba(0,0,0,0.5);
}

.scene {
  position: absolute;
  inset: 0;
  padding: clamp(20px, 5cqw, 64px) clamp(20px, 5cqw, 64px)
    calc(var(--reels-safe-bottom) + var(--subtitle-space));
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  pointer-events: none;
}

.scene.active {
  opacity: 1;
  pointer-events: auto;
}

.title {
  color: var(--accent-blue);
  font-size: clamp(28px, 6.1cqw, 76px);
  font-weight: 900;
  margin-top: clamp(36px, 7cqh, 130px);
  text-align: center;
  border: 3px solid var(--accent-blue);
  padding: clamp(12px, 3cqw, 36px) clamp(18px, 5cqw, 58px);
  background: rgba(97, 175, 239, 0.1);
  border-radius: 12px;
  opacity: 0;
}

.subtitle {
  color: var(--accent-yellow);
  font-size: clamp(20px, 4.4cqw, 54px);
  margin-top: clamp(14px, 4cqh, 64px);
  text-align: center;
  opacity: 0;
}

svg {
  width: 100%;
  height: 58%;
  margin-top: clamp(24px, 5cqh, 90px);
  overflow: visible;
}

.info-box {
  width: min(94%, 960px);
  margin-top: auto;
  margin-bottom: clamp(48px, 9cqh, 170px);
  padding: clamp(18px, 4.2cqw, 54px);
  border: 2px solid #555;
  border-radius: 12px;
  background: #2a2a2a;
  font-size: clamp(20px, 4.5cqw, 54px);
  line-height: 1.28;
  text-align: center;
  opacity: 0;
}

#subtitle-caption {
  position: absolute;
  left: clamp(52px, 8cqw, 110px);
  right: clamp(52px, 8cqw, 110px);
  bottom: calc(var(--reels-safe-bottom) + clamp(18px, 2.4cqh, 42px));
  z-index: 80;
  min-height: clamp(56px, 6cqh, 104px);
  color: #f8fafc;
  font-size: clamp(28px, 4.4cqw, 56px);
  font-weight: 800;
  line-height: 1.12;
  text-align: center;
  text-shadow: 0 3px 9px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1);
  opacity: 0;
  pointer-events: none;
}

#subtitle-caption.visible {
  opacity: 1;
}

#progress-container {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 6px;
  background: #333;
  z-index: 100;
}

#progress-bar {
  height: 100%;
  width: 0%;
  background: var(--accent-blue);
}
```

## Example-Derived Structure

Follow one of these proven patterns depending on the topic:

### Pattern A: Data Structure Explainer

Used by Bloom Filter and BSP Tree examples.

Use 8 short narration segments:

```js
const VIDEO_PLAN = [
  { id: "step-01-intro", kind: "narration+visual", audio: "audio/step-01-intro.wav", text: "Hook the viewer with a real-world problem." },
  { id: "step-02-setup", kind: "narration+visual", audio: "audio/step-02-setup.wav", text: "Define the idea in one simple sentence." },
  { id: "step-03-process-1", kind: "narration+visual", audio: "audio/step-03-process-1.wav", text: "Show the first mechanical step." },
  { id: "step-04-process-2", kind: "narration+visual", audio: "audio/step-04-process-2.wav", text: "Show the second mechanical step." },
  { id: "step-05-search-1", kind: "narration+visual", audio: "audio/step-05-search-1.wav", text: "Show lookup, traversal, or use." },
  { id: "step-06-search-2", kind: "narration+visual", audio: "audio/step-06-search-2.wav", text: "Show why the structure helps." },
  { id: "step-07-search-3", kind: "narration+visual", audio: "audio/step-07-search-3.wav", text: "Show the tradeoff, edge case, or key insight." },
  { id: "step-08-conclusion", kind: "narration+visual", audio: "audio/step-08-conclusion.wav", text: "Recap the value in one punchy line." }
];
```

Visual scenes:

- Scene 1: title, subtitle, real-world hook demo or image.
- Scene 2: main animated diagram.
- Scene 3: summary panel with 4 key takeaways and a progress meter.

For a summary panel, use:

```html
<div id="scene3" class="scene">
  <div class="title" style="opacity: 1;">Summary</div>
  <div class="summary-panel">
    <div id="summary-focus">Topic recap</div>
    <div class="summary-meter"><div id="summary-meter-fill"></div></div>
    <div class="summary-grid">
      <div id="summary-one" class="summary-item">
        <div class="summary-icon">1</div>
        <div class="summary-copy">
          <div class="summary-label text-blue">Key Idea</div>
          <div class="summary-note">Short supporting phrase.</div>
        </div>
      </div>
      <div id="summary-two" class="summary-item">
        <div class="summary-icon">2</div>
        <div class="summary-copy">
          <div class="summary-label text-green">Mechanism</div>
          <div class="summary-note">Short supporting phrase.</div>
        </div>
      </div>
      <div id="summary-three" class="summary-item">
        <div class="summary-icon">3</div>
        <div class="summary-copy">
          <div class="summary-label text-red">Tradeoff</div>
          <div class="summary-note">Short supporting phrase.</div>
        </div>
      </div>
      <div id="summary-four" class="summary-item">
        <div class="summary-icon">4</div>
        <div class="summary-copy">
          <div class="summary-label text-yellow">Use Case</div>
          <div class="summary-note">Short supporting phrase.</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

Use this summary CSS:

```css
.summary-panel {
  width: min(92%, 900px);
  margin-top: clamp(28px, 5cqh, 88px);
  display: grid;
  gap: clamp(18px, 3cqh, 34px);
}

#summary-focus {
  min-height: clamp(86px, 9cqh, 142px);
  display: grid;
  place-items: center;
  padding: clamp(14px, 2.6cqw, 30px);
  border: 2px solid rgba(97, 175, 239, 0.42);
  border-radius: 10px;
  background: rgba(17, 24, 32, 0.86);
  color: #f8fafc;
  font-size: clamp(28px, 5cqw, 60px);
  font-weight: 800;
  line-height: 1.08;
  text-align: center;
  text-shadow: 0 3px 8px rgba(0,0,0,0.65);
}

.summary-meter {
  height: clamp(10px, 1.5cqh, 18px);
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
  overflow: hidden;
}

#summary-meter-fill {
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent-blue), var(--accent-green), var(--accent-yellow));
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(12px, 2cqh, 24px);
}

.summary-item {
  display: grid;
  grid-template-columns: clamp(46px, 6.4cqw, 70px) 1fr;
  gap: clamp(10px, 2cqw, 20px);
  align-items: center;
  min-height: clamp(74px, 8cqh, 118px);
  padding: clamp(12px, 2.3cqw, 24px);
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 10px;
  background: rgba(36, 43, 53, 0.72);
  opacity: 0.36;
  transform: translateX(-22px) scale(0.96);
}

.summary-item.active {
  opacity: 1;
  transform: translateX(0) scale(1.03);
  border-color: var(--accent-blue);
  background: rgba(97, 175, 239, 0.16);
  box-shadow: 0 0 22px rgba(97, 175, 239, 0.2);
}

.summary-item.done {
  opacity: 0.82;
  transform: translateX(0) scale(1);
  border-color: rgba(152, 195, 121, 0.5);
  background: rgba(152, 195, 121, 0.1);
}

.summary-icon {
  display: grid;
  place-items: center;
  width: clamp(46px, 6.4cqw, 70px);
  height: clamp(46px, 6.4cqw, 70px);
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  font-size: clamp(24px, 4cqw, 44px);
}

.summary-label {
  font-size: clamp(20px, 3.2cqw, 36px);
  font-weight: 800;
  line-height: 1.05;
}

.summary-note {
  color: #cbd5e1;
  font-size: clamp(15px, 2.35cqw, 26px);
  line-height: 1.12;
}
```

### Pattern B: Machine Learning / Math Pipeline

Used by CNN Shorts.

Use 5 short narration segments:

```js
const VIDEO_PLAN = [
  { id: "step-01-intro", kind: "narration+visual", audio: "audio/step-01-intro.wav", text: "Hook with a familiar real-world question." },
  { id: "step-02-numbers", kind: "narration+visual", audio: "audio/step-02-numbers.wav", text: "Convert the problem into numbers or primitives." },
  { id: "step-03-transform", kind: "narration+visual", audio: "audio/step-03-transform.wav", text: "Show the main operation sliding, folding, mapping, or combining." },
  { id: "step-04-compress", kind: "narration+visual", audio: "audio/step-04-compress.wav", text: "Show the simplification, selection, or next stage." },
  { id: "step-05-conclusion", kind: "narration+visual", audio: "audio/step-05-conclusion.wav", text: "Stack the steps into the big idea." }
];
```

Visual scenes:

- Scene 1: phone/image/object hook.
- Scene 2: convert to a grid of numbers.
- Scene 3: show a moving filter/window/operation.
- Scene 4: show reduction/compression.
- Scene 5: stack layers or final result.

Use DOM/SVG grids generated by JavaScript when that is cleaner than hand-writing every cell. Use IDs on generated cells so `renderSection` can update fill, opacity, text, and position.

## Reusable JavaScript Helpers

Include helpers like these:

```js
function byId(id) {
  return document.getElementById(id);
}

function setOpacity(id, value) {
  const el = byId(id);
  if (!el) return;
  el.style.opacity = String(value);
  el.classList.toggle('visible', Number(value) > 0.01);
}

function switchScene(sceneId) {
  document.querySelectorAll('.scene').forEach(scene => {
    scene.classList.remove('active');
    scene.style.opacity = "0";
  });

  const scene = byId(sceneId);
  if (!scene) return;
  scene.classList.add('active');
  scene.style.opacity = "1";
}

function estimateSegmentDuration(segment) {
  if (Number.isFinite(Number(segment.resolvedDuration))) return Number(segment.resolvedDuration);
  if (Number.isFinite(Number(segment.duration))) return Number(segment.duration);
  const words = String(segment.text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2.5, words / 2.65);
}

function setProgress(index, localTime, globalTime) {
  let progress = 0;

  if (Number.isFinite(globalTime) && Number.isFinite(window.__VIDEO_DURATION__) && window.__VIDEO_DURATION__ > 0) {
    progress = globalTime / window.__VIDEO_DURATION__;
  } else {
    let elapsed = 0;
    let total = 0;
    for (let i = 0; i < VIDEO_PLAN.length; i++) {
      const duration = estimateSegmentDuration(VIDEO_PLAN[i]);
      total += duration;
      if (i < index) elapsed += duration;
      else if (i === index) elapsed += Math.min(Math.max(localTime, 0), duration);
    }
    progress = total > 0 ? elapsed / total : 0;
  }

  byId("progress-bar").style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
}
```

Use subtitle cue maps like this:

```js
const SUBTITLE_CUES = {
  "step-01-intro": [
    [0, "First subtitle line"],
    [2.8, "Second subtitle line"]
  ],
  "step-02-setup": [
    [0, "Another readable subtitle"]
  ]
};

function subtitleTextFor(segment, localTime) {
  const cues = SUBTITLE_CUES[segment.id] || [[0, String(segment.text || "")]];
  let text = cues[0][1];
  for (const [start, cueText] of cues) {
    if (localTime >= start) text = cueText;
    else break;
  }
  return text;
}

function showSubtitle(segment, localTime) {
  const subtitle = byId("subtitle-caption");
  if (!subtitle) return;
  const text = subtitleTextFor(segment, localTime);
  subtitle.textContent = text;
  subtitle.style.opacity = text ? "1" : "0";
  subtitle.classList.toggle("visible", Boolean(text));
}
```

In `renderSection`, reset all state first, then apply the current segment state. This makes every frame deterministic:

```js
function resetVisualState() {
  byId("play-overlay").style.display = "none";
  switchScene("scene1");
  setOpacity("subtitle-caption", 0);
  // Hide or reset every visual element that may have changed.
}

function renderSection(segment, localTime, globalTime = NaN) {
  const index = Math.max(0, VIDEO_PLAN.findIndex(item => item.id === segment.id));
  resetVisualState();
  setProgress(index, localTime, globalTime);
  showSubtitle(segment, localTime);

  switch (segment.id) {
    case "step-01-intro":
      switchScene("scene1");
      // Compute intro state from localTime.
      break;
    case "step-02-setup":
      switchScene("scene2");
      // Compute setup state from localTime.
      break;
    case "step-08-conclusion":
      switchScene("scene3");
      // Compute summary state from localTime.
      break;
  }
}
```

Enable export mode:

```js
const params = new URLSearchParams(window.location.search);
if (params.get("export") === "1") {
  document.body.classList.add("export-mode");
}

document.addEventListener("DOMContentLoaded", () => {
  renderSection(VIDEO_PLAN[0], 0, 0);
});
```

Include a simple `startLecture()` only for manual browser preview. It does not need perfect timing; the renderer uses `window.__VIDEO_PLAN__` and `window.__RENDER_SECTION__`.

## Visual Quality Rules

- Make the first 2 seconds visually specific. Show a real-world hook, not only a title.
- Use diagrams that demonstrate the mechanism, not decorative graphics.
- Keep on-screen text short. The narration carries explanation; the screen carries structure and motion.
- Use `clamp()` with container query units (`cqw`, `cqh`) for readable text at 1080x1920.
- Do not let subtitles overlap the main diagram.
- Use a progress bar at the bottom.
- Use status text for key moments like "definitely not", "back-to-front", "feature detected", "collision", or "compressed".
- If an external image helps explain the topic, download it into the topic folder and reference it with a relative path. Use only relevant images that make the concept clearer.
- Prefer SVG for algorithm diagrams because it scales cleanly.
- Keep all IDs unique.
- Avoid CSS-only animation. Set `opacity`, `transform`, SVG attributes, text, and class names from `renderSection`.
- Ensure the page works when opened directly and when opened with `?export=1`.

## Final Checklist

Before finishing:

- `script.md` exists and includes exact narration plus visual timing.
- `index.html` defines `window.__VIDEO_PLAN__`.
- `index.html` defines `window.__RENDER_SECTION__`.
- Every narration segment has `kind: "narration+visual"`, `audio`, and `text`.
- Every visual-only segment has positive `duration`.
- `?export=1` hides the overlay and disables animations/transitions.
- Important content avoids the top 15% and bottom 20%.
- Subtitles are readable and stay above the bottom safe area.
- `description.txt` exists.
- `resolved.html` has been generated with `npm run build:plan`.
