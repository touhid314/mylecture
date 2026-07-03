# MyLecture Lecture Agent Guide

This package contains the TypeScript coding agent used by MyLecture IDE. The agent writes and edits lecture deliverables inside its own workspace, while the IDE server in the repository root launches it, streams logs, uploads attachments, archives output folders, and previews/resolves/renders the generated HTML.

Use this file as the first orientation document before changing code in `packages/lecture-agent`.

## Package Layout

```text
src/
  cli.ts                         CLI entrypoint for one-shot and chat mode.
  coding_agent.ts                Main agent sessions, tool loop, Gemini native path, JSON fallback path.
  llm_model.ts                   Provider wrapper used by the JSON fallback/OpenAI-compatible path.
  prompt_builder.ts              Prompt preparation, backticked file inlining, attachment directive parsing.
  workspace.ts                   Env loading and workspace path resolution.
  llm_prompt_logger.ts           Optional full prompt/request logging.
  tools/
    index.ts                     Tool dispatcher and response compaction.
    read.ts write.ts edits.ts    Workspace file tools.
    mkdir.ts list_dir.ts del.ts  Workspace directory tools.
    cmd.ts                       Source exists, but `cmd` is not exposed in normal schemas.
    utils/schemas.ts             Tool schemas for Gemini native function calling and JSON fallback.
    utils/html_contract.ts       Auto-validates lecture HTML writes/edits.
  prompts/
    system_prompt.md             Runtime system prompt for lecture generation.
    pre-user-response-prompt.md  Final response isolation prompt.

.agents/
  mylecture-contracts/html-input-contract.md
  mylecture-themes/
  mylecture-teaching-style/
  mylecture-profiles/

workspace/agent-workspace/       Default editable workspace for generated lectures.
.tmp/uploads/                    IDE-saved uploaded attachments.
```

## How The Agent Is Used

Run from the monorepo root unless a command says otherwise:

```powershell
npm run agent -- "Create a short lecture about binary search"
npm run chat
npm run ide
```

Package-local commands:

```powershell
npm run agent -- "Create a short lecture about binary search"
npm test
```

Important root commands:

```powershell
npx tsc --noEmit
npm test
npm run build:plan -- --input path\to\index.html --out path\to\resolved.html
npm run render:video -- --html path\to\index.html --out output.mp4
```

`npm run ide` is the normal local UI flow. It builds the viewer, starts `src/ide-server.ts` from the repo root, then sends chat requests to this package as a child process.

## Environment

Root `.env` is loaded by walking upward from `src/workspace.ts`.

Common variables:

```env
GOOGLE_API_KEY="..."
OPENAI_API_KEY="..."
AGENT_MODEL="gemini-3.5-flash"
AGENT_WORKSPACE="optional absolute workspace override"
AGENT_WORKSPACE_DIR="optional absolute workspace override"
LOG_FULL_LLM_PROMPT="True"
```

Gemini models use native Gemini function calling in `coding_agent.ts`. Non-Gemini models use the JSON fallback path through `llm_model.ts`.

## Workspace Boundaries

The agent's default editable workspace is:

```text
packages/lecture-agent/workspace/agent-workspace/
```

Workspace tools resolve all tool paths relative to the active workspace and reject escapes. Generated lecture files should be written at the workspace root unless the user asks for a folder.

Prompt building may read selected local files from broader known locations when the user references them, but normal tool operations must stay inside the workspace.

Do not treat ignored output directories as source:

```text
workspace/agent-workspace/
.tmp/
node_modules/
```

## Runtime Tool Contract

The exposed tools are defined in `src/tools/utils/schemas.ts`:

```text
read
write
edits
mkdir
list_dir
del
```

`cmd.ts` is present in source for old/experimental behavior, but it is not part of the normal registered schema. Do not assume the runtime model can call it.

Tool rules that matter:

- Use `write` only to create a file.
- Use `edits` for existing files or follow-up changes.
- Batch known edits to the same file into one `edits` call.
- `read` output contains line numbers for reference only; those numbers are not part of the file.
- `read` accepts optional `start_line` (1-indexed) and `limit` to return a slice of large files; output line numbers still match the original file.
- `edits` line numbers refer to the original file state before that edit call.
- HTML contract validation runs after successful writes/edits to relevant `index*.html` files; fix validation failures before claiming completion.

When adding a new tool:

1. Implement it under `src/tools/`.
2. Add its schema to `src/tools/utils/schemas.ts`.
3. Register dispatch and compaction in `src/tools/index.ts`.
4. Update `src/prompts/system_prompt.md` so the JSON fallback path and model guidance know about it.
5. Run `npx tsc --noEmit` and the relevant smoke tests.

## Attachment Handling

IDE uploads are handled by the root IDE server, not directly by browser-to-model code.

Flow:

