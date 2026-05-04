# HTML Video Renderer

HTML-to-video renderer with synchronized audio support.

The renderer takes an HTML input file, resolves narration durations through TTS when needed, captures browser frames with Playwright, and muxes synchronized audio with ffmpeg.

## Project Layout

```text
docs/       Renderer usage and HTML input contract
inputs/     Renderer-ready inputs for manual/inference renders
scripts/    Node.js build and render CLIs
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
npm test
```

## Preview Viewer

Renderer-friendly source HTML is deterministic but not always auto-playable. Use the local viewer to play, pause, and scrub either source or resolved render HTML:

```bash
npm run view
npm run view -- --file inputs/bloomfilter/resolved.html
```

Resolved files preview with the real timeline and audio cues. Source files without a resolved timeline use estimated narration durations for visual preview.

In the viewer, `Load` opens a Windows file picker for HTML files inside this repo. Click the time bar or use the time box to jump to a specific timestamp such as `75`, `1:15`, or `0:01:15`.

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

- [HTML input contract](docs/html-input-contract.md)
- [Rendering guide](docs/rendering.md)
