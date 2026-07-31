# HTML Input Contract - v0.2
Rules for source HTML files accepted by the renderer pipeline. 

## Required Globals
The HTML must define:

```js
window.__VIDEO_METADATA__
window.__VIDEO_PLAN__
window.__RENDER_SECTION__
```

## Video Metadata

Source HTML must define exactly these fields:

```js
window.__VIDEO_METADATA__ = {
  contractVersion: "x.y",
  title: "<a suitable title for the video>",
  aspectRatio: "a:b"
};
```

Rules:
Get contractVersion from the top of this file.
aspectRatio must be a string such as "9:16", "16:9", etc.

## Segment Kinds
Only these segment kinds are allowed:

```js
"visual-only"
"narration+visual"
```

1. `visual-only`
Use for a segment with visuals and no voiceover.

Allowed fields:

```js
{
  id: "unique-id",
  kind: "visual-only",
  duration: 6
}
```

Rules:

```text
duration must be a positive number in seconds
```

2. `narration+visual`

Use for a segment with visuals and voiceover.

Allowed fields:

```js
{
  id: "unique-id",
  kind: "narration+visual",
  audio: "audio/unique-id.wav",
  text: "Narration text."
}
```

Rules:

```text
text is the narration script
audio must be a relative .wav path
```


## Video Plan

The plan must be an ordered array.

Example plan:

```js
const VIDEO_PLAN = [
  {
    id: "intro",
    kind: "narration+visual",
    audio: "audio/intro.wav",
    text: "Today we will learn the idea."
  },
  {
    id: "animation-only",
    kind: "visual-only",
    duration: 6
  },
  {
    id: "observation",
    kind: "narration+visual",
    audio: "audio/observation.wav",
    text: "As you can see, the pattern is clear."
  }
];

window.__VIDEO_PLAN__ = VIDEO_PLAN;
```

## Render Function

The HTML must define at least one render hook. Legacy pages use a single unified function:

```js
function renderSection(segment, localTime, globalTime) {
  // update the DOM for this exact moment
}

window.__RENDER_SECTION__ = renderSection;
```

### Split canvas + HTML hooks (recommended for mixed layouts)

When a scene combines canvas motion with HTML overlays, define separate hooks and a shared layout object:

```js
const SCENE_LAYOUT = { /* stage coordinates shared by canvas and DOM */ };

function renderCanvasSection(segment, localTime, globalTime) {
  // clear canvas, draw diagrams/particles only
}

function renderHtmlSection(segment, localTime, globalTime) {
  // overlay visibility, typography, KaTeX containers, table highlights
}

function renderSection(segment, localTime, globalTime) {
  renderCanvasSection(segment, localTime, globalTime);
  renderHtmlSection(segment, localTime, globalTime);
}

window.__RENDER_SECTION__ = renderSection;
window.__AI_RENDER_SECTION__ = renderCanvasSection;
window.__HTML_RENDER_SECTION__ = renderHtmlSection;
```

The player calls both split hooks when both exist (canvas first, then HTML). If only `__RENDER_SECTION__` is defined, that single hook runs instead.

Each `index*.html` file is loaded standalone in the browser. Copy every `draw*` / `render*` / `update*` helper into the file that calls it — helpers from earlier `index*.html` files are not in scope.

Do not run a wall-clock `requestAnimationFrame` preview loop when `window.__PLAYER_CONTROLLED__` is true (the lecture viewer drives frames).

Rules:

```text
segment is the active plan item
localTime is seconds since the active segment started
globalTime is seconds since video start
all visual state must be computed from segment, localTime, and globalTime
on-screen text must be rendered inside this function or derived from code, not segment title/subtitle/caption fields
do not use CSS animations or CSS transitions for motion
all motion must be computed from localTime/globalTime inside this function
```

## Export Mode

The HTML must support:

```text
?export=1
```

## Canvas and DOM Text Alignment

Two classes of text:

1. **Attached text** — a short label, title, or value that belongs to a canvas-drawn shape and moves, scales, or floats with it (e.g. a title on a drawn book cover, a value inside a drawn card). Draw it on the canvas with `ctx.fillText` inside the same `ctx.translate` / `ctx.scale` transform as the shape, so both share one coordinate system.
2. **Independent text** — scene titles, key terms, equations, and annotations placed independently of any canvas shape. Render as HTML/DOM elements. Math always uses KaTeX DOM overlays, never canvas.

If an HTML element must align with a canvas-drawn shape, compute its position every frame inside `__RENDER_SECTION__` or `__HTML_RENDER_SECTION__` from the same geometry constants used to draw the shape in `__AI_RENDER_SECTION__`. Never use independent hard-coded CSS offsets, and never use a different transform origin than the tracked shape.
