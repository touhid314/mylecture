# MyLecture LectureGen and Editor Agent Guide

This package now has two distinct responsibilities:

1. **LectureGen** creates a new lecture video, standalone interactive,
   standalone practice game, or any selected combination through a fixed
   multi-LLM pipeline.
2. The **editor agent** handles follow-up requests by editing only the generated root `index*.html` files.

The editor is no longer responsible for initial video generation. The former script sub-agent and `run_script_agent` tool have been removed.

Use this file as the first orientation document before changing code under `packages/lecture-agent`.

## Current Architecture

```text
First IDE request
  -> POST /lecturegen/generate
  -> lecturegen.ts
  -> answer generator
  -> script writer
  -> after script.md, concurrent selected branches:
       video branch -> optional asset fetcher -> script trimmer
                    -> sequential animator loop
                    -> validator/repair loop for each index*.html
       optional IAGen -> interactive.html
       optional GameGen -> game.html
  -> join selected branches
  -> generation workspace

Later IDE requests
  -> POST /agent-chat
  -> editor-agent/coding_agent.ts
  -> read existing index*.html
  -> apply edits only to root index*.html
  -> validator hook
```

The IDE uses the same unique generation folder for both phases. A New Chat resets the phase so the next message generates a new video in a new folder.

## Source Layout

```text
src/
  lecturegen.ts
    Complete LectureGen control unit.
    Contains the orchestration class, programmatic generateLecture() API,
    generation workspace helpers, attachment copying, and direct-run CLI.

  answer_generator.ts
    One-shot answer-generation LLM stage.

  script_writer.ts
    One-shot audiovisual script-writing LLM stage.

  asset_fetcher.ts
    Parses script image requests and contains all image search, generation,
    download, Watchman verification, metadata inspection, and direct-run controls.
    There is no separate image_fetcher module.

  script_trimmer.ts
    Splits complete N:/V: beats into narration-sized animator blocks.

  animator.ts
    Generates one index HTML file at a time and repairs validator failures.

  iagen.ts
    Generates one standalone interactive.html from the request and optional script.

  gamegen.ts
    Generates one standalone game.html from the request and optional script.

  lecturegen_shared.ts
    Internal shared LectureGen LLM plumbing and types. It provides prompt loading,
    one-shot LLM calls, the retained animator LLM session, attachment types, and
    safe relative asset-path validation.

  prompt_builder.ts
    Shared prompt expansion, attachment parsing, and its direct-run CLI control.
    There is no separate prompt-builder CLI file.

  workspace.ts
    Environment loading and workspace-path enforcement.

  validate_contract.cjs
    HTML contract validator, including temporal render sampling.

  editor-agent/
    cli.ts
      One-shot and persistent-chat editor CLI.
    coding_agent.ts
      Editor agent sessions, Gemini native tools, JSON fallback, history
      compaction, attachment handling, and final-response isolation.
    tools/
      tool_registry.ts
        Authoritative editor tool schemas, dispatch, compaction, mutation
        boundary, and validator hook.
      read.ts
      list_dir.ts
      Dormant/utility implementations may exist, but only registry-active tools
      are exposed to the editor.

  utils/
    llm_model.ts
      Provider wrapper for Gemini and OpenAI-compatible models.
    llm_prompt_logger.ts
      Optional full LLM request logging.
    file_edits.ts
      Shared range-edit implementation used by animator repair and editor edits.
    html_contract.ts
      Shared HTML purification and validator wrapper.
    text_stats.ts
    logger.ts

  token-tracker/
    token_tracker.ts
    token_tracker_dashboard.ts

  prompts/
    ansgen_system.md
    scriptgen_system.md
    animator_system.md
    iagen_system.md
    gamegen_system.md
    system_prompt.md
      Editor-only system prompt.
    vault/pre-user-response-prompt.md
      Isolated final-response prompt.
```

Shared resources remain under:

```text
.agents/
  mylecture-contracts/html-input-contract.md
  mylecture-themes/
  mylecture-teaching-style/
  mylecture-profiles/
```

## Main Commands

Run from the monorepo root:

```powershell
npm run lecturegen -- --workspace ".\generations" "Create a lecture about binary search"
npm run editor-agent -- --workspace ".\generations\<generation-id>" "Make the title larger"
npm run chat -- --workspace ".\generations\<generation-id>"
npm run prompt-builder -- --workspace ".\generations\<generation-id>" "Use `notes.md`"
npm run token-tracker
npm run ide
```

Package-local equivalents:

