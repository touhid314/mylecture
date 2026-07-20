# 
A lecture is composed of various scenes.

A scene consists of beats. Each beat contains a narration cue and a visual cue.

Scene:
  Beat
    N: Narration cue
    V: Visual cue

Lecture → Scene → Beat

# 
A new scene totally clears off the screen unless there is carry-over from the previous scene.


# Animator's guide
- A 'scene' is one continuos scene with various components adding/removing, change of camera angle etc. 
- Beats should better not abruptly transition into the next one. Beats should be as much continuous into one another as possible.


what defines a frame: 
1. content
2. position
3. transition


# most important thing about positioning
## Overlap rule
Elements may share screen space (layering) but must not occlude another
element's legible or informational content. Test: if you removed the
covered portion, would the viewer lose information they need? 
- No (e.g. title over a decorative background illustration) -> overlap is fine.
- Yes (e.g. text over text, a diagram label hidden behind a shape, a chart's
  data hidden under an annotation) -> not allowed, reposition/resize/reduce opacity instead.


# Script teaching style
- Should teach with example
- Teaching should be step by step
- Use analogy when needed. But don't overuse analogy. Only use when something maybe complicated for the target audience and can be easily made sense using an analogy.
- Should refer to visual in narration for various reasons. Usually you are used for text only generation, but in this case, you are planning an animation video script, so you should not think of yourself as writing an answer, rather you are looking at an animation frame teaching various things to a person.

