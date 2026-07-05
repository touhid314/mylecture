# Course Generator Runbook

Use these commands from the `mylecture/` package root.

Before changing coursegen behavior or prompts, read `docs/coursegen-principles.md`. It explains the generalization-first product goals that should guide agent edits.

## Setup

1. Install dependencies:
   ```powershell
   npm install
   ```
2. Configure `.env`:
   ```env
   OPENAI_API_KEY="..."
   GOOGLE_API_KEY="..."
   AGENT_MODEL="gemini-3.5-flash"
   ```
3. Check the CLI surface:
   ```powershell
   npm run coursegen -- --help
   ```
4. Optional local UI (easier than memorizing flags):
   ```powershell
   npm run coursegen:ui
   ```
   Opens at `http://127.0.0.1:3940`. Set `COURSEGEN_UI_PORT` in `.env` to use another port.

## Core Workflow

1. Plan the course:
   ```powershell
   npm run coursegen -- plan --topic "Fractions" --lectures 12 --budget 5
   ```
2. Extend an existing course (planner proposes the next module from the syllabus):
   ```powershell
   npm run coursegen -- extend --course <course-slug>
   ```
   Optional hints: `--topic`, `--scope`, `--module-title`, `--placement auto|append-last|new-module`, `--lectures 3`
3. Inspect the generated plan and course slug:
   ```powershell
   npm run coursegen -- status --course <course-slug>
   ```
4. Iterate on script prompts before rendering:
   ```powershell
   npm run coursegen -- script --course <course-slug> --lecture <lecture-slug>
   ```
5. Generate lectures, videos, and practice activities:
   ```powershell
   npm run coursegen -- run --course <course-slug> --yes
   ```
   By default this resolves narration (HTML + audio) and builds practice assets, but does **not** mux MP4. Add `--render` when you want video files.
6. Resume after interruption or after fixing failed items:
   ```powershell
   npm run coursegen -- resume --course <course-slug> --yes
   ```
7. Render MP4 from existing resolved HTML (no re-resolve, no practice regen):
   ```powershell
   npm run coursegen -- render --course <course-slug> --yes
   ```
   Optional: `--force-lecture <slug>` for one lecture only.
8. Build or refresh sidecar captions for website CC (from resolved HTML, no render):
   ```powershell
   npm run coursegen -- captions --course <course-slug>
   ```
   Optional: `--lecture <slug>` for one lecture. Re-publish afterward to upload `captions.vtt`.
9. Publish as a draft:
   ```powershell
   npm run coursegen -- publish --course <course-slug> --yes
   ```
8. Make an uploaded course public:
   ```powershell
   npm run coursegen -- publish --course <course-slug> --go-live --yes
   ```

Generated course state and artifacts live in `gens/courses/<course-slug>/`.

## Planning Parameters

- `--topic <text>`: Required subject or unit title.
- `--audience <level>`: Optional override for inferred learner level; one of `early`, `elementary`, `middle`, `general`, `undergraduate`, `graduate`.
- `--intent <name>`: Optional override for inferred learning intent; one of `foundation`, `academic`, `practice`, `exam`, `professional`, `exploration`, `teaching`.
- `--scope <text>`: Optional boundary for the course, such as “introductory naming and visual models only”.
- `--lectures <n>`: Target lecture count from `1` to `30`. Defaults to `12`.
- `--budget <usd>`: Default run budget stored with the course plan. Defaults to `5`.
- `--model <name>`: Overrides `AGENT_MODEL` for planning.
- `--dry-run`: Prints planning prompts without creating course files.

## Extend Parameters

- `--course <slug>`: Required existing course slug.
- `--topic <text>`: Optional hint for what to add; if omitted, the planner infers the best continuation.
- `--scope <text>`: Optional hint to narrow the new module.
- `--module-title <text>`: Optional preferred module title hint.
- `--placement <mode>`: `auto` lets the planner decide whether to append to an existing module or create a new one. `append-last` forces new lectures into the current final module. `new-module` forces a new module.
- `--lectures <n>`: Target count of **new** lectures to add (default `3`, max total course size `30`).
- `--model <name>`: Overrides `AGENT_MODEL`.
- `--dry-run`: Prints extension prompts without updating `course-plan.json`.

