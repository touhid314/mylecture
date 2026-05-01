# Video Rendering

For the HTML generation contract, see [`html-input-contract.md`](./html-input-contract.md).

Render the current standalone HTML file to MP4:

```bash
npm run render:video
```

Useful options:

```bash
npm run render:video -- --html tests/fixtures/input-contract-test/index.html --out output.mp4 --fps 30 --width 1080 --height 1920
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

Override them when needed:

```bash
npm run render:video -- --workers 8 --jpeg-quality 85
npm run render:video -- --frame-format png --workers 1
npm run render:video -- --video-codec libx264 --x264-preset ultrafast
```

Use PNG only when you need lossless intermediate frames; it is much slower.

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

## Plan Pipeline

Use this concise contract for source HTML:

```text
Create one complete self-contained HTML file for a 16:9 video renderer.

Use exactly these segment kinds:
- kind: "visual-only": visuals with no voiceover. Must include duration.
- kind: "narration+visual": visuals with voiceover. Must include text and audio, and must not include duration.
- audio paths should end in .wav, for example "audio/intro.wav".

Expose:
- window.__VIDEO_PLAN__
- window.__RENDER_SECTION__(segment, localTime, globalTime)

All visual state must be a deterministic function of localTime/globalTime. Do not use setTimeout to define final visual state.
Do not use CSS animations or CSS transitions for motion. All motion must be computed inside window.__RENDER_SECTION__.

Include a preview/export runtime:
- hide controls for ?export=1 and disable CSS transitions/animations in export mode

Do not include title, subtitle, or caption fields in plan items. Render any on-screen text inside __RENDER_SECTION__.

Output only the HTML.
```

Minimal plan shape:

```js
window.__VIDEO_PLAN__ = [
  {
    id: "intro",
    kind: "narration+visual",
    audio: "audio/intro.wav",
    text: "Today we will see how the idea works."
  },
  {
    id: "setup-animation",
    kind: "narration+visual",
    audio: "audio/setup-animation.wav",
    text: "Now let's look at this animation."
  },
  { id: "animation-only", kind: "visual-only", duration: 6 },
  {
    id: "observation",
    kind: "narration+visual",
    audio: "audio/observation.wav",
    text: "As you can see, the visual motion makes the pattern easier to understand."
  }
];
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

## High-Resolution Example

Render the visual-only Three.js test at 4K and 120 fps:

```bash
npm run render:video -- --html tests/fixtures/visual-only-3d-test/index.html --out tests/fixtures/visual-only-3d-test/rendered-4k-120fps.mp4 --width 3840 --height 2160 --fps 120
```