```text
viewer drag/drop, picker, or paste
  -> POST /agent-upload
  -> saved under packages/lecture-agent/.tmp/uploads/
  -> viewer appends hidden [(attachment: absolute_path)] directives
  -> prompt_builder extracts supported attachments
  -> provider path uploads files separately from text prompt
```

Supported attachment extensions:

```text
images: .png, .jpg, .jpeg, .webp, .bmp
documents: .pdf
videos: .mp4, .mpeg, .mpg, .mov, .avi, .webm, .wmv, .3gp, .3gpp, .flv
```

Only explicit directives like this trigger binary upload:

```text
[(attachment: C:\absolute\path\to\file.png)]
```

Backticked paths, quoted paths, and plain paths are text references only. Binary file contents are not pasted into the prompt.

Current session behavior:

- Gemini native function-calling uploads each attachment through the Gemini Files API and keeps the resulting `fileData` parts in retained chat history so follow-up turns can keep discussing the same image/PDF/video.
- The JSON fallback path stores attachment metadata in message history and re-uploads from local disk when needed.
- OpenAI-compatible fallback rejects video attachments; use a Gemini model for video input.

## Final Response Isolation

The working agent sees operational context: system prompts, tool outputs, paths, file contents, logs, and generated code. The user-facing final response must stay isolated.

`coding_agent.ts` enforces this by generating final user responses through `pre-user-response-prompt.md`, using the raw user queries with IDE context stripped. Preserve this boundary when changing agent loop behavior.

## Lecture Deliverable Contract

Generated lecture work normally follows this sequence inside the workspace root:

```text
answer.md        Simple text-only chatbot-style answer.
script.md        Full AV script.
index1.html      First lecture segment.
index2.html      Additional segment when needed.
...
interactive.html Only if explicitly requested.
game.html        Only if explicitly requested.
```

Use `script.md`, not the misspelled `scrip.md`.

Script format:

```text
AUDIO: One narration sentence.
VISUAL: Incremental visual action that supports that sentence.
```

Narration planning:

- About 150 words of audio narration equals about 1 minute of video.
- Split longer lectures into `index1.html`, `index2.html`, etc. by minute-scale segment.
- Keep scene continuity. Do not switch to a totally new visual scene for every sentence.
- Visuals should be deterministic and driven by the contract timing values, not wall-clock time.

HTML requirements:

- Follow `.agents/mylecture-contracts/html-input-contract.md`.
- Default aspect ratio is `16:9` unless the IDE/user specifies otherwise.
- Use the dark theme guidance in `.agents/mylecture-themes/dark-theme.md` unless instructed otherwise.
- Do not embed subtitles unless explicitly requested.
- Use KaTeX for math when appropriate.
- In HTML source, write normal attributes like `class="stage"`, not escaped quotes like `class=\"stage\"`.
- Avoid overflow, overlap, unstable layout, and animations that change based on real time or randomness.

Audio IDs should be collision-resistant across scene files, for example:

```text
s1_1, s1_2, s2_1, s2_2
```

## Interactive And Game Files

Only create `interactive.html` or `game.html` when the user explicitly asks for an interactive or game.

Interactive:

- Full-screen HTML.
- Clear interaction affordances.
- Large readable UI.
- Use the same topic as the lecture unless the user says otherwise.

Game:

- Full-screen HTML.
- Clear mission overlay at the start.
- Score out of 100.
- Game mechanics must teach or reinforce the requested topic.

## Prompt Resources

Shared prompt resources live under `.agents/`.

Profiles:

```text
.agents/mylecture-profiles/*.md
```

The IDE loads these and appends the selected profile content to the hidden agent prompt. If profile is `None`, nothing is appended.

Contracts and themes:

```text
.agents/mylecture-contracts/html-input-contract.md
.agents/mylecture-themes/dark-theme.md
.agents/mylecture-themes/light-theme.md
.agents/mylecture-teaching-style/default.md
```

Keep these files small and explicit. They are consumed by prompt-building/runtime behavior and by future agents.

## Development Guidance

- Read relevant files before editing.
- Prefer current local patterns over new abstractions.
- Keep changes scoped; this package is used interactively by the IDE.
- Do not revert unrelated local changes.
- Use `rg` for searching.
- Use `apply_patch` for manual edits.
- Keep TypeScript ESM imports with `.js` suffixes where the existing code does.
- When changing schemas, prompt behavior, attachment parsing, or final response behavior, consider both Gemini native and JSON fallback paths.

Verification expectations:

```powershell
npx tsc --noEmit
npm --prefix packages/lecture-agent test
```

Run broader root tests when changes touch generated HTML contracts, render/build integration, or IDE behavior:

```powershell
npm test
```

When editing viewer UI or IDE server behavior outside this package, follow the root repository guide and rebuild the viewer:

```powershell
npm --prefix packages/lecture-viewer run build
```
