# Tests

Renderer test inputs live in `tests/fixtures/`.

Each fixture is a source HTML file or a small fixture folder that can be passed directly to `npm run render:video`.

## Fixture Layout

```text
fixtures/
  input-contract-test/            Contract smoke test with narration and visual-only segments
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
```

## Generated Artifacts

These files may appear inside fixture folders after local renders:

```text
resolved.html
audio/*.wav
rendered*.mp4
```

They are generated outputs and are ignored by `.gitignore`.
