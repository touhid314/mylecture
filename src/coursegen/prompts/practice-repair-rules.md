# Practice repair rules (condensed)

Derived from `prompts/interactive-practice.md` — keep activity numbering, interaction, and content-budget sections in sync with that file.

Apply these rules when fixing QA findings. Edit only the practice HTML file named in the task message.

## Repair workflow

The task message includes a **repair workflow** section with turn budget, file size, and likely line regions. Follow it exactly:

- Patch only what the QA findings require.
- Use targeted `read` ranges — never read a file over ~450 lines in full.
- Call `edits` by turn 3 at the latest.
- Do not rewrite all CSS or all JavaScript.

## Required page skeleton

Use this region structure:

```html
<div id="app">
  <header id="activity-header"><!-- title + tab nav + progress --></header>
  <section id="activity-instructions"><!-- How to play + goal --></section>
  <main id="activity-stage"><!-- visuals / questions --></main>
  <aside id="activity-controls"><!-- buttons, sliders, inputs --></aside>
</div>
```

Every activity tab must carry `data-activity-tab="<activity-id>"`. The active tab must have `data-active="true"`. Multi-activity pages must show **Activity X of N** numbering on each tab.

Header progress counters for question/step position must use **`N of M`** only (for example `1 of 8`). No "Question" prefix and no slash form (`1 / 8`).

- At most **3** activities per page.

## Viewport-fit contract

- At `1280x720`, the full active screen must fit within `100vw` by `100vh` with no document scrollbars.
- At `390x844`, the same file must become a paged mobile flow: one prompt/question/challenge at a time, one primary control cluster, progress, feedback, and next action visible.
- Do not repair phone crowding by squeezing a desktop list, table, matching board, full item pool, or multi-question workspace into one column. Split it into sequential mobile pages instead.
- Set `html`, `body`, and `#app` to full viewport height; avoid page-level overflow.
- Do not fix crowding with `overflow: auto` on `#activity-stage`, `#activity-controls`, or body. Reduce content, shorten copy, or split into steps instead.
- Automated QA rejects internal panel overflow and tiny scrollbars.

## Readability floor

- No visible text below **14px** computed font size.
- Body copy, prompts, instructions, questions, and feedback must render at **16px+**. Only short labels, captions, badges, and footnotes may use 14px.
- Never shrink text to fit; remove or split content instead.

## Content budget

Each visible screen may show at most one primary visual, one control cluster, and one feedback area. If crowded, shorten copy or split into steps before shrinking the learning task.

## Responsive interaction

- Any drag interaction must also work via tap/click selection (select-then-place or equivalent).
- Keep tap targets at least **44px** tall/wide when possible.
- Phone screens should use a card-deck/page model. If multiple questions, rows, match pairs, or graph tasks are visible at once on phone, add mobile state such as `currentQuestionIndex` and show only the current item plus Next/Back or Check/Next controls.
- Desktop may remain a richer workspace; phone should be simpler per screen, even if it takes more taps to complete the same activity.

## Answer leakage (practice/challenge)

- Do not reveal correct answers before the learner submits.
- **Never** show empty dashed circles, slot outlines, or ghost markers at answer positions before submit.
- Show drop previews only while an item is selected or being dragged.
- When an item is placed, remove or hide its placement marker immediately.
- Fix pedagogical correctness before layout polish. Every visual, animation, label, and feedback explanation must agree with the checked answer.
- For precision visuals, repair the actual visible endpoint, not only the underlying data. Handles, pointers, arrow tips, progress fills, cursors, highlights, and target markers must land on the same semantic coordinate/value/state used by the answer and feedback.

## Completion and progress

- Every practice or challenge activity must state its success criterion in `#activity-instructions`.
- Progress must be visible (checklist, score, or equivalent).
- When the learner meets the success criterion, set `document.documentElement.dataset.activityComplete = "true"` and send `window.parent.postMessage({ type: "mylecture:activity-complete", correct: true, hintsUsed, retries }, window.location.origin)`.

## Technical

- Build a single self-contained HTML file at the path given in the task message.
- No external scripts or CDN dependencies unless the task message explicitly allows them.
- Dark background `#121212`, responsive text with `clamp()` minimum 14px.
