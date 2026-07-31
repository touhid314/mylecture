# MyLecture IDE - Repository Guide

This repository is an npm workspaces monorepo for creating, previewing, editing, resolving, rendering, and publishing browser-authored lecture videos. Lectures are not authored as video timelines directly. They are authored as contract-compliant HTML files, then resolved into timed HTML with audio metadata, then rendered to MP4 through Playwright and ffmpeg.

Use this file as the first orientation document before changing code.

## Mental Model

The core loop is:

```text
user prompt or manual edit
  -> lecture-agent writes/edits files in packages/lecture-agent/workspace/agent-workspace
  -> IDE previews source/resolved HTML through lecture-viewer
  -> build-plan resolves narration/audio/timeline into resolved*.html
  -> render-video captures deterministic browser frames and muxes MP4
  -> outputs are archived or published
```

The browser IDE is a local control surface over those pieces. It does not run the agent in the browser. The IDE server receives chat messages, adds current file/folder context, starts the agent as a child process, streams logs, and refreshes files.

## Top-Level Layout

```text
src/
  ide-server.ts          Local HTTP server for the IDE and agent bridge.
  build-plan.ts          Resolves source HTML plans into timeline-ready HTML.
  render-video.ts        Deterministic browser-frame renderer and MP4 muxer.
  subtitle-burner.ts     Burns subtitles into video outputs.
  sync-versions.ts       Keeps version constants/contracts synchronized.
  utils/tts.py           Python TTS helper used by the resolve/render pipeline.
  social/                Upload/token helper scripts.

packages/
  lecture-agent/         TypeScript coding agent and its workspace.
  lecture-viewer/        Browser viewer/player UI packaged as generated HTML.

tests/
  fixtures/              Contract, render, visual, and plan-pipeline fixtures.

docs/
  research-demos/        Example outputs and experiments.
  social-logo/           Branding images.

.render/                 Temporary render/test artifacts. Ignored.
outputs/                 Generated output archives. Ignored.
models/                  Optional local model assets, such as Kokoro ONNX. Ignored.
```

## Main Commands

Run commands from the repository root unless noted.

```powershell
npm install
npm run ide
npm run agent -- "Create a short lecture about binary search"
npm run chat
npm run build:plan -- --input path\to\index.html --out path\to\resolved.html
npm run render:video -- --html path\to\index.html --out output.mp4
npm test
npx tsc --noEmit
```

`npm run ide` runs:

```text
npm run version:sync
npm run build:viewer
node --import tsx src/ide-server.ts
```

The default IDE URL is `http://127.0.0.1:4307/`. If that port is busy, pass `-- --port <port>`.
The server remains localhost-only by default. To access it from another device
on a trusted local network, pass `-- --host 0.0.0.0`; startup output lists the
LAN URLs. The IDE has no authentication, so do not expose it on an untrusted
network.

## Environment

Root `.env` is loaded by the agent by walking upward from `packages/lecture-agent/src/coding_agent.ts`.

Common variables:

```env
GOOGLE_API_KEY="..."
OPENAI_API_KEY="..."
AGENT_MODEL=""
GPT_REASONING_EFFORT="none"
# GPT_SERVICE_TIER="fast"  # OpenAI only; omit when unset. Prefer fast; priority is a backwards-compatible alias
LOG_FULL_LLM_PROMPT="True"
```

Gemini models use native Gemini function calling. Model names starting with `gpt-` use native OpenAI Responses API function calling in `packages/lecture-agent/src/editor-agent/coding_agent.ts`.

For OpenAI reasoning models (for example `gpt-5.6-luna`), set `GPT_REASONING_EFFORT` to one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. When unset, the stack defaults to `none` to match Gemini 3.5 Flash (no extended thinking budget configured).

