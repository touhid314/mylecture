# Adaptive micro-lesson (coursegen override)

This skill **overrides** the default lecture-agent CORE RULE (divide-and-conquer into `index1.html`, `index2.html`, …) for the current task.

## Output scope

- Write **one** `script.md` and **one** `index.html` only.
- Never create `index2.html`, `script2.md`, or additional scene files for a 2–3 minute adaptive node.
- Do **not** create practice or activity files (`activities/`, `interactive.html`, `game.html`) in this pass.

## Full-viewport stage

```css
html, body { width: 100%; height: 100%; overflow: hidden; }
#stage { width: 100vw; height: 100vh; }
```

- Never use a fixed smaller stage plus `transform: scale(calc(...))` — `scale()` cannot take length ratios; the transform silently fails and leaves letterboxing.
- No horizontal overflow past the viewport; content must fit inside 100vw × 100vh.

## Contract cheat-sheet

Required globals:

- `window.__VIDEO_METADATA__`
- `window.__VIDEO_PLAN__`
- `window.__RENDER_SECTION__`

Segment shapes:

- `narration+visual`: `{ id, kind, audio, text }` — **never** declare `duration` (timing is derived from audio).
- `visual-only`: `{ id, kind, duration }` only.

Audio paths: `audio/i1_1.wav`, `audio/i1_2.wav`, … (single `index.html`, so `i1_*` ids are fine).

`__RENDER_SECTION__` must be **stateless**: rebuild or reset DOM to a canonical baseline at the start of every call before applying segment state. The player seeks arbitrary `(segment, time)` pairs.

## Visual continuity

- One continuous scene; mutate elements in place — do not invent a new full layout per beat.
- Change scene only when the topic truly changes.

## Workflow

1. Write `script.md`, then `index.html`.
2. If contract validation fails, fix those errors first.
3. Do **one** layout check: stage fills full viewport, no `scale(calc())`, no letterboxing, no overlapping competing panels — then reply done.
4. No broad polish passes or full-file re-reads after that.