```powershell
npm run lecturegen -- --workspace ".\generations" "Create a lecture about binary search"
npm run editor-agent -- --workspace ".\generations\<generation-id>" "Make the title larger"
npm run prompt-builder -- "Expand `src/prompts/animator_system.md`"
npm test
```

`npm run agent` is retained as an alias for the editor agent. It does not generate a new video.

## Environment

The package loads the nearest `.env` while walking upward from `src/workspace.ts`.

Common variables:

```env
GOOGLE_API_KEY="..."
OPENAI_API_KEY="..."
AGENT_MODEL="gemini-3.5-flash"
# Optional LectureGen stage overrides (fall back to AGENT_MODEL / --model):
# SCRIPT_MODEL="gpt-5.6-luna"       # answer + script writer
# ANIMATOR_MODEL="gpt-5.6-luna"     # animator, iagen, gamegen, and video edits
# EDIT_FALLBACK_MODEL="gemini-3.5-flash" # optional opposite-provider edit fallback
# OPENAI_FALLBACK_MODEL="gpt-5.6-luna" # optional Gemini rate-limit fallback for shared generation stages
GPT_REASONING_EFFORT="none"
# GPT_SERVICE_TIER="fast"  # OpenAI only; omit when unset. Prefer fast; priority is a backwards-compatible alias. Separate from GPT_REASONING_EFFORT.
AGENT_WORKSPACE="optional editor workspace override"
SCRIPT_TRIMMER_CHUNK_SIZE="75"
LOG_FULL_LLM_PROMPT="True"
GETIMG_MODEL="..."
GETIMG_WATCHMAN_MODEL="..."
```

`SCRIPT_MODEL` / `ANIMATOR_MODEL` (or CLI `--script-model` / `--animator-model`) split LectureGen stages so script writing can use a different model than animation. Cloud video edits use `ANIMATOR_MODEL`, falling back to `AGENT_MODEL` when it is unset. A transient edit-provider failure crosses to `EDIT_FALLBACK_MODEL` (or the opposite-provider default). PracticeGen (IAGen/GameGen) also resolves `ANIMATOR_MODEL` / `--animator-model` with fallback to `--model` / `AGENT_MODEL`.

Shared generation calls fall back across providers for rate-limit and explicit capacity errors (`429`, `RESOURCE_EXHAUSTED`, `503`, `UNAVAILABLE`, or high-demand responses): Gemini uses `OPENAI_FALLBACK_MODEL` (default `gpt-5.6-luna`), and OpenAI uses a Gemini `LLM_FALLBACK_MODEL` (default `gemini-3.5-flash`). Other provider errors are retried on the active model and are not cross-provider fallback triggers.

Side-by-side script A/B (no animator):

```bash
npm run lecturegen -- --script-compare gpt-5.6-luna,gemini-3.5-flash "Explain binary search"
```

Writes `answer.md` once (first compare model), then `<safe-slug>/script.md` per model plus `compare.json`. Does not require `SCRIPT_TRIMMER_CHUNK_SIZE`. `--script-model` is ignored in compare mode (stderr warning).

`SCRIPT_TRIMMER_CHUNK_SIZE` is required when video output is selected:

- It must be a positive integer.
- It is the maximum narration-word count per animator block.
- The minimum block size is automatically half the maximum, rounded up.
- Missing, empty, invalid, or non-positive values fail before any LectureGen LLM call.
- Interactive/game-only runs do not read this variable.

Gemini models use native Gemini function calling in `editor-agent/coding_agent.ts`. `gpt-*` models use native OpenAI Responses API function calling. Other supported model names fall back to JSON tool execution through `utils/llm_model.ts`.

## IDE Generation and Editing Phases

The root `src/ide-server.ts` imports `generateLecture()` and `EditorAgent` programmatically.

Important routes:

```text
/lecturegen/generate    First request in a chat; generates selected lecture outputs.
/agent-chat             Follow-up edit requests after generation succeeds.
/agent-new-chat         Resets phase and allocates a new generation on next use.
/agent-upload           Saves browser-selected attachments into the active workspace.
/agent-state            Reports phase and current workspace.
```

The viewer starts with three output checkboxes. Video is selected by default;
Interactive and Practice game are opt-in. At least one must remain selected.
It also exposes an Image download checkbox. Its initial state comes from
`agent.enableGetimgTool` in root `config.yaml`, and its submitted state controls
getimg for that generation request.

The prompt starts with:

```text
Make a video on...
```

After generation succeeds it switches to edit mode and the prompt becomes an edit request surface. Generation controls are hidden during edit mode.

The IDE obtains the generation parent from `agent.generationDir` in the root configuration. It creates a unique timestamp-and-ID child folder and passes that exact folder to both `generateLecture()` and `EditorAgent`.