To enable OpenAI Fast mode, set `GPT_SERVICE_TIER="fast"` (recommended) or `"priority"` (OpenAI's backwards-compatible alias). OpenAI-only; ignored for Gemini. This is separate from `GPT_REASONING_EFFORT`. When unset or empty, `service_tier` is omitted and the API uses its default behavior. Invalid values are ignored with a warning.

## IDE Server

[src/ide-server.ts](src/ide-server.ts) is the local-only HTTP server bound to `127.0.0.1`.

Primary responsibilities:

- Serves the main viewer HTML from `packages/lecture-viewer/src/index.ts`.
- Serves selected local files under `/files/...`.
- Serves package viewer assets under `/lecture-viewer/...`.
- Maintains current viewer state: selected file, viewport width, viewport height, version.
- Browses folders and sibling files for the left/sidebar file browser.
- Opens folders and files through native OS affordances.
- Runs `build-plan.ts` for resolve jobs.
- Runs `render-video.ts` for render jobs.
- Runs publish commands against the sibling website repo.
- Starts/stops the coding agent as a child process.
- Buffers agent stdout/stderr for `/agent-log`.
- Watches the agent workspace and live-syncs generated file changes to the active output folder.

Important routes:

```text
/ or /viewer              Serve IDE shell.
/viewer-state             Poll selected-file state.
/open-file                Change selected preview file.
/folder-files             List files next to the selected file.
/browse-folder            Browse arbitrary local directories.
/open-folder              Open a folder in the native file explorer.
/resolve-file             Resolve index*.html to resolved*.html.
/render-file              Render current lecture HTML to MP4.
/stop-job                 Stop active resolve/render/agent/publish job.
/agent-new-chat           Kill active agent, clear agent workspace, mark next agent run new-session.
/agent-upload             Save browser-selected attachments for the agent.
/agent-profiles           Return prompt profile markdown files.
/agent-chat               Send IDE context plus user message to the coding agent.
/agent-log                Return buffered agent process logs.
/pick                     Windows-native file picker.
/list-courses             Ask website admin script for courses.
/publish-lecture          Publish rendered lecture folder to website repo.
```

Long-running jobs share one `activeJob` slot. `killProcessTree` is used on Windows so child processes do not remain orphaned.

## Lecture Viewer Package

`packages/lecture-viewer/` contains the browser player and generated IDE HTML.

Key files:

```text
packages/lecture-viewer/src/viewer-html.ts       Main IDE/viewer HTML template.
packages/lecture-viewer/src/player/index.ts      Player runtime and timeline control.
packages/lecture-viewer/src/index.ts             Export entry.
packages/lecture-viewer/dist/                    Built package output.
```

When editing `packages/lecture-viewer/src/*`, run:

```powershell
npm --prefix packages/lecture-viewer run build
```

The server imports source directly, but `dist/` is part of the package output and should be kept in sync when viewer source changes.

### Viewer UI

The IDE has:

- Preview frame for HTML/MP4/document files.
- Timeline and playback controls.
- File/folder browser.
- Resolve/render/publish controls.
- Agent chat sidebar.

The agent chat sidebar supports:

- Text prompts.
- Drag/drop image/PDF/video attachments.
- File-picker attachments.
- Clipboard image paste into the prompt box.
- Aspect ratio selection.
- Logarithmic generation length slider from `5s` to `15:00`.
- Editable length text input; accepted examples include `90`, `90s`, `1:30`, `2m`.
- Prompt profile dropdown loaded from markdown files.

The generation controls are appended to the prompt sent to the agent, not displayed in the visible chat bubble:

```text
if the user query is for video generation then follow this:
aspect ratio: <selected>
generation length: <selected>
profile: <profile markdown content, only when selected>
```

If profile is `None`, no `profile:` line is appended.
Subtitles are not generated into lecture HTML. The Render options menu owns
subtitle burning, including font, font size, and centered distance from the
bottom of the frame. Its defaults come from `render.burnSubtitle`,
`render.subtitleFont`, `render.subtitleFontSize`, and
`render.subtitleBottomPercent` in root `config.yaml`.

## Agent Profiles

Profiles are markdown files stored under:

```text
packages/lecture-agent/.agents/mylecture-profiles/*.md
```

The IDE server exposes them through `/agent-profiles`. The viewer loads the list at startup and stores each profile's content in browser memory. Selecting a profile appends its file content to the agent prompt under `profile: ...`.

The default profile is `None`.

## Agent Attachments

The lecture agent itself understands explicit attachment directives:

```text
[(attachment: C:\absolute\path\to\file.png)]
```

The IDE chat hides that syntax from the user:

1. Browser receives files from drag/drop, picker, or clipboard image paste.
2. Browser calls `/agent-upload` with multipart form data.
3. `src/ide-server.ts` saves files under:

   ```text
   packages/lecture-agent/workspace/agent-workspace/uploads/
   ```

4. Server returns absolute file paths.
5. Viewer appends directives to the message sent to `/agent-chat`.
6. `packages/lecture-agent/src/prompt_builder.ts` extracts those directives.
7. `packages/lecture-agent/src/coding_agent.ts` uploads files to the model provider separately from prompt text.

Supported upload extensions:

```text
images: .png, .jpg, .jpeg, .webp, .bmp
documents: .pdf
videos: .mp4, .mpeg, .mpg, .mov, .avi, .webm, .wmv, .3gp, .3gpp, .flv
```

Backticked paths, quoted paths, and plain paths do not trigger binary upload. They are only text.

## Lecture Agent Package

`packages/lecture-agent/` is a TypeScript coding agent with local workspace tools.

Key files:

```text
packages/lecture-agent/src/coding_agent.ts
packages/lecture-agent/src/llm_model.ts
packages/lecture-agent/src/prompt_builder.ts
packages/lecture-agent/src/llm_prompt_logger.ts
packages/lecture-agent/src/prompts/system_prompt.md
packages/lecture-agent/src/prompts/pre-user-response-prompt.md
packages/lecture-agent/src/tools/
packages/lecture-agent/src/tools/utils/workspace.ts
```

Main tools:

```text
read
write
edits
mkdir
list_dir
del
prepare_user_response
```

`cmd` exists in source but is intentionally not part of the normal registered schema in the current agent behavior. Check current schemas before assuming it is available to the model.

### Agent Workspace

The agent's editable workspace is:

```text
packages/lecture-agent/workspace/agent-workspace/
```

Tool file operations are restricted to that folder. The shared prompt/resources area under `packages/lecture-agent/.agents/` may be read and inlined by prompt-building code, but normal generated lecture files go in `agent-workspace`.

New chat behavior:

- IDE `New Chat` calls `/agent-new-chat`.
- The server clears `agent-workspace`.
- The next agent process receives `--new-session`/`AGENT_NEW_SESSION=True`.
- Restarting the IDE also marks the first agent request as a new session.

Follow-up prompts do not clear `agent-workspace`.

### Archiving And Live Sync

After a completed agent response, the current `agent-workspace` is archived under:

```text
outputs/<title-slug>-<unique-id>/
```

The workspace is not cleared after archiving. It remains the active working directory for follow-ups.

The IDE server also watches `agent-workspace`. If there is an active output folder, changed files are copied there quickly so the viewer can update while the agent works.

### Final Response Isolation

The working agent sees sensitive operational context: system instructions, tool results, file contents, generated code, command output, workspace paths, and logs.

The final user-facing answer is isolated:

1. Working agent must call `prepare_user_response`.
2. Runtime treats that tool as a boundary.
3. A separate LLM call is made with:
   - `src/prompts/pre-user-response-prompt.md`
   - raw user queries with IDE `[Context: ...]` blocks stripped
4. The final response call does not receive tool outputs, generated files, hidden prompts, paths, or working transcript.

If the model tries to answer directly without `prepare_user_response`, the runtime does not return the direct answer. It injects a correction telling the model to call `prepare_user_response` and continues the tool loop.

## Prompt Builder

`packages/lecture-agent/src/prompt_builder.ts` handles:

- Inlining backticked text/code files as UTF-8 into prompts.
- Stripping `[(attachment: ...)]` directives from prompt text.
- Validating supported image/PDF/video attachments.
- Returning attachment metadata for provider-specific upload.

Binary uploads are attached to the model separately. They are not pasted into the text prompt.

## HTML Lecture Contract

Generated lecture HTML must follow the MyLecture HTML input contract, currently v0.2. The canonical contract lives under the agent workspace resources:

```text
packages/lecture-agent/.agents/mylecture-contracts/html-input-contract.md
```

Typical globals:

```js
window.__VIDEO_METADATA__ = {
  contractVersion: "0.2",
  title: "Lecture Title",
  aspectRatio: "16:9",
};

window.__VIDEO_PLAN__ = [
  // narration+visual, visual-only, interactive, or game segments
];

window.__RENDER_SECTION__ = function renderSection(
  segment,
  localTime,
  globalTime,
) {
  // Deterministic visual state based on time.
};
```

Rendering expects deterministic visuals. Do not rely on wall-clock time, CSS animations, random state, or unbounded async behavior for frame output. Motion should be computed from `localTime`/`globalTime`.

## Resolve Pipeline

[src/build-plan.ts](src/build-plan.ts) reads a source HTML file, extracts the video plan, generates or reuses narration audio, measures durations, and writes resolved HTML.

Common inputs:

```text
index.html      Source file.
resolved.html   Timeline-ready output.
audio/*.wav     Generated narration clips.
```

Resolve can be called from the IDE or manually:

```powershell
npm run build:plan -- --input path\to\index.html --out path\to\resolved.html
```

TTS provider/voice/speed are normalized in `ide-server.ts` before invoking `build-plan.ts`. Kokoro-style voices use local Kokoro; OpenAI and Google voice names route to cloud providers.

## Render Pipeline

[src/render-video.ts](src/render-video.ts) uses Playwright to load HTML, evaluate deterministic frame states, capture frames, and mux audio/video with ffmpeg.

`src/render-video.ts` exports a programmatic renderer API:

```ts
renderVideo(options);
parseArgs(argv);
defaultRenderVideoOptions();
normalizeRenderVideoOptions(options);
```

Keep the CLI as a thin wrapper around `renderVideo(options)` for manual testing and scripts. Do not put server queueing, request concurrency, or IDE job policy inside the renderer; those belong in `src/ide-server.ts`.

Common command:

```powershell
npm run render:video -- --html path\to\index.html --out output.mp4
```

Useful options include:

```text
--width <pixels>
--height <pixels>
--fps <number>
--max-frames <number>
--skip-video
--workers <number>
--render-mode <stateful|stateless|sequential>
--tts-voice <voice>
--tts-speed <number>
```

Frame rendering defaults to `--render-mode stateful`. In this mode, workers capture contiguous frame ranges and warm up by replaying earlier frames without screenshots before capturing their assigned range. This makes renderer output stable for lecture files whose visual state accidentally depends on earlier `renderAt` calls, while still allowing parallel screenshot capture.

Render modes:

```text
stateful     Default. Parallel chunk rendering with warmup replay for stateful HTML.
stateless    Fastest old scheduler. Frames may be assigned dynamically across workers; requires each renderAt(time) call to fully define the frame.
sequential   One page renders every frame in order. Slowest but closest to live playback.
```

The CLI default worker count is the logical CPU count. For heavy Playwright rendering, start with physical-core count or lower when tuning performance. The IDE batch render path may also run multiple scene render processes in parallel, so avoid assuming `--workers` is the only source of render concurrency.

The IDE server queues `/render-file` jobs before spawning renderer child processes. `RENDER_MAX_PARALLEL` controls how many render jobs may run concurrently across tabs; the default is `1` to avoid output and temporary-frame collisions. This queue is intentionally server-owned, not renderer-owned.

The root test scripts exercise build, render, visual-only, and narration paths.

## Publishing

The IDE publish flow is in `src/ide-server.ts`.

It assumes a sibling website repository:

```text
../mylecture-website
```

The IDE calls website admin scripts such as:

```text
scripts/admin.mjs list
scripts/admin.mjs upload-lecture ...
```

The server sends metadata such as course, slug, title, description, module, order, thumbnail, published state, and source directory.

## Testing And Validation

Common checks:

```powershell
npx tsc --noEmit
npm --prefix packages/lecture-viewer run build
npm test
```

Package-specific agent tests are controlled by `packages/lecture-agent/package.json`. If a package test references a missing smoke file, inspect current uncommitted changes before recreating or deleting files.

Renderer smoke scripts:

```powershell
npm run test:build
npm run test:render
npm run test:visual
npm run test:narration
```

When changing viewer source, always rebuild `packages/lecture-viewer/dist/`.

When changing agent prompt/runtime behavior, test both:

- Gemini native function-calling path.
- JSON fallback path if the changed code touches generic model parsing or prompt schemas.

## Git And Generated Files

Be careful with this repo because agent output and test output can produce many files.

Ignored or generated areas include:

```text
node_modules/
.render/
.tmp/
outputs/
models/kokoro-onnx/
packages/lecture-agent/.tmp/
packages/lecture-agent/workspace/agent-workspace/
```

Do not revert unrelated local changes. This repo is often used interactively through the IDE and agent, so uncommitted changes may belong to the user or an active generation.

## Development Notes For Future Agents

- Prefer existing patterns in `src/ide-server.ts` and `packages/lecture-viewer/src/viewer-html.ts`; the viewer is a single generated HTML template, not a component app.
- Use `rg` for search and `apply_patch` for manual edits.
- After viewer UI edits, run `npm --prefix packages/lecture-viewer run build`.
- After TypeScript edits, run `npx tsc --noEmit`.
- For local IDE behavior, inspect both server route code and browser template code.
- Keep browser-visible chat text separate from hidden prompt augmentation.
- Keep profile `None` behavior silent; do not append `profile:none`.
- Keep binary attachments as files/directives; do not inline them into prompt text.
- Keep final response isolation intact. The working agent should signal completion with `prepare_user_response`; the runtime generates the user-facing answer separately.
