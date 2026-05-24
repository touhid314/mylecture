# HTML Input Contract - v0.1
Rules for source HTML files accepted by the renderer pipeline. 

## Required Globals
The HTML must define:

```js
window.__VIDEO_METADATA__
window.__VIDEO_PLAN__
window.__RENDER_SECTION__
```

## Video Metadata

Source HTML must define exactly these fields:

```js
window.__VIDEO_METADATA__ = {
  contractVersion: "0.1",
  title: "Dijkstra's Algorithm Explained",
  aspectRatio: "9:16"
};
```

Rules:

```text
contractVersion must be "0.1"
title must be a non-empty string
aspectRatio must be a string such as "9:16", "16:9", "1:1", or "4:5"
source HTML must not include renderer execution settings such as width, height, or fps
source HTML should not define lastResolved manually
```

Resolved HTML adds one resolver-owned field:

```js
lastResolved: "2026-05-24T12:34:56.789Z"
```

Rules:

```text
lastResolved is written by the resolver
lastResolved must be an ISO 8601 UTC timestamp
```

## Segment Kinds
Only these segment kinds are allowed:

```js
"visual-only"
"narration+visual"
"interactive"
"game"
```

1. `visual-only`
Use for a segment with visuals and no voiceover.

Allowed fields:

```js
{
  id: "unique-id",
  kind: "visual-only",
  duration: 6
}
```

Rules:

```text
duration must be a positive number in seconds
```

2. `narration+visual`

Use for a segment with visuals and voiceover.

Allowed fields:

```js
{
  id: "unique-id",
  kind: "narration+visual",
  audio: "audio/unique-id.wav",
  text: "Narration text."
}
```

Rules:

```text
text is the narration script
audio must be a relative .wav path
```

3. `interactive`

Use for an interactive section that should be available in the viewer after the renderable video timeline finishes.

Allowed fields:

```js
{
  id: "practice",
  kind: "interactive",
  title: "Try it yourself"
}
```

Rules:

```text
interactive sections do not contribute to exported video duration
interactive sections must not include audio or duration
interactive UI must stay hidden during real export mode
the page should define window.__START_INTERACTIVE__(segment) to show the interactive UI
the viewer calls window.__START_INTERACTIVE__(segment) after playback reaches the end
```

4. `game`

Use for a playable practice section that should be available in the viewer after the renderable video timeline finishes.

Allowed fields:

```js
{
  id: "game",
  kind: "game",
  title: "Play the puzzle"
}
```

Rules:

```text
game sections do not contribute to exported video duration
game sections must not include audio or duration
game UI must stay hidden during real export mode
the page should define window.__START_GAME__(segment) to show the game UI
the page should define window.__STOP_GAME__() to hide/reset the game UI
the viewer shows a separate game marker for jumping into the game section
game code may respond freely to user input
game code should use local assets for sound effects
```

## Video Plan

The plan must be an ordered array.

Example plan:

```js
const VIDEO_PLAN = [
  {
    id: "intro",
    kind: "narration+visual",
    audio: "audio/intro.wav",
    text: "Today we will learn the idea."
  },
  {
    id: "animation-only",
    kind: "visual-only",
    duration: 6
  },
  {
    id: "observation",
    kind: "narration+visual",
    audio: "audio/observation.wav",
    text: "As you can see, the pattern is clear."
  },
  {
    id: "practice",
    kind: "interactive",
    title: "Try it yourself"
  },
  {
    id: "game",
    kind: "game",
    title: "Play the puzzle"
  }
];

window.__VIDEO_PLAN__ = VIDEO_PLAN;
```

## Render Function

The HTML must define:

```js
function renderSection(segment, localTime, globalTime) {
  // update the DOM for this exact moment
}

window.__RENDER_SECTION__ = renderSection;
```

Rules:

```text
segment is the active plan item
localTime is seconds since the active segment started
globalTime is seconds since video start
all visual state must be computed from segment, localTime, and globalTime
on-screen text must be rendered inside this function or derived from code, not segment title/subtitle/caption fields
do not use CSS animations or CSS transitions for motion
all motion must be computed from localTime/globalTime inside this function
```

## Interactive Function

For pages with an `interactive` segment, define:

```js
function startInteractive(segment) {
  // show buttons, inputs, or practice controls for the viewer
}

window.__START_INTERACTIVE__ = startInteractive;
```

Rules:

```text
interactive state may respond to user input
interactive controls should not appear in real export mode
interactive code should use local assets for sound effects
```

## Game Function

For pages with a `game` segment, define:

```js
function startGame(segment) {
  // show playable controls for the viewer
}

function stopGame() {
  // hide or reset playable controls
}

window.__START_GAME__ = startGame;
window.__STOP_GAME__ = stopGame;
```

## Export Mode

The HTML must support:

```text
?export=1
```
