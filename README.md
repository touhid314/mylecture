# HTML Video Renderer

HTML-to-video renderer with synchronized audio support and a local preview viewer.

The renderer takes a contract-compliant HTML input file, resolves narration durations through TTS when needed, captures browser frames with Playwright, and muxes synchronized audio with ffmpeg.

## Project Layout

```text
docs/       Renderer usage and HTML input contract
outputs/    Renderer-ready generated videos and HTML outputs
scripts/    Node.js build and render CLIs
skills/     Local workflow notes for generating renderer-ready HTML
tests/      Structured renderer fixtures and smoke tests
tools/      Python support utilities, including TTS
.render/    Temporary render artifacts
```

## Requirements

- Node.js dependencies from `npm install`.
- Python dependencies for local Kokoro CUDA TTS:

```bash
python -m pip install misaki[en] onnxruntime-gpu scipy numpy huggingface_hub
```

- Kokoro ONNX model files are not committed. Download the required full-quality model, tokenizer, and voices:

```bash
python -c "from huggingface_hub import snapshot_download; snapshot_download('onnx-community/Kokoro-82M-v1.0-ONNX', local_dir='models/kokoro-onnx', allow_patterns=['onnx/model.onnx','voices/*','tokenizer.json'])"
```

## Main Commands

```bash
npm run render:video
npm run render:video -- --html tests/fixtures/input-contract-test/index.html --out tests/fixtures/input-contract-test/rendered.mp4
npm run build:plan -- --input tests/fixtures/input-contract-test/index.html --out tests/fixtures/input-contract-test/resolved.html
npm run view -- --file outputs/bloomfilter/resolved.html
npm run view -- --file outputs/dijkstras-algorithm/index.html --open
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

The resolver writes a generated `lastResolved` timestamp into `window.__VIDEO_METADATA__` in resolved HTML. See [HTML input contract v0.1](docs/html-input-contract.md).

## Preview Viewer

Renderer-friendly source HTML is deterministic but not always auto-playable. Use the local viewer to play, pause, and scrub either source or resolved render HTML:

```bash
npm run view
npm run view -- --file outputs/bloomfilter/resolved.html
```

Resolved files preview with the real timeline and audio cues. Source files without a resolved timeline use estimated narration durations for visual preview.

Viewer features:

- `Load` opens a Windows file picker for HTML files inside this repo.
- The preview aspect ratio is detected from `window.__VIDEO_METADATA__.aspectRatio` when available.
- The aspect-ratio dropdown can still override the detected preview size.
- `Info` shows video metadata, formatted `lastResolved` time when present, and IDE version. The IDE version is currently `0.2`.
- `Subtitles` toggles viewer-owned subtitles derived from narration `text`.
- `Live TTS` is enabled by default and uses Chrome Web Speech only when a narration segment has no usable audio file.
- Click the time bar or use the 5-second buttons to seek.

The reusable playback engine lives in `packages/lecture-viewer/src/player/index.mjs`.
Host UIs can import `createLecturePlayer()` and provide their own controls around an iframe:

```js
import { createLecturePlayer } from './packages/lecture-viewer/src/player/index.mjs';

const player = createLecturePlayer({
  iframe: document.querySelector('iframe'),
  resolveSrc: src => src
});

