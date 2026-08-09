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

For narration-backed segments, `segment.resolvedDuration` is the authoritative duration when present. Generated phase/progress helpers must accept the active `segment` and prefer its positive finite `resolvedDuration`; per-segment duration hints may be used only while previewing unresolved source. This keeps visual progress aligned with the final narration without changing audio timestamps or segment boundaries.

Adjacent beats in the same script scene are continuous by default. The next beat's state at `localTime = 0` must preserve the preceding beat's terminal camera and persistent-object state. A transient object that ends at the boundary must be carried into the next beat and faded during roughly its first 8–12%, rather than being reset from visible to hidden in one frame. An instantaneous reset is allowed only when the script explicitly requires one or the next beat begins a new scene.

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

## Authoring rules for temporal layout validation

This section documents the authoring rules and thresholds relevant to temporal layout validation. It does not enumerate every internal heuristic, finding cap, or implementation exception in the validator.

Layouts must remain valid throughout motion. The validator samples a bounded set of render states at segment **start and end** (settled poses), and (when budget permits) additional times in the **settled tail** of each segment (last quarter). Mid-transition samples with partial-alpha **non-text** canvas ink skip overlap checks only; padding and safe-zone checks still run. Layout findings are **deduped by signature** (including quantized geometry) across segments and sample times (one message per distinct collision/padding issue). At every sampled state, layout must satisfy the rules below.

### Validator-enforced thresholds

- **Viewport safe-zone:** Keep visible text boxes away from viewport edges. Theme guidance recommends at least 5% of `min(viewportWidth, viewportHeight)` on each edge. The validator hard-fails only when the **measured** text axis-aligned box extends outside the viewport (small float tolerance). DOM text boxes are collected after viewport and ancestor clipping, so this check primarily catches **canvas text** drawn off-screen; on-screen DOM text flush to the edge does not hard-fail. Portrait theme files may request stricter top/bottom margins in theme guidance; those are theme recommendations, not this validator's threshold.
- **Panel text inset (non-table):** Text inside a containing panel requires inset of at least `max(5% of min(panel width, panel height), 24px)` on every side, measured in the browser after scaling. Inset/protrusion slack is 10% of the required pad for that side. Panel padding violations under 12px net (after slack) are not reported by the validator.
- **Table cell padding:** Table cells require at least 16px horizontal and 12px vertical padding.
- **Material overlap:** The validator flags merged canvas/DOM collisions when overlap is at least 24px wide × 12px high and at least 28% of the smaller box. Opaque DOM panels participate as overlap material (not padding-only). Avoid unintended material overlap. Intentional nesting is allowed only when the smaller box is at least 85% contained and the larger is at least 1.4× the smaller area, or when DOM parentage contains the child. Material overlaps that clear the noise floor fail unless they match a named geometric exemption (stroke-on-fill, matching fill pair, intentional nest, canvas panel under text). Detection uses axis-aligned bounding boxes only (no z-order); overlapping layers may be flagged even when one is visually behind another.
- **Stroke-on-fill exemption:** A `strokeRect` border on a matching `fillRect`/`fill` card is not treated as material overlap when the path rectangles align within half the stroke's screen-space `lineWidth` (plus a small float epsilon). Offset same-size pairs beyond that stroke half-width are still flagged.
- **Matching fill pair exemption:** Same-path `fillRect`/`fill` double-draws (e.g. wash + solid) are not treated as competing material overlap.
- **Canvas panel under text:** A canvas panel recorded via `fillRect`/`fill`/`strokeRect` may sit behind canvas or DOM text when at least 85% of the text axis-aligned box is geometrically inside the canvas panel (DOM parentage is not required). Panel padding and safe-zone rules still apply.

### Implementation recommendations (not independently validated)

These practices help meet the contract but are not separately asserted as validator rules:

- **Canvas-attached labels** share the shape's canvas transform (`translate` / `scale`); independent informational text stays in the DOM.
- Use `box-sizing: border-box`, shared geometry constants (e.g. `SCENE_LAYOUT`), and JS-calculated scaled padding rather than hardcoded pixel insets on large cards.
- Avoid placing a competing opaque canvas fill behind an HTML text card of similar size; prefer intentional panel nesting. A canvas panel behind DOM text with ≥85% geometric containment (text AABB mostly inside the panel) is allowed.