After extending, run or resume generation to build only the new `pending` lectures.

## Run and Resume Parameters

- `--course <slug>`: Required course slug from the planning step.
- `--yes`: Skips confirmation prompts.
- `--budget <usd>`: Overrides the saved run budget.
- `--max-turns <n>`: Agent turn cap per video lecture. Defaults to `60`.
- `--max-practice-turns <n>`: Agent turn cap per interactive or game pass. Defaults to `40`.
- `--lecture-timeout <min>`: Generation timeout per lecture. Defaults to `20`.
- `--retry-failed`: Retries failed lectures. `resume` enables this automatically.
- `--render`: Renders MP4 after resolve. Default is resolve-only (HTML + audio + practice, no video mux).
- `--force-lecture <slug>`: Regenerates one lecture, ignoring budget and attempt caps.
- `--skip-practice-review`: Skips screenshot QA for interactives and games. Use for development only.
- `--tts-voice <voice>`: Overrides narration voice for render. Default: `american-male-3`.
- `--tts-speed <speed>`: Overrides narration speed for render.
- `--model <name>`: Overrides `AGENT_MODEL` for generation and review.
- `--dry-run`: Prints per-lecture prompts without writing state or artifacts.

## Render Parameters

Mux MP4 from lectures that already have resolved HTML. Does not call the agent, re-resolve, or regenerate practice assets. Ignores API budget caps.

- `--course <slug>`: Required course slug.
- `--yes`: Skips confirmation prompt.
- `--force-lecture <slug>`: Render one lecture only (must have resolved HTML and no MP4).
- `--tts-voice <voice>` / `--tts-speed <speed>`: Optional narration overrides.
- `--dry-run`: Lists lectures that would render.

## Captions Parameters

Writes `captions.vtt` beside each lecture MP4 from existing resolved HTML timelines. Resolve/render also writes this file automatically.

- `--course <slug>`: Required course slug.
- `--lecture <slug>`: Optional single lecture slug.

After generating captions for already-published lectures, run `publish` again so `captions.vtt` uploads to R2.

## Script Lab Parameters

Use `script` to test script-generation prompt changes without creating HTML, audio, video, or practice assets. Drafts are written under `gens/courses/<course-slug>/.script-lab/<lecture>/<timestamp>/`.

- `--course <slug>`: Required course slug.
- `--lecture <slug>`: Optional lecture slug. If omitted, drafts every lecture in the plan.
- `--model <name>`: Overrides `AGENT_MODEL`.
- `--no-review`: Writes the draft without running `script-rubric.md`.

## Publish Parameters

- `--course <slug>`: Required course slug.
- `--yes`: Skips confirmation prompts.
- `--go-live`: Publishes an already uploaded draft course publicly.
- `--dry-run`: Prints upload commands without uploading.

## Useful Recipes

Preview a plan prompt without creating files:
```powershell
npm run coursegen -- plan --topic "Photosynthesis" --dry-run
```

Generate a shorter course and let the planner choose its catalog placement:
```powershell
npm run coursegen -- plan --topic "SQL Indexes" --lectures 6 --scope "query planning and practical index selection"
```

Force an undergraduate academic placement only when that is the editorial goal:
```powershell
npm run coursegen -- plan --topic "Cellular Respiration" --audience undergraduate --intent academic --lectures 8 --scope "glycolysis through the electron transport chain"
```

Regenerate one problematic lecture:
```powershell
npm run coursegen -- resume --course <course-slug> --force-lecture <lecture-slug> --yes
```

Generate and review only a script draft:
```powershell
npm run coursegen -- script --course <course-slug> --lecture <lecture-slug>
```

Check publish actions before uploading:
```powershell
npm run coursegen -- publish --course <course-slug> --dry-run
```