## LectureGen Pipeline

`lecturegen.ts` runs the selected stages in order:

1. Parse the request, selected outputs, aspect ratio, target length, theme, teaching style, and attachments.
2. If video is selected, validate `SCRIPT_TRIMMER_CHUNK_SIZE`.
3. If video is selected, run the answer generator and write `answer.md`.
4. Run the script writer, optional asset fetcher, script trimmer, retained animator, and validator/repair loop for selected video output.
5. If interactive is selected, generate `interactive.html` from `script.md`, or directly from the request when video is disabled.
6. If practice game is selected, generate `game.html` using the same reference-material rule.
7. Write `metadata.json`.

LectureGen is one-shot. It does not handle edit requests.

### Outputs

Each generation folder contains:

```text
answer.md
script.md
metadata.json
index.html

or, for multiple blocks:

index1.html
index2.html
...

interactive.html  When Interactive is selected.
game.html         When Practice game is selected.
assets/       Only when the script requested images.
uploads/      Copied or IDE-uploaded attachments.
```

IAGen and GameGen return only plain HTML code for their respective files. Those
files have no MyLecture contract and require no lifecycle hooks or globals. The
editor remains forbidden from creating files and its mutation boundary still
permits only `index*.html`.

### Script Format and Trimming

The script uses complete scene/beat structures:

```text
# Scene 1
N: Narration cue.
V: Associated visual cue.
```

Only `N:` narration words count toward chunk size. Visual descriptions, scene headings, and other text do not count.

The trimmer:

- never splits a narration/visual beat;
- targets the configured minimum-to-maximum range;
- rebalances the final chunk to avoid a tiny tail;
- prefers an oversized block over an undersized final block when beat boundaries make a perfect partition impossible;
- permits one short block only when the entire script is shorter than the configured minimum.

### Animator Context and Caching

The animator generates files sequentially in one retained `LectureGenLlmSession`.

- Each new block sees the earlier generation and repair exchanges in retained history.
- Attachments are added once and retained instead of being duplicated on every call.
- The stable growing request prefix allows provider prompt caching.
- Previous HTML is summarized in the newest user message because its complete generation remains in retained history.

The answer generator and script writer remain separate one-shot LLM calls because they use different system prompts.

### Asset Fetching

All asset behavior lives in `asset_fetcher.ts`.

Script requests use:

```text
[(getimg: 'short image description', out: 'assets/descriptive-name.png')]
```

Geographic maps use the bundled Natural Earth asset `assets/world-basemap.svg`
(copied into every video workspace). See `.agents/mylecture-visuals/world-map-basemap.md`.

Pass `--no-getimg` to the LectureGen CLI to:

- instruct the script writer not to request getimg images;
- strip any getimg directives that still appear; and
- skip external image fetching (bundled world basemap is still provided).

The asset fetcher supports search and AI generation internally, can run Watchman verification, and records local path, dimensions, format, and byte size for the animator.

## Editor Agent

The editor agent starts only after LectureGen succeeds.

Its system prompt is `src/prompts/system_prompt.md`. That prompt includes the full animator quality guidance and canonical HTML contract through backticked prompt-builder references.

The editor may:

- read workspace files;
- list the workspace when necessary;
- edit existing workspace-root `index.html` or `indexN.html`.

The editor may not:

- generate a lecture;
- invoke a script sub-agent;
- create or delete files or directories;
- fetch images;
- edit `answer.md`, `script.md`, `metadata.json`, assets, uploads, audio, resolved HTML, or rendered outputs;
- edit nested or non-index HTML paths.

The restriction is enforced by `editor-agent/tools/tool_registry.ts`, not merely by the prompt.

### Active Editor Tools

The active registry tools are:

```text
read
edits
list_dir
```

`cmd` exists but is inactive and is not exposed in native Gemini declarations, JSON fallback schemas, or the generated tool section.

The `edits` runtime accepts only workspace-root names matching:

```text
index.html
index1.html
index2.html
...
```

### Edit Semantics

`read` returns line-numbered text; the line numbers are not part of the file.

`edits` ranges refer to the original file state at the start of that tool call:

```text
[a, b]  Replace or delete inclusive lines a through b.
[a]     Insert after line a.
[0]     Insert before line 1.
```

Batch compatible edits to one file in one call. Avoid overlapping ranges.

## HTML Contract and Validation

The canonical contract is:

```text
.agents/mylecture-contracts/html-input-contract.md
```

Typical globals:

```js
window.__VIDEO_METADATA__ = {
  contractVersion: "0.2",
  title: "Lecture Title",
  aspectRatio: "16:9"
};

window.__VIDEO_PLAN__ = [];
window.__RENDER_SECTION__ = function renderSection(segment, localTime, globalTime) {};
```

Requirements:

- deterministic state driven by `localTime` and `globalTime`;
- no wall-clock animation, randomness, or unbounded asynchronous state;
- normal HTML attributes such as `class="stage"`, never literal escaped markup quotes;
- no informational overlap or unreadable overflow;
- never draw or embed subtitles in lecture HTML; subtitle burning is a render-stage IDE option;
- collision-resistant narration IDs such as `i1_1`, `i1_2`, `i2_1`;
- local asset paths only.

The validator runs after LectureGen animation and repair and after every successful editor `edits` call. It samples multiple local times in each segment to catch runtime-only failures such as invalid Canvas values that appear after time zero.

Do not claim completion while validation is failing.

## Prompt Builder

`src/prompt_builder.ts` is shared infrastructure and contains its own direct-run CLI control.

Every model-bound system and user prompt should pass through `build_prompt()`.

It:

- resolves readable local paths wrapped in backticks;
- inlines UTF-8 text files;
- leaves supported binary files for provider upload;
- removes hidden attachment directives from model-visible text;
- extracts image, PDF, and video attachment metadata.

Run it directly to inspect the expanded prompt:

```powershell
npm run --silent prompt-builder -- --workspace "D:\path\to\workspace" "Use `notes.md`"
```

There is no separate prompt-builder CLI module or prompt-builder Markdown documentation file. Keep its operational description in the module docstring.

## Attachments

Supported uploads:

```text
images: .png, .jpg, .jpeg, .webp, .bmp
documents: .pdf
videos: .mp4, .mpeg, .mpg, .mov, .avi, .webm, .wmv, .3gp, .3gpp, .flv
```

Only explicit directives trigger provider upload:

```text
[(attachment: C:\absolute\path\to\file.png)]
```

Backticked, quoted, and plain paths are text references only.

The IDE saves uploads in the active generation workspace's `uploads/` folder. The LectureGen API copies externally supplied attachments into that workspace when necessary.

Gemini retains uploaded file parts in chat history. The OpenAI-compatible fallback rejects video attachments.

## Final-Response Isolation

## Final Response Handling

When the editor agent completes its HTML edits, it summarizes its changes directly. No intermediate `prepare_user_response` tool signal is required.

## Logging and Token Tracking

All file-based logs belong under:

```text
packages/lecture-agent/.log/
```

Current locations:

```text
.log/current-session.json
.log/session-*/                 Full LLM request logs when enabled.
.log/token-tracker/token_usage.db
```

Never create `.log` under `src/`.

`LOG_FULL_LLM_PROMPT=True` enables full request logging. Token-tracker session IDs are shared across LectureGen stages and the editor session for cost inspection.

## Ignored and Generated Content

Do not treat these as source:

```text
.log/
workspace/
.tmp/
dist/
node_modules/
src/editor-agent/tools/lib/poppler-25.11.0/
```

The extracted Poppler directory is intentionally ignored at its relocated path. Do not add its thousands of extracted files to Git.

## Development Rules

- Read relevant files before editing.
- Preserve unrelated user changes in the working tree.
- Use `rg` for search.
- Use `apply_patch` for manual source edits.
- Keep TypeScript ESM imports with `.js` suffixes where existing source does.
- Keep API and direct-run CLI controls in `lecturegen.ts`; do not recreate separate LectureGen API or CLI files.
- Keep prompt-builder CLI control inside `prompt_builder.ts`.
- Keep all image acquisition behavior inside `asset_fetcher.ts`; do not recreate `image_fetcher.ts`.
- Keep LectureGen and prompt-builder descriptions in module docstrings, not standalone Markdown files.
- Do not reintroduce the script sub-agent or `run_script_agent`.
- Keep editor mutation restrictions in runtime code as well as prompt text.
- When changing prompts, schemas, attachments, or final-response behavior, verify Gemini native, OpenAI native, and JSON fallback paths.

## Verification

Package checks:

```powershell
npm test
npm run lecturegen -- --help
npm run editor-agent -- --help
npm run prompt-builder -- --help
```

Root checks:

```powershell
npx tsc --noEmit -p tsconfig.json
npm --prefix packages/lecture-viewer run build
```

When changing validation or generated HTML behavior, run the validator against a known-good contract fixture and a known-bad runtime fixture.

When changing viewer or IDE behavior, rebuild `packages/lecture-viewer/dist/` and verify both phases:

```text
generate -> /lecturegen/generate
edit     -> /agent-chat
```
