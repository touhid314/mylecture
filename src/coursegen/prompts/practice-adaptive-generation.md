# Adaptive practice generation (superseded)

**Adaptive courses** (`adaptivePath: true`) now use the shared activity shell pipeline.

- **Agent writes:** `activities/interactive/stage.js` or `activities/game/stage.js` (plus optional `stage.css`)
- **Coursegen assembles:** `activities/*/index.html` from `src/coursegen/activity-shell/`
- **Authoring prompt:** `prompts/stage-authoring.md`

This file is kept for reference. Non-adaptive courses still use `prompts/interactive-practice.md` for free-form `index.html` generation.
