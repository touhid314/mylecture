# Tests

Renderer test inputs live in `tests/fixtures/`.

Each fixture is a source HTML file or a small fixture folder that can be passed directly to `npm run render:video`.

## Fixture Layout

```text
fixtures/
  input-contract-test/            Contract smoke test with narration and visual-only segments
  visual-narration-benchmark/     Fast 480p/15fps narration+visual benchmark render
  input-contract-4k-sync-test/    Text-heavy synchronized animation test
  visual-only-3d-test/            Visual-only Three.js stress test
  plan-pipeline/                  Full plan-resolution pipeline fixture
  gemini-gen/                     External generated HTML regression fixture
  legacy-html/                    Older standalone HTML files kept for reference
```

## Test Commands

Run the standard smoke suite:

```bash
npm test
```

Run individual checks:

```bash
npm run test:build
npm run test:render
npm run test:visual
npm run test:narration
```

### `npm run test:build`

Builds a resolved timeline from:

```text
tests/fixtures/input-contract-test/index.html
```

Validates:

```text
plan-source HTML can be loaded
window.__VIDEO_PLAN__ is detected
narration audio is found or generated
audio durations are measured
visual-only durations are resolved
resolved HTML can be written
```

Output:

```text
.render/tests/input-contract-resolved.html
.render/tests/audio/*.wav
```

### `npm run test:render`

Runs a short render smoke test from:

```text
tests/fixtures/input-contract-test/index.html
```

Validates:

```text
auto-build from plan source works
renderAt(time) is available in the resolved page
first frames can be captured through Playwright
audio cues can be mixed for the shortened render
the fixture folder does not need to be modified
```

Output:

```text
.render/tests/input-contract-render-resolved.html
.render/tests/input-contract-smoke.mp4
```

### `npm run test:visual`

Runs a short visual-only 3D render smoke test from:

```text
tests/fixtures/visual-only-3d-test/index.html
```

Validates:

```text
visual-only plans work with zero audio cues
local Three.js module imports load correctly
WebGL content can be rendered by Playwright
frames can be captured without narration audio
```

Output:

```text
.render/tests/visual-3d-resolved.html
.render/tests/visual-3d-smoke.mp4
```

### `npm run test:narration`

Runs a full visual+narration benchmark render from:

```text
tests/fixtures/visual-narration-benchmark/index.html
```

Render settings:

```text
854x480
15 fps
full duration
real MP4 encode
real audio mix
```

Validates:

```text
narration+visual-only timeline can be resolved
TTS audio is found or generated
audio durations control segment durations
frames render at low benchmark resolution
audio is muxed into the final MP4
```

Output:

```text
.render/tests/visual-narration-resolved.html
.render/tests/visual-narration-480p15.mp4
```

This test is intended to stay small enough for regular smoke testing while still being useful as a baseline speed benchmark later.

## Generated Artifacts

These files may appear inside fixture folders after local renders:

```text
resolved.html
audio/*.wav
rendered*.mp4
```

They are generated outputs and are ignored by `.gitignore`.
