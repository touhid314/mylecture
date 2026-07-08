# Stage repair (adaptive shell)

Edit **only** `stage.js` (and optional `stage.css`). The build system regenerates `index.html` — do not edit it.

The shell owns ALL meta-UI — score, streak/progress counters, goal/success text, timers tied to completion, feedback banners, and completion events. The stage must NEVER render its own score bar, streak counter, goal text, progress display, or duplicate feedback. **Hard forbid:** stage-owned score/streak/goal/progress/timer HUD, `.game-hud`, duplicate feedback banners. **Hard forbid:** monkey-patching `Object.prototype`, scanning `window` for shell internals, or reaching into `#shell-*` elements. Render only question/visual/manipulative and answer controls inside `#shell-stage-inner`; report outcomes via `checkAnswer`. Prefer compact item data; keep `stage.js` under ~250 lines when possible.

**Never shrink text to fit.** Fix overflow/overlap by removing or deferring content (explanations → `checkAnswer.explanation` for the shell banner; drop in-stage explanation panels; fewer simultaneous controls). Do not rebuild shell chrome.

Read the full stage file; it is small.

## Stage API

```js
registerStage({ activities: { "<id>": { createItems, renderItem, checkAnswer, cleanupItem? } } })
```

**Context:** `viewport`, `activity`, `index`, `total`, `setResponse`, `getResponse`, `requestCheck`, `reportHint` (call when revealing a hint).

Activity ids, modes, and targets are in the shell config JSON in this message — match them exactly.

## Automated finding prefixes → fix locus

| Prefix | Fix in |
| --- | --- |
| `Interaction check:` + `shell walk` | `stage.js`: wire `ctx.setResponse`, `renderItem`, `checkAnswer`; never edit `#shell-*` chrome |
| `Interaction check:` + `stage DOM` | `stage.js` / `stage.css`: answer leakage, dashed markers, placement visuals inside `#activity-stage` |
| `Responsive readability check:` | `stage.js` DOM or `stage.css` inside `#activity-stage` — remove/defer content, not shell chrome |
| `Responsive readability check:` + `[shell-chrome]` | **Not repairable** — coursegen activity-shell bug (`shell.css` / `shell.js`); these findings never reach the repair agent |
| `Stage validation:` | `stage.js` syntax, `registerStage()`, activity ids, no Object.prototype / stage HUD |
| `[stage-fixable]` + HUD duplicate | `stage.js` / `stage.css`: remove the stage's own score/streak/goal/progress/timer HUD; the shell owns all meta-UI |
| `[stage-fixable]` + does not fit / overlapping | `stage.js` / `stage.css`: remove or defer content (explanations in `checkAnswer.explanation` only); never scale, scroll, or shrink fonts below readability floors |

## Pedagogy

- No answer leakage before submit in practice/challenge modes.
- One shared answer state for visuals, labels, and `checkAnswer`.
- Precision visuals must match scoring semantics.
- Support tap/click equivalents when using drag.
- Do not rebuild shell chrome (tabs, counter, Check/Next, completion).
