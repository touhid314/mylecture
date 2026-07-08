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

## Progress counter (mandatory)

When showing question or step position in the header (or any compact progress label), use exactly **`N of M`** — for example `1 of 8`, `2 of 4`.

- Do **not** prefix with "Question" or other words in the counter (`Question 1 of 8` is too long for mobile headers).
- Do **not** use slash form (`1 / 8`) for the counter.
- Score or completion summaries may use other short forms (for example `3 correct`), but position counters are always `N of M`.

Grid: header spans full width; instructions full width; stage left (~65%); controls right (~35%) on desktop. Use `min-height: 0`, `clamp()`, flexible grids, and compact copy so the active activity fits the embedded player without document scrollbars or internal scroll panes.

## Viewport-fit contract

These pages run inside a website lesson player, not as standalone web pages. The active activity must fit inside the visible frame.

- At `1280x720`, the full active screen must fit within `100vw` by `100vh` with no visible scrollbars.
- At phone viewport `390x844`, the same HTML file must become a simple paged mobile flow: show one prompt/question/challenge at a time, one primary control cluster, one feedback area, and a clear next action. Do not show a desktop-style list of multiple questions, rows, examples, or match pairs on one phone screen.
- Build one responsive source, not separate desktop/mobile pages. It is fine for layout, labels, and density to adapt by viewport; the activity state, goal, answer logic, and completion event must stay the same.
- Set `html`, `body`, and `#app` to use the full viewport height and avoid page-level overflow.
- Do not solve crowding by adding `overflow: auto` to `#activity-stage`, `#activity-controls`, or body. Instead reduce on-screen content (see the content budget below), shorten copy, and scale visuals with `max-height`/`max-width`.
- Automated QA rejects internal panel overflow (`scrollHeight`/`scrollWidth` beyond the visible box); tiny scrollbars or clipped rows mean the screen does not fit.
- Controls should remain touch-friendly, but do not use fixed oversized typography that forces scrolling on laptop or phone viewports.

## Readability floor (hard requirement — automated QA rejects violations)

- No visible text may render below **14px** computed font size at `1280x720`. This includes slider labels, axis labels, captions, badges, and footnotes.
- **Never shrink text to make content fit.** If a screen does not fit at 14px+, remove content, shorten copy, or split the activity into steps — shrinking the font is not an acceptable fix.
- Body copy, prompts, instructions, questions, and feedback must render at **16px+**. Only short secondary labels, captions, axis labels, badges, and footnotes may go down to 14px.

## Content budget (per visible screen)

A screen is what the learner sees at one moment. Each screen may show at most:

- **one** primary visual (canvas, SVG, diagram, question card, or worked example)
- **one** cluster of related controls (aim for ≤5 interactive inputs visible at once)
- **one** feedback/status area, plus the header and short instructions

If the activity needs more than this (presets + sliders + derivation panels + readouts, multiple question types, reference material), use **progressive disclosure** instead of cramming:

- Split the activity into sequential steps inside the same tab ("Step 1 of 3: choose a particle" → "Step 2: adjust energy" → "Step 3: interpret the graph"), with a visible step indicator and Next/Back controls.
- Or move secondary reference content behind a toggle/details control that replaces (not overlays shrunken beside) the primary visual.
- Prefer fewer, larger, clearer elements over a dashboard that shows everything at once. A focused screen with 3 controls beats a dense lab bench with 12.

## Responsive interaction rules

- Use CSS media queries/container queries and flexible layout; do not generate a second mobile file.
- On phones, use a card-deck/page flow, not a compressed desktop panel. Each phone screen should feel like one Duolingo-style prompt: current item, answer controls, feedback, and Next/Back.
- If the desktop activity has multiple rows, pairs, cards, graph tasks, or questions visible at once, transform them on phone into sequential pages (`currentMobileStep`/`currentQuestionIndex` state is fine). Example: matching four pairs on desktop becomes a phone screen with header counter `1 of 4`, prompt text for the current match, 2-4 large answer buttons, then "Next" advances to question 2.
- On phones, prefer step cards, segmented choices, large tap targets, and one primary action button over side-by-side panels.
- Avoid hover-only interactions. Any drag interaction must have a tap/click alternative.
- Keep tap targets at least 44px tall/wide when possible.
- If a desktop visual is too complex for phone, replace it with the smallest equivalent state needed to complete the current page only. Do not carry over full desktop diagrams, full pools, or all answer slots unless that single question needs them.
- Never make mobile a passive fallback that says to use desktop. The learner must be able to complete the activity on phone unless the task message explicitly says otherwise.

## Mobile page-flow contract

Phone layout is allowed and expected to have a distinct interaction model from desktop while sharing the same data and completion state.

