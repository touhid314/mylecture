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
  contractVersion: "x.y",
  title: "<a suitable title for the video>",
  aspectRatio: "a:b"
};
```

Rules:
Get contractVersion from the top of this file.
aspectRatio must be a string such as "9:16", "16:9", etc.

## Segment Kinds
Only these segment kinds are allowed:

```js
"visual-only"
"narration+visual"
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

## Export Mode

The HTML must support:

```text
?export=1
```
