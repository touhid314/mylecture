# Axis positioning (mandatory for scaled diagrams)

Use this guide whenever a lecture visual maps **numeric or ordered values** to pixel positions: number lines, graph axes, timelines, fraction bars, thermometers, etc.

Read this before writing ticks, arrows, jumps, highlights, or draggable markers on the same axis.

## Core rule

**One axis mapper per axis. One formula. Many call sites.**

Define the value→pixel mapping once. Every tick, label, arrow tip, jump arc endpoint, and highlight on that axis must call the same mapper. Never duplicate the math in a second helper with a different offset.

## The failure mode to avoid

A common bug: ticks are positioned relative to a **container**, while SVG paths are drawn in an **SVG coordinate system** that is already offset inside that container — but both formulas still add the container inset.

```js
// BAD — double offset in SVG (arrows land between tick marks)
tick.style.left = `${((v + 10) / 12) * 1440 + 40}px`;   // container coords
const x = ((v + 10) / 12) * 1440 + 40;                   // used inside <svg style="left:40px">
```

The fix is not “subtract 40 by hand.” The fix is **one mapper** with explicit container vs SVG methods.

## Shared helper (copy into index HTML)

```js
/**
 * Linear axis mapper. Create one per horizontal or vertical axis.
 *
 * @param {object} opts
 * @param {number} opts.min       Domain minimum (e.g. -10)
 * @param {number} opts.max       Domain maximum (e.g. 2)
 * @param {number} opts.spanPx    Pixel length of the axis line (not including inset)
 * @param {number} [opts.containerInsetPx=0]  Padding from container edge to axis origin
 */
function createLinearAxis({ min, max, spanPx, containerInsetPx = 0 }) {
  const range = max - min;
  if (!Number.isFinite(range) || range === 0) {
    throw new Error('createLinearAxis: min and max must differ');
  }

  function valueToPx(v) {
    return ((v - min) / range) * spanPx;
  }

  return {
    min,
    max,
    spanPx,
    containerInsetPx,
    valueToPx,
    /** Position along the axis inside the container (for DOM `left` / `top`). */
    containerX(v) {
      return valueToPx(v) + containerInsetPx;
    },
    /**
     * Position inside an SVG child of the same container.
     * Use when the <svg> already has `left` (or `top`) = containerInsetPx.
     * Do NOT add containerInsetPx again.
     */
    svgX(v) {
      return valueToPx(v);
    },
    /** Quadratic jump arc from one value to another (number-line hops, etc.). */
    jumpArcPath(fromVal, toVal, baselineY, arcHeight, progress) {
      const x1 = this.svgX(fromVal);
      const x2 = this.svgX(toVal);
      const currentX = x1 + (x2 - x1) * progress;
      const midX = (x1 + currentX) / 2;
      let d = `M ${x1} ${baselineY}`;
      if (progress > 0) {
        d += ` Q ${midX} ${baselineY - arcHeight * 1.5 * progress} ${currentX} ${baselineY}`;
      }
      return d;
    },
  };
}
```

For a **vertical** axis, use the same pattern with `containerY` / `svgY` and `top` instead of `left`.

## Usage pattern

```js
const INSET = 40;
const SPAN = 1440;
const axis = createLinearAxis({ min: -10, max: 2, spanPx: SPAN, containerInsetPx: INSET });

// Build ticks (DOM children of the axis container)
for (let v = -10; v <= 2; v++) {
  tick.style.left = `${axis.containerX(v)}px`;
}

// SVG overlay (svg.style.left is already INSET)
path.setAttribute('d', axis.jumpArcPath(0, -3, 120, 60, progress));
path.setAttribute('d', axis.jumpArcPath(-3, -6, 120, 60, progress));
path.setAttribute('d', axis.jumpArcPath(-6, -9, 120, 60, progress));
```

## Checklist before finishing HTML

1. Is there exactly **one** `createLinearAxis` (or equivalent) per axis?
2. Do ticks and overlays call **only** that mapper — no inline `((v - min) / range) * span` elsewhere?
3. For SVG children already inset in the container, are you using `svgX` / `valueToPx` — **not** `containerX`?
4. Do arrow tips, jump endpoints, and highlighted values use the **same** domain values shown in labels and narration?

If any answer is no, refactor before claiming the lecture is done.

## When this guide does not apply

- Purely decorative motion with no semantic value (fade, slide title)
- Diagrams positioned by fixed layout grids with no shared numeric scale
- Practice activities — follow `src/coursegen/prompts/interactive-practice.md` and practice repair rules for endpoint precision there too