await player.load('/lesson.html?export=1&viewer=1');
player.play();
player.seek(12.5);
```

The local viewer is now one host UI around that player core; server-only behavior such as `/pick`, `/files`, and `/viewer-state` stays in `scripts/viewer-server.mjs`.

## Rendering

Render the current standalone HTML file to MP4:

```bash
npm run render:video
```

Useful options:

```bash
npm run render:video -- --html tests/fixtures/input-contract-test/index.html --out output.mp4 --fps 60 --width 1080 --height 1920
npm run render:video -- --max-frames 60 --out .render/test.mp4 --keep-frames
npm test
```

For plan-source HTML, pass the source file directly:

```bash
npm run render:video -- --html tests/fixtures/gemini-gen/index.html --out tests/fixtures/gemini-gen/rendered.mp4
```

If the file exposes `window.__VIDEO_PLAN__` and does not already contain `window.__RESOLVED_TIMELINE__`, the renderer automatically builds a sibling `resolved.html` first, then renders that. The original `index.html` is not modified.

Speed defaults:

- Frames are written as JPEG at quality `90`.
- Frame rendering uses parallel Playwright pages equal to the logical CPU core count by default.
- Source HTML auto-build uses Kokoro voice `af_heart` at speed `1`.
- Video renders default to vertical 1080p: `1080x1920` at `60` fps.

Override them when needed:

```bash
npm run render:video -- --workers 8 --jpeg-quality 85
npm run render:video -- --frame-format png --workers 1
npm run render:video -- --video-codec libx264 --x264-preset ultrafast
```

Use PNG only when you need lossless intermediate frames; it is much slower.

Choose a TTS voice when rendering plan-source HTML:

```bash
npm run render:video -- --html outputs/power-analysis-attack/index.html --out .render/inference/power-analysis-attack-afheart.mp4 --tts-voice af_heart --force-audio
```

Use `--force-audio` when changing voices; otherwise existing narration files are reused.

Encoding defaults:

- `--video-codec auto` tries hardware H.264 encoders first when ffmpeg exposes them, then falls back to `libx264`.
- Hardware encoder order is `h264_nvenc`, `h264_qsv`, `h264_amf`, then `libx264`.
- `--x264-preset veryfast` is used when the selected encoder is `libx264`.
- Browser capture launches Chromium with GPU/compositor-friendly flags where available.

Benchmark commands:

```bash
npm run benchmark:480p
npm run benchmark:1080p
```

The renderer logs frame-rendering time, effective capture fps, audio mix time, selected video encoder, video encode time, and total command time. If 1080p renders are slow, tune `--workers`; on screenshot-heavy pages, the fastest value can be lower than the logical CPU count.

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

The build tool generates narration audio, measures real durations, and writes the final render timeline. The old segment kind names `visual` and `narration` are still accepted as aliases, but new files should use `visual-only` and `narration+visual`.

A complete working one-shot fixture is available at:

```text
tests/fixtures/plan-pipeline/full-working-example.html
```

It starts with `narration+visual`, then says "Now let's look at this animation," runs a `visual-only` animation, and resumes with "As you can see...". Use that file as a complete source shape reference.

Build and render the fixture:

```bash
npm run build:fixture -- --force-audio
npm run render:fixture
```

The fixture source is `tests/fixtures/plan-pipeline/source.html`; the built renderable file is `tests/fixtures/plan-pipeline/index.html`. You can still run `build:fixture` manually, but `render:video` now auto-builds plan-source files by default.

The renderer uses the page as the source of truth:

- Visual frames come from `window.renderAt(timeSeconds)`.
- Total duration comes from `window.__VIDEO_DURATION__`.
- Audio placement comes from `window.__AUDIO_TIMELINE__`.

That means audio and visuals stay synced because both are computed from the same manifest timeline.

## Test Fixtures

- `tests/fixtures/plan-pipeline/source.html`: a plan-source input file where visual-only durations are declared and narration durations are auto-measured after TTS.
- `tests/fixtures/input-contract-test/index.html`: compact contract-compliant narration plus visual test.
- `tests/fixtures/input-contract-4k-sync-test/index.html`: text-heavy synchronized animation test.
- `tests/fixtures/visual-only-3d-test/index.html`: visual-only Three.js stress test with no audio cues.

## Generated Files

The renderer may create these files next to a plan-source example:

```text
resolved.html
audio/*.wav
rendered*.mp4
```

Those files are generated artifacts and are ignored by `.gitignore`. The source file to keep/edit is normally `index.html` or `source.html`.

## Docs

- [HTML input contract](docs/html-input-contract.md)
