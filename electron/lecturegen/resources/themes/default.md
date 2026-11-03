# Theme

# background color
Solid, dark charcoal matte (#121212). No background grid, solid background.
```css
background: #121212;
```

# font
- family: Lato
```css
font-family: 'Lato', sans-serif;
```
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Geist+Pixel&family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Roboto+Flex:opsz,wght,XOPQ,XTRA,YOPQ,YTDE,YTFI,YTLC,YTUC@8..144,100..1000,96,468,79,-203,738,514,712&display=swap" rel="stylesheet">

# font size
## For landscape aspect ratio  
title/headers: 72px `font-size: 72px;`
subtitle: 52px `font-size: 52px;`
main teaching text: 44px `font-size: 44px;`
labels / notes / table text: 30px `font-size: 30px;`

- For SVG text:
axis labels: 34px `font-size: 34px;`
small crowded labels: 30px `font-size: 30px;`
big emphasis word: 126px `font-size: 126px;`


## more
You can use other fonts if appropriate in certain case.

# margin / safe zone
- Landscape: keep 5% margin all around, no visible border.
- Portrait (9:16, 3:4, etc.): top 10% and bottom 20% must stay empty, 5% margin left/right, no visible border.
```css
:root {
  --safe-top: 10%;
  --safe-bottom: 20%;
  --safe-left: 5%;
  --safe-right: 5%;
}
```

# padding
Most content is drawn on `<canvas>`, which has no box model — `padding`/`gap` as CSS do nothing there. You must compute the inset in pixels yourself and use those numbers directly in your `fillRect`/`fillText`/`arc` coordinates. Do this for every element, every time, before you draw it:

1. Take the element's own box `(x, y, w, h)`.
2. `pad = max(0.05 * Math.min(w, h), 24)`. Content goes inside `(x+pad, y+pad, w-2*pad, h-2*pad)` — never at `(x, y, w, h)` directly.
3. Leave `gap = max(0.03 * canvasWidthOrHeight, 20)` px between sibling boxes (columns, rows, stacked blocks).
4. For text, call `ctx.measureText(str).width` and check it fits inside the content box before you `fillText` — don't assume a font-size "looks fine."
5. After laying everything out, list every element's padded box and check each pair for overlap, and check every box against the safe-zone margins above. If two boxes intersect, or one crosses the safe-zone, resize/move before drawing — don't ship it and hope.

Worked example: a 400×200 card at `(100, 100)` → `pad = max(0.05*200, 24) = 24` → content box is `(124, 124)` to `(476, 276)`.

Fixed values (use as-is, no formula needed):
- Table cells: 12px top/bottom, 16px left/right.
- Icon-to-label gap: 12px.

For real DOM elements (KaTeX overlays, etc.) the same numbers apply as actual CSS:
```css
padding: max(5%, 24px);
gap: max(3%, 20px);
```

When in doubt, add more padding rather than less; cramped or edge-touching elements are a defect.

# math
- Typeset math (matrices, integrals, sums, fractions) with KaTeX — never hand-draw with `ctx.fillText`/`ctx.arc`.
- Render into an absolutely-positioned DOM overlay on top of the canvas; animate it from `renderSection()` via inline styles, not CSS animations.
- Highlight cells/rows with inline `\color{#hex}{...}` in the LaTeX string.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
```
```css
.math-overlay { position: absolute; z-index: 2; color: #fff; pointer-events: none; text-align: center; }
```
```js
katex.render("\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", eq1, { throwOnError: false, displayMode: true });
// inside renderSection(segment, localTime, globalTime):
eq1.style.opacity = Math.min(localTime / 0.8, 1.0);
```
# more
- Don't use AI like neon glow unless very necessary.