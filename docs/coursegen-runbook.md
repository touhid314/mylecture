# Course Generator Runbook

Use these commands from the `mylecture/` package root.

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

## Core Workflow

1. Plan the course:
   ```powershell
   npm run coursegen -- plan --topic "Fractions" --audience elementary --intent foundation --lectures 12 --budget 5
   ```
2. Inspect the generated plan and course slug:
   ```powershell
   npm run coursegen -- status --course <course-slug>
   ```
3. Generate lectures, videos, and practice activities:
   ```powershell
   npm run coursegen -- run --course <course-slug> --yes
   ```
4. Resume after interruption or after fixing failed items:
   ```powershell
   npm run coursegen -- resume --course <course-slug> --yes
   ```
5. Publish as a draft:
   ```powershell
   npm run coursegen -- publish --course <course-slug> --yes
   ```
6. Make an uploaded course public:
   ```powershell
   npm run coursegen -- publish --course <course-slug> --go-live --yes
   ```

Generated course state and artifacts live in `gens/courses/<course-slug>/`.

## Planning Parameters

- `--topic <text>`: Required subject or unit title.
- `--audience <level>`: Required learner level; one of `early`, `elementary`, `middle`, `general`, `undergraduate`, `graduate`.
- `--intent <name>`: Learning goal; one of `foundation`, `practice`, `exam`, `professional`, `exploration`, `teaching`. Defaults to `foundation`.
- `--scope <text>`: Optional boundary for the course, such as “introductory naming and visual models only”.
- `--lectures <n>`: Target lecture count from `1` to `30`. Defaults to `12`.
- `--budget <usd>`: Default run budget stored with the course plan. Defaults to `5`.
- `--model <name>`: Overrides `AGENT_MODEL` for planning.
- `--dry-run`: Prints planning prompts without creating course files.

## Run and Resume Parameters

- `--course <slug>`: Required course slug from the planning step.
- `--yes`: Skips confirmation prompts.
- `--budget <usd>`: Overrides the saved run budget.
- `--max-turns <n>`: Agent turn cap per video lecture. Defaults to `60`.
- `--max-practice-turns <n>`: Agent turn cap per interactive or game pass. Defaults to `40`.
- `--lecture-timeout <min>`: Generation timeout per lecture. Defaults to `20`.
- `--retry-failed`: Retries failed lectures. `resume` enables this automatically.
- `--force-lecture <slug>`: Regenerates one lecture, ignoring budget and attempt caps.
- `--skip-practice-review`: Skips screenshot QA for interactives and games. Use for development only.
- `--tts-voice <voice>`: Overrides narration voice for render.
- `--tts-speed <speed>`: Overrides narration speed for render.
- `--model <name>`: Overrides `AGENT_MODEL` for generation and review.
- `--dry-run`: Prints per-lecture prompts without writing state or artifacts.

## Publish Parameters

- `--course <slug>`: Required course slug.
- `--yes`: Skips confirmation prompts.
- `--go-live`: Publishes an already uploaded draft course publicly.
- `--dry-run`: Prints upload commands without uploading.

## Useful Recipes

Preview a plan prompt without creating files:
```powershell
npm run coursegen -- plan --topic "Photosynthesis" --audience middle --intent foundation --dry-run
```

Generate a shorter professional course:
```powershell
npm run coursegen -- plan --topic "SQL Indexes" --audience general --intent professional --lectures 6 --scope "query planning and practical index selection"
```

Regenerate one problematic lecture:
```powershell
npm run coursegen -- resume --course <course-slug> --force-lecture <lecture-slug> --yes
```

Check publish actions before uploading:
```powershell
npm run coursegen -- publish --course <course-slug> --dry-run
```
