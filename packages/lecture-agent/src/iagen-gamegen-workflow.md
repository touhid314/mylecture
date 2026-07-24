# IAGen and GameGen Workflow

The IDE exposes three independent generation checkboxes:

```text
[x] Video  [ ] Interactive  [ ] Practice game
```

At least one output must be selected.

When Video is selected, the answer generator and script writer run first.
`script.md` then becomes the optional reference material supplied to the
IAGen and/or GameGen. This keeps all selected outputs aligned to the video's
concepts and teaching sequence. Selected IAGen and GameGen calls start as soon
as `script.md` is written, in parallel with asset preparation and the
animator's work. LectureGen waits for every selected branch before completing.

When Video is not selected, the video-only stages are skipped. The selected
IAGen and/or GameGen receive the user request and attachments
directly. This path does not require `SCRIPT_TRIMMER_CHUNK_SIZE`.

## IAGen

Inputs:

1. User request.
2. Target aspect ratio.
3. Optional `script.md` reference material.
4. User attachments.

Workhorse: one dedicated interactive-segment LLM call using
`prompts/iagen_system.md`.

Output: one plain `interactive.html` file containing the HTML returned by IAGen.
It has no MyLecture contract or required global functions.

## GameGen

Inputs are the same as IAGen.

Workhorse: one dedicated GameGen LLM call using
`prompts/gamegen_system.md`.

Output: one plain `game.html` file containing the HTML returned by GameGen. It
has no MyLecture contract or required global functions. The design prompt still
asks for a mission overlay and a score from 0 through 100.

Both generators return only HTML code without Markdown fences, explanations,
JSON, or other surrounding text.
