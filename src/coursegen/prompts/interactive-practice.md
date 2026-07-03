# Interactive practice spec (mandatory for practice activity pages)

Build a single self-contained HTML file at the path given in the task message (`activities/interactive/index.html` or `activities/game/index.html`). Follow this spec exactly.

## Required page skeleton (CSS grid)

Use this region structure — do not invent a different layout per activity:

```html
<div id="app">
  <header id="activity-header"><!-- title + tab nav + progress --></header>
  <section id="activity-instructions"><!-- How to play + goal --></section>
  <main id="activity-stage"><!-- visuals / questions --></main>
  <aside id="activity-controls"><!-- buttons, sliders, inputs --></aside>
</div>
```

Every activity tab/nav button must carry `data-activity-tab="<activity-id>"` (the id from interactiveSpec). The currently active tab must have `data-active="true"`.

Grid: header spans full width; instructions full width; stage left (~65%); controls right (~35%) on desktop. Use `min-height: 0` and `overflow: auto` so nothing clips.

## Activity modes (declare each activity explicitly)

Every activity tab/screen must use exactly one mode:

| Mode | Label shown to learner | Answer visibility | Goal required |
| --- | --- | --- | --- |
| `learn` | "Explore" | Answers visible by design | Optional: "Try 3 examples" |
| `practice` | "Practice" | **Hide** correct answers until after the learner submits | "Get N correct" (state N in UI) |
| `challenge` | "Challenge" | Hidden until attempt | Score target or win condition |

## Clarity contract

Each activity/game spec includes `visibleSetup`, `learnerAction`, `controls`, `feedback`, and `successCriterion`. Implement all five visibly:

- `#activity-instructions` must include a short "How to play" sentence that restates `learnerAction`.
- The first screen must make `visibleSetup` true without relying on hidden modal text only.
- Every item in `controls` must correspond to an obvious visible control, draggable item, input, or button.
- Before the first attempt, show a next-step cue near the controls (for example, "Choose an option, then press Check answer" or "Build your response, then check it").
- After an attempt, show feedback matching `feedback`: correctness, one reason or hint, and what to do next.
- Button labels must use learner-facing verbs such as "Check answer", "Run test", "Next challenge", or "Try again"; avoid generic "Submit" when a more specific action is available.
- Use the same core terms as the video lesson. Do not introduce a new metaphor, scenario, or rule system unless it directly clarifies the learning objective.

### Practice mode rules (critical)

- The stage, prompt, controls, and visual/state representation must NOT reveal the correct answer before the learner submits.
- Avoid answer leakage in any form: preselected correct choices, labels that name the target concept, examples whose title is the answer, hidden data shown in the UI, or feedback text visible before an attempt.
- Show only neutral task information before submit: the prompt, unlabeled evidence, allowed inputs, constraints, and progress.
- After a correct answer: brief praise + optional reveal. After wrong answer: hint, then reveal on second miss.

### Learn mode rules

- May show labels and live updates (sandbox). Tab title must include "Explore".

## Navigation and goals

- If more than one activity: tab labels must say **"Activity 1 of N: …"** (not vague names only).
- On first load: show either a brief dismissible start overlay or an always-visible intro card stating the overall goal. Keep it instructional and concise.
- Progress must be visible (checklist, "2/3 activities done", score, or another topic-appropriate indicator).
- Every `practice` or `challenge` activity must state its success criterion in `#activity-instructions`.

## Scope

- Implement **only** the activities listed in the interactiveSpec from the task message.
- Do **not** add sound effects, CDN fonts, extra activities, or external libraries unless the task message explicitly requires them.
- Maximum 3 activities per file.

## Technical

- Full viewport, dark background `#121212`, minimum 22px body text.
- Self-contained: no external scripts unless explicitly allowed by the task message.
- Initialize all state before wiring click handlers.