- Use CSS/JS branching inside the same HTML file. Do not create a second mobile file.
- At `390x844`, one visible screen should contain exactly one active learner decision or manipulation.
- Show compact progress as **`N of M`** in the header (see Progress counter above), a small score/checklist, or a progress bar.
- Hide completed/locked/future questions from the visible phone screen. They may be summarized as small progress marks, but not shown as full cards/rows.
- Keep instructions to one short sentence on phone. Move detailed instructions behind a collapsible/help button or omit them after the first page.
- The primary button should be specific: "Check answer", "Next question", "Try again", "Finish practice".
- On the final phone page, show a compact completion state that fits without text overflow and posts the same completion event.
- Desktop may keep a richer workspace layout, but phone must be simpler per screen, even if that means more taps.

## Interaction engineering (mandatory — automated QA rejects violations)

These rules apply to **any** movable item activity (drag chips, place labels, sort cards, plot points, match pairs, etc.), not one specific topic.

### Instruction–implementation parity

- If copy says **click/tap**, **drag**, or **drag or tap**, every described step must actually work that way in code.
- Do not wire only `dragstart`/`drop` on source items when instructions say click-to-select. Pool/source items need `click` handlers too.
- If the flow is select-then-place, clicking a source item must update visible selection state (class, `aria-selected`, or equivalent) before the learner clicks the target area.
- Every control listed in `controls` must respond to its primary pointer input on first interaction.

### Placement affordances (practice/challenge)

- **Never** show empty dashed circles, slot outlines, or ghost markers at answer positions before the learner submits. That leaks answers and looks broken when items are placed on top.
- Show drop previews **only while** an item is selected or being dragged (hover highlight, snap guide, etc.).
- When an item is placed, **remove or hide** its placement marker immediately. Do not leave a residual ring/circle visible inside or behind the placed item.
- Match preview marker size to placed item size, or hide the marker entirely once filled.
- Avoid full `render()` on every `mousemove` when a lightweight class toggle on the hovered slot is enough.

### Drag + tap equivalence

- Dragging and tap-to-select-then-tap-to-place must produce the same final state.
- Clicking a placed item should let the learner pick it back up (return to pool or re-select) without surprising side effects.
- Use `e.stopPropagation()` on item clicks so stage clicks do not fire accidentally.

### Cursor and feedback

- Use `cursor: grab` on draggable sources; use crosshair/pointer on the drop target **only** when an item is selected.
- After placement, clear selection and hover previews.

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

### Correctness rules (critical)

- Visual correctness is part of answer correctness. After submit, every diagram, animation, label, highlighted result, worked step, and feedback sentence must agree with the same answer state.
- For arithmetic or symbolic practice, compute expected answers from structured data and use that same computed state for scoring, feedback, and visuals. Do not duplicate math logic in separate places with different formulas.
- When a visual indicator has a meaningful endpoint, target, handle, pointer, arrow tip, fill boundary, cursor, or highlighted state, compute that visible endpoint from the same semantic state as the answer/feedback. Prefer one controlled SVG/canvas/DOM shape over loosely combining strokes, markers, caps, shadows, or overlays when exact alignment matters.
- If the activity uses structured question data, include a small internal consistency check during initialization and log/repair mismatches rather than silently showing contradictory visuals.

### Learn mode rules

- May show labels and live updates (sandbox). Tab title must include "Explore".

## Navigation and goals

- If more than one activity: tab labels must say **"Activity 1 of N: …"** (not vague names only).
- On first load: show either a brief dismissible start overlay or an always-visible intro card stating the overall goal. Keep it instructional and concise.
- Progress must be visible (checklist, "2/3 activities done", score, or another topic-appropriate indicator).
- Every `practice` or `challenge` activity must state its success criterion in `#activity-instructions`.
- When the learner meets the success criterion, set `document.documentElement.dataset.activityComplete = "true"` and send `window.parent.postMessage({ type: "mylecture:activity-complete", correct: true, hintsUsed, retries }, window.location.origin)`.
- If the final submitted attempt should be recorded as incomplete or incorrect, send the same event with `correct: false`.

## Scope

- Implement **only** the activities listed in the interactiveSpec from the task message.
- Do **not** add sound effects, CDN fonts, extra activities, or external libraries unless the task message explicitly requires them.
- Maximum 3 activities per file.

## Technical

- Full viewport, dark background `#121212`, readable responsive text using `clamp()` with a minimum of 14px (e.g. `clamp(14px, 1.2vw, 18px)`), never below.
- Self-contained: no external scripts unless explicitly allowed by the task message.
- Initialize all state before wiring click handlers.
