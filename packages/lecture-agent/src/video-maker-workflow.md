# Video Maker Workflow

This document describes how the static video-maker pipeline is wired, from a
CLI or IDE request to the generated `index*.html` files and the IDE's editor
mode.

The video maker creates browser-authored lecture scenes. It does not render the
final MP4 itself. The generated HTML files are later resolved and rendered by
the repository's build-plan and render-video pipelines.

## End-to-End Flow

```mermaid
flowchart TD
    U[User video request] --> ENTRY{Entry point}
    ENTRY -->|IDE| IDE["POST /video-maker/generate"]
    ENTRY -->|CLI| CLI["src/video_maker.ts CLI"]

    IDE --> WS[Use IDE-created unique generation workspace]
    CLI --> NEWWS[Create unique generation workspace]
    NEWWS --> WS

    WS --> PARSE[Parse request and generation settings]
    PARSE --> INPUTS["Request + aspect ratio + length + subtitles<br/>theme + teaching style + attachments + getimg flag"]

    INPUTS --> ANSWER[Answer Generator LLM]
    ANSWER --> ANSWERFILE["Write answer.md"]

    ANSWERFILE --> SCRIPT[Script Writer LLM]
    SCRIPT --> GETIMG{getimg enabled?}

    GETIMG -->|No| STRIP[Remove image requests from script]
    GETIMG -->|Yes| ASSETS["Asset Fetcher<br/>collect and download requested images"]
    STRIP --> SCRIPTFILE["Write script.md"]
    ASSETS --> SCRIPTFILE

    SCRIPTFILE --> TRIM["Script Trimmer<br/>split on complete N: narration beats"]
    TRIM --> BLOCKS["Sequential narration blocks<br/>min = ceil(max / 2)"]

    BLOCKS --> LOOP{For each block}
    LOOP --> ANIMATE["Animator LLM<br/>one retained session"]
    ANIMATE --> ONEHTML["Return one complete HTML file"]
    ONEHTML --> VALIDATE[HTML validator hook]

    VALIDATE -->|Pass| KEEP["Keep validated index*.html<br/>and add it to previous HTML context"]
    VALIDATE -->|Fail| REPAIR["Animator receives validator output<br/>and current line-numbered HTML"]
    REPAIR --> EDITS["Return edits-tool JSON"]
    EDITS --> APPLY[Apply range edits]
    APPLY --> VALIDATE

    KEEP --> MORE{More script blocks?}
    MORE -->|Yes| LOOP
    MORE -->|No| META["Write metadata.json"]

    META --> RESULT["Return workspace, entry file,<br/>all HTML files, and completion message"]
    RESULT -->|IDE| EDITMODE["Switch client phase to edit<br/>open first index file"]
    EDITMODE --> EDITOR["Later prompts use EditorAgent<br/>against the same workspace"]
```

## Entry Points

### Programmatic API

`generateVideo(options)` in `video_maker.ts` is the main programmatic entry
point. The IDE calls it with an already-created generation workspace. Other
callers may instead pass a parent workspace and let the video maker create a
unique child directory.

Important inputs include:

- `request`
- `model`
- `workspaceDir` or `parentWorkspace`
- `generationLength`
- `aspectRatio`
- `theme`
- `teachingStyle`
- `attachments`
- `embedSubtitles`
- `enableGetimg`
- optional cancellation signal, token-tracker session ID, and log callback

The returned result contains:

- the generation ID
- the absolute workspace directory
- the first generated HTML file as `entryFile`
- all generated `index*.html` paths
- a short completion message

### CLI

Running `src/video_maker.ts` directly activates the CLI control in the same
module. It parses CLI options, creates a unique generation directory beneath
`--workspace`, then calls the same `generateVideo()` API used by other callers.

Example:

```powershell
npm run video-maker -- --workspace "D:\mylecture\video-generations" --length 1:30 --aspect-ratio 16:9 "Explain binary search"
```

Use `--no-getimg` to prevent the script writer from requesting images and to
skip the asset fetcher.

### IDE

The viewer sends the first chat request to:

```text
POST /video-maker/generate
```

The IDE server:

1. Creates a unique folder under the configured `agent.generationDir`.
2. Parses the visible request and hidden generation controls.
3. Calls `generateVideo()` with that exact folder as `workspaceDir`.
4. Streams video-maker logs to the IDE.
5. Opens the returned entry HTML after successful generation.
6. Changes that client from `generate` phase to `edit` phase.

Later chat messages go to:

```text
POST /agent-chat
```

Those requests create an `EditorAgent` using the same generation workspace.
The editor may read the generated material, but its mutation boundary permits
edits only to workspace-root `index.html` or `indexN.html` files.

## Request Parsing

`parseVideoMakerRequest()` separates the user's actual request from the hidden
settings appended by the IDE or API wrapper:

```text
if the user query is for video generation then follow this:
aspect ratio: 16:9
generation length: 1:00
embed subtitle in video: no
getimg enabled: yes
theme: ...
teaching style: ...
```

Explicit attachment directives are extracted by `prompt_builder.ts`:

```text
[(attachment: D:\absolute\path\to\image.png)]
```

When the API receives attachments outside the generation directory, it copies
them into the generation's `uploads/` folder. LLM providers receive supported
binary attachments separately from the text prompt.

If no theme or teaching style is supplied, the video maker loads the default
resources from `.agents/`.

## Pipeline Stages

