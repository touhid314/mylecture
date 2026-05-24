# HTML Video Renderer

HTML-to-video renderer with synchronized audio support and a local preview viewer.

The renderer takes a contract-compliant HTML input file, resolves narration durations through TTS when needed, captures browser frames with Playwright, and muxes synchronized audio with ffmpeg.

## Project Layout

```text
docs/       Renderer usage and HTML input contract
inputs/     Renderer-ready inputs for manual/inference renders
scripts/    Node.js build and render CLIs
skills/     Local workflow notes for generating renderer inputs
tests/      Structured renderer fixtures and smoke tests
tools/      Python support utilities, including TTS
.render/    Temporary render artifacts
```

## Main Commands

```bash
npm run render:video
npm run render:video -- --html tests/fixtures/input-contract-test/index.html --out tests/fixtures/input-contract-test/rendered.mp4
npm run build:plan -- --input tests/fixtures/input-contract-test/index.html --out tests/fixtures/input-contract-test/resolved.html
npm run view -- --file inputs/bloomfilter/resolved.html
npm run view -- --file inputs/dijkstras-algorithm/index.html --open
npm test
```

## HTML Contract

Source HTML should follow the v0.1 contract:

```js
window.__VIDEO_METADATA__ = {
  contractVersion: "0.1",
  title: "Dijkstra's Algorithm Explained",
  aspectRatio: "16:9"
};

window.__VIDEO_PLAN__ = [/* visual-only, narration+visual, interactive, or game segments */];
window.__RENDER_SECTION__ = function renderSection(segment, localTime, globalTime) {};
```

The resolver writes a generated `lastResolved` timestamp into `window.__VIDEO_METADATA__` in resolved HTML. See [HTML input contract v0.1](docs/html-input-contract-v0_1.md).

## Preview Viewer

Renderer-friendly source HTML is deterministic but not always auto-playable. Use the local viewer to play, pause, and scrub either source or resolved render HTML:

```bash
npm run view
npm run view -- --file inputs/bloomfilter/resolved.html
```

Resolved files preview with the real timeline and audio cues. Source files without a resolved timeline use estimated narration durations for visual preview.

Viewer features:

- `Load` opens a Windows file picker for HTML files inside this repo.
- The preview aspect ratio is detected from `window.__VIDEO_METADATA__.aspectRatio` when available.
- The aspect-ratio dropdown can still override the detected preview size.
- `Info` shows video metadata, formatted `lastResolved` time when present, and viewer version. The viewer version is currently `0.1`.
- `Subtitles` toggles viewer-owned subtitles derived from narration `text`.
- `Live TTS` is enabled by default and uses Chrome Web Speech only when a narration segment has no usable audio file.
- Click the time bar or use the 5-second buttons to seek.

## Rendering

Render the visual-only Three.js fixture:

```bash
npm run render:visual-3d
```

Render it at 4K and 120 fps:

```bash
npm run render:video -- --html tests/fixtures/visual-only-3d-test/index.html --out tests/fixtures/visual-only-3d-test/rendered-4k-120fps.mp4 --width 3840 --height 2160 --fps 120
```

Run the low-resolution narration benchmark:

```bash
npm run test:narration
```

## Docs

- [HTML input contract](docs/html-input-contract-v0_1.md)
- [Rendering guide](docs/rendering.md)
