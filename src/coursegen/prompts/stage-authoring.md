# Stage authoring (adaptive practice)

Write **only** the stage module for this activity. The build system assembles the final `index.html` from a shared shell — do not write `index.html`.

## Output files

| Kind | Required | Optional |
| --- | --- | --- |
| Interactive | `activities/interactive/stage.js` | `activities/interactive/stage.css` |
| Game | `activities/game/stage.js` | `activities/game/stage.css` |

Single-pass workflow: write `stage.js` in **one** write call, then reply **done**. No polish passes.

## What the shell provides (do not rebuild)

The shell owns ALL meta-UI — score, streak/progress counters, goal/success text, timers tied to completion, feedback banners, and completion events. The stage must NEVER render its own score bar, streak counter, goal text, progress display, or duplicate feedback. **Hard forbid:** stage-owned score/streak/goal/progress/timer HUD, `.game-hud`, duplicate feedback banners. **Hard forbid:** monkey-patching `Object.prototype`, scanning `window` for shell internals, or reaching into `#shell-*` elements. The stage renders only the question/visual/manipulative and answer controls; it reports outcomes via `checkAnswer`'s return value (`{ correct, explanation, scoreDelta }`).

- `#app` layout: `#activity-header`, `#activity-instructions`, `#activity-stage`, `#activity-controls`
- Activity tabs, progress counter (`N of M`), Check / Next / Try again buttons, feedback banner
- Paged item flow (one item at a time on desktop and phone)
- Completion event and scoring for practice/challenge modes
- Viewport detection via `ctx.viewport` (`desktop` | `phone`)

## Content budget (layout contract — format is free)

Choose whatever interaction best teaches the objective (quiz, demo, manipulative, matching, etc.). Per visible item, keep at most:

- **one** primary visual
- **one** control cluster
- **one** feedback path — put explanations in `checkAnswer.explanation` (shell banner); do **not** add a large in-stage explanation panel that expands after Check

Prefer sequential items / progressive disclosure over dashboards that show everything at once. **Never shrink text to fit** — remove or defer content instead. Fit inside `#shell-stage-inner` with no scrolling and no scaling (including phone). Prefer `min-height: 100%` over hard-coded `height: 100%` when content can grow.

## Stage API

Register your stage once:

```js
window.registerStage({
  activities: {
    "<activity-id>": {
      createItems(ctx) { return [/* item objects */]; },
      renderItem(ctx, item, mountEl) { /* DOM into mountEl only */ },
      checkAnswer(ctx, item) {
        return { correct: true|false, explanation?: string, scoreDelta?: number };
      },
      cleanupItem?(ctx, item, mountEl) { /* optional teardown */ }
    }
  }
});
```

**Context (`ctx`):**

| Field / method | Purpose |
| --- | --- |
| `viewport` | `'desktop'` or `'phone'` — adapt visuals, not chrome |
| `activity` | Config entry: `id`, `title`, `mode`, `instructions`, `successCriterion`, `successTarget`, optional `scoreScale`, optional `pacing`, optional `timer` (`{ start, min, shrink }` seconds) |
| `index`, `total` | Current item index and count |
| `setResponse(value)` | Learner answer; enables Check button |
| `getResponse()` | Current answer |
| `requestCheck()` | Trigger Check programmatically (e.g. auto-check) |
| `reportHint()` | Call when your stage reveals a hint (tracks hint usage) |

**Modes:** `learn` — sandbox, no `checkAnswer` needed; `practice` — hide answers until submit; `challenge` — use `scoreDelta` in `checkAnswer`.

**Timed challenges:** If you add a per-item countdown, use `ctx.activity.timer` from the shell config (`start` / `min` / `shrink` seconds). Do **not** invent raw timer durations. Omit a timer entirely when the activity is untimed.

Activity ids, modes, and targets are in the injected config JSON in your task message — register every listed id.

## Example (multiple-choice, ~40 lines)

Example only — choose the interaction that best teaches the objective.

```js
window.registerStage({
  activities: {
    main: {
      createItems() {
        return [
          { q: 'Which is greater?', choices: ['-2', '0'], answer: '0' },
          { q: 'Which is less?', choices: ['-5', '-1'], answer: '-5' }
        ];
      },
      renderItem(ctx, item, el) {
        const p = document.createElement('p');
        p.textContent = item.q;
        el.appendChild(p);
        item.choices.forEach(c => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = c;
          btn.onclick = () => ctx.setResponse(c);
          el.appendChild(btn);
        });
      },
      checkAnswer(ctx, item) {
        const ok = ctx.getResponse() === item.answer;
        return { correct: ok, explanation: ok ? '' : 'Try the number farther ' + (item.q.includes('greater') ? 'right' : 'left') + '.' };
      }
    }
  }
});
```

## Pedagogy rules (stage content only)

- **No answer leakage before submit** in practice/challenge: no dashed markers at answer positions, no labels naming the answer, no pre-selected correct control.
- Compute visuals and scoring from one shared answer state — diagram, labels, and `checkAnswer` must agree.
- Precision indicators (pointers, highlights, fills) must land on the semantic target used by scoring.
- If you use drag, also support tap/click equivalents.
- Keep visuals topic-specific and concrete — this is the creative surface.
- Store items as data; render only the current item in `renderItem`.
- Prefer compact item data and simple controls; keep `stage.js` under ~250 lines when possible.
- Touch targets ≥ 44px; body/prompt text ≥ 16px inside the stage.

Match terminology from the video lesson. Implement exactly the activities in the provided config.
