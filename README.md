# HTML Video Renderer

General HTML-to-video renderer with synchronized audio support.

The renderer takes an HTML input file, resolves narration durations through TTS when needed, captures browser frames with Playwright, and muxes synchronized audio with ffmpeg.

## Project Layout

```text
docs/       Renderer usage and HTML input contract
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
npm test
```

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