### 1. Answer Generator

`answer_generator.ts` uses `prompts/ansgen_system.md`.

It receives the video request, requested generation length, teaching style, and
attachments. Its plain-text response is written immediately to:

```text
answer.md
```

Writing the intermediate result to disk makes a partially completed generation
inspectable if a later stage fails.

### 2. Script Writer

`script_writer.ts` uses `prompts/scriptgen_system.md`.

It receives:

- the original request
- the generated answer
- generation length
- theme and teaching style
- attachment context
- whether image requests are allowed

The output is an audiovisual script built from narration and associated visual
instructions. Narration lines use `N:` markers, which the script trimmer uses as
atomic beats.

The final script is written to:

```text
script.md
```

### 3. Asset Fetcher

`asset_fetcher.ts` contains the complete image-request parsing and image-fetching
implementation.

When getimg is enabled, it:

1. Collects image requests and destination paths from the script.
2. Fetches or generates the requested images.
3. Saves them inside the generation workspace.
4. Produces a text description of the available assets for the animator.

Uploaded user images are also included in the animator's asset description.

When getimg is disabled:

- the script writer is told not to request images;
- any remaining image requests are stripped from the returned script; and
- the asset-fetching stage is skipped.

### 4. Script Trimmer

`script_trimmer.ts` divides the full script into small animator inputs without
splitting an `N:` narration beat from its associated visuals and scene data.
Only narration words count toward the limit; visual instruction words do not.

The required environment variable:

```env
SCRIPT_TRIMMER_CHUNK_SIZE=75
```

sets the maximum narration words per block. The minimum is calculated as:

```text
ceil(SCRIPT_TRIMMER_CHUNK_SIZE / 2)
```

For a maximum of `75`, the normal minimum is therefore `38`. The trimmer chooses
a partition of complete narration beats that keeps blocks within those bounds
when possible. If the entire script is shorter than the minimum, it remains one
block because the trimmer never invents narration.

### 5. Animator

`animator.ts` combines:

- `prompts/animator_system.md`
- the canonical HTML input contract

One `AnimatorSession` is retained for the complete generation. Every block is
sent sequentially through that same session, allowing later calls to retain
conversation context and benefit from provider prompt caching.

For each block, the animator receives:

- original video request
- aspect ratio and full requested length
- current block number and total block count
- current trimmed script block
- theme and teaching style
- subtitle setting
- available asset descriptions
- attachments
- a summary of previously validated HTML files

The animator returns exactly one complete raw HTML document per call:

```text
one block  -> index.html
many blocks -> index1.html, index2.html, ...
```

After a file passes validation, its complete generation and repair history
remains in the retained animator conversation. It is also added to the
`previousHtmls` list before the next block is generated, preserving visual and
narrative continuity.

## Validation and Repair Loop

Every animator result is purified, written to its target file, and passed to
`validate_index_html_contract()`.

If validation passes, the workflow continues to the next block.

If validation fails, the same animator session receives:

- the validator output
- the current HTML with line numbers
- the current script block
- previous validated-file context
- the required edits-tool JSON format

The animator must return only:

```json
{
  "path": "index2.html",
  "edits": [
    {
      "lines": [12, 14],
      "new": "replacement text"
    }
  ]
}
```

The workflow applies those range edits and validates the file again. By default,
it allows at most five animator repair requests. Generation fails with the final
validator output if the file still does not pass.

The validator includes runtime sampling at multiple local times, so failures
that appear only after an animation progresses can be detected before render.

## Workspace Output

A completed generation normally looks like:

```text
<generation-id>/
  answer.md
  script.md
  metadata.json
  index.html
  uploads/
  assets/
```

For multi-block scripts:

```text
<generation-id>/
  answer.md
  script.md
  metadata.json
  index1.html
  index2.html
  index3.html
  uploads/
  assets/
```

The precise asset subdirectories depend on the paths requested by the script.

`metadata.json` contains a title derived from the request and a short lecture
description.

## Module Map

| Module | Responsibility |
| --- | --- |
| `video_maker.ts` | Main orchestration, API, CLI, workspace creation, attachment copying, and final result |
| `answer_generator.ts` | Generates the educational answer |
| `script_writer.ts` | Converts the answer into an audiovisual script |
| `asset_fetcher.ts` | Parses, downloads, or generates requested image assets |
| `script_trimmer.ts` | Partitions complete narration beats into bounded blocks |
| `animator.ts` | Maintains the sequential animator session and validation/repair loop |
| `video_maker_shared.ts` | Shared LLM session, prompt-loading, attachment, and filename helpers |
| `prompt_builder.ts` | Inlines prompt resources and extracts attachment directives |
| `utils/html_contract.ts` | Purifies and validates generated lecture HTML |
| `utils/file_edits.ts` | Applies animator repair edits |
| `editor-agent/` | Handles post-generation user edit requests against the same workspace |

## Failure and Cancellation Behavior

- The static `VideoMaker` session accepts only one generation request.
- A second request requires a new video-maker session or IDE New Chat.
- Missing `SCRIPT_TRIMMER_CHUNK_SIZE` is an error; there is no fallback.
- Missing required request/model values fail before generation.
- A cancellation signal stops between pipeline stages and animator blocks.
- Asset failures, invalid animator output, and exhausted validator repairs stop
  the workflow with an error.
- The IDE changes to edit mode only after `generateVideo()` succeeds.

