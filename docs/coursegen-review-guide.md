# Coursegen — Agent Review Guide

**Purpose:** Everything an agent needs to review or audit the coursegen implementation without reading the whole workspace. Read this file first; drill into linked files only for the area under review.

**Also read (short, policy-level):**
- `docs/coursegen-principles.md` — product goals, generalization rules, layer placement
- `docs/coursegen-runbook.md` — CLI commands and flags

**Verify:** `cd mylecture && npm run test:coursegen` (unit tests) · `npm run coursegen -- plan --topic "…" --dry-run` (planner smoke)

---

## 1. What coursegen is

Batch pipeline: **topic → syllabus → per-lecture agent runs → TTS resolve → optional MP4 render → practice QA → website publish**.

Lives entirely in `mylecture/src/coursegen/`. Outputs under `gens/courses/<slug>/`. Publishes via `mylecture-website/scripts/admin.mjs` (spawned from coursegen; DB/R2 env stripped from child).

**Not coursegen:** website catalog UI (`mylecture-website/`), user video jobs (`video-agent/`), local IDE batch (`ide-server.ts` `/agent-batch*`), lecture-agent CLI used as a subprocess.

---

## 2. Pipeline (one lecture)

```text
plan / extend
  → course-plan.json (+ skillGraph.json if adaptive)
  → course-state.json (per-lecture status, budget, QA fields)

run / resume (per pending lecture, budget-gated)
  1. generating     lecture-agent → index*.html (+ script*.md) in NN-slug/
  2. script review  LLM rubric (soft gate; one repair pass; continues on fail)
  2b. video frame QA  Playwright bbox checks at render resolution (adaptive only; soft gate; one repair pass; continues on fail → needs-review at finalize)
  3. resolving      build-plan.ts → resolved*.html + audio/ + captions.vtt
  4. rendering      render-video.ts → *.mp4  (only with --render or render command)
  5. generating-practice  lecture-agent → activities/interactive|game/index.html
                        (adaptive: agent writes stage.js; coursegen assembles index.html)
  6. reviewing      Playwright screenshots + automated checks + LLM rubric
                    (one agent repair pass on QA fail)
  → status: done | failed | needs-review

publish
  draft:  admin upload-lecture (per lecture, needs local .mp4)
  go-live: admin publish-lecture + publish-course (blocks if needs-review or not done)
```

**Default run is resolve-only** (HTML + audio + practice, no MP4). Publish requires MP4 — use `--render` during run or `coursegen render` afterward.

---

## 3. File map (read selectively)

| File | Role | Review when changing… |
| --- | --- | --- |
| `cli.ts` | Arg parsing, command dispatch | CLI surface, new commands |
| `types.ts` | Schemas, validators, `CoursePlan`/`CourseState`/`SkillGraph` | Plan shape, status enums, adaptive rules |
| `state.ts` | Read/write JSON artifacts | Persistence, migrations of state fields |
| `paths.ts` | `gens/courses/` layout, website root | Output paths |
| `plan-course.ts` | LLM planner, adaptive detection, skill graph write | Planning behavior |
| `extend-course.ts` | Append modules/lectures to existing plan | Course extension |
| `run-course.ts` | **Main orchestrator** (~1000 lines): budget, retries, per-lecture phases | Generation flow, resume logic, status transitions |
| `lecture-prompt.ts` | Task messages, profile injection, cost estimate | What the agent is told per lecture |
| `spawn.ts` | Subprocesses: lecture-agent, build-plan, render-video, admin.mjs | Integration, TTS voice/provider, timeouts |
| `review-script.ts` | Pre-TTS narration QA | Script quality gate |
| `review-practice.ts` | Screenshot + LLM practice QA | Practice review pipeline |
| `video-frame-qa.ts` | Deterministic video stage bbox QA (adaptive, pre-TTS) | Letterboxing / horizontal overflow |
| `interaction-qa.ts` | Deterministic DOM/interaction checks (no LLM) | Answer leakage, layout, placement bugs |
| `activity-shell/` | Shared practice chrome + stage assembly (adaptive only) | Shell runtime, assemble.ts, stage-authoring prompt |
| `shell-qa.ts` | Deterministic shell walk for assembled activities | Shell button flow, counter, feedback |
| `publish-course.ts` | Upload/publish guards and admin spawn | Publishing rules |
| `write-captions.ts` | Sidecar VTT from resolved HTML | Captions |
| `skill-graph.ts` | Plan → `skillGraph.json` | Adaptive path / learn integration |
| `script-lab.ts` | Draft scripts without full generation | Prompt iteration |
| `confirm.ts` | Interactive yes/no | UX |
| `env.ts` | Load `mylecture/.env` | Env loading |
| `server.ts` + `ui.html` | Local UI on `:3940` | UI jobs |
| `adaptive-server.ts` + `adaptive-ui.html` | Adaptive-specific UI | Adaptive UI |
| `status-api.ts` | Course list/summary for UI | Status API |
| `job-logs.ts` | Persisted UI job records | Job logging |

### Prompts (`prompts/`)

| File | Used by |
| --- | --- |
| `planner.md` | `plan` (standard courses) |
| `planner-adaptive.md` | `plan --adaptive` or auto-detected adaptive topics |
| `planner-extend.md` | `extend` |
| `script-craft.md` + `script-writer.md` | Video lecture agent tasks |
| `script-rubric.md` | `review-script.ts` |
| `interactive-practice.md` | Interactive/game agent tasks (**layout contract**, non-adaptive) |
| `stage-authoring.md` | Adaptive practice stage module (`stage.js`) contract |
| `practice-rubric.md` | `review-practice.ts` |

### Profiles (`profiles/audience/*.md`, `profiles/intent/*.md`)

Injected into video/practice prompts via `lecture-prompt.ts` → `loadProfileContent`. **Not** the IDE profiles in `packages/lecture-agent/.agents/mylecture-profiles/`.

---

## 4. Artifacts on disk

```text
gens/courses/<slug>/
  course-plan.json      # syllabus (modules, lectures, specs)
  course-state.json     # runtime: status, budget, spent, QA per lecture
  skillGraph.json       # adaptive only: skills + dependencies
  coursegen.log         # optional run log
  .script-lab/          # script command drafts
  NN-<lecture-slug>/
    index.html          # or index2.html for multi-scene
    script.md           # narration draft (preferred by script reviewer)
    resolved.html       # TTS-injected timeline
    audio/*.wav
    captions.vtt
    <slug>.mp4          # after render
    activities/
      interactive/index.html   # assembled from stage.js when adaptive
      interactive/stage.js     # adaptive: agent-authored stage module
      game/index.html
      game/stage.js
    .practice-review/    # ephemeral screenshots (cleaned up)
```

**Folder naming:** `lectureFolderName(order, slug)` → `01-slug`, `02-slug`, …

**Legacy cleanup:** top-level `interactive.html` / `game.html` removed on run; practice lives under `activities/`.

---

## 5. Key schemas (condensed)

### `CoursePlan` (`types.ts`)

- `title`, `slug`, `audience`, `intent`, `summary`, `description`, `modules[]`
- `adaptivePath?: true` — enables skill graph + stricter lecture rules
- Each `PlannedLecture`: `slug`, `title`, `objective`, `durationMinutes` (2–10; adaptive: 2 or 3), `formats` (must include `video`; optional `interactive`, `game`), optional `review?: true` (section review nodes: `video` + `game`, prerequisites = all module skills), `promptNotes`, optional `interactiveSpec` / `gameSpec`, optional graph fields (`prerequisites`, `assumes`, `teaches`, `commonMistakes`, `remediationTargets`, `enrichmentTargets`)

### `CourseState`

- `budgetUsd`, `spentUsd`, `maxAttempts` (default 2)
- Per lecture: `status`, `attempts`, `costUsd`, `error`, `mp4Path`, `folderName`, `interactiveReview` / `gameReview` / `videoFrameReview` (`not-required` | `passed` | `needs-review`)

### Lecture status flow

`pending` → `generating` → `resolving` → (`rendering` if --render) → `generating-practice` → `reviewing` → `done` | `failed` | `needs-review`

Interrupted in-progress statuses are reset on UI job restore (`run-course.ts` `resetInterruptedLectures`).

---

## 6. Orchestration rules (`run-course.ts`)

| Rule | Behavior |
| --- | --- |
| Budget | Stops before next lecture when `spentUsd >= budgetUsd` (unless `--force-lecture`) |
| Max attempts | Skips `pending` lectures after `maxAttempts` (unless force) |
| `--retry-failed` / `resume` | Re-runs `failed` and in-progress; `needs-review` only with retry |
| `--node-limit N` | First N pending lectures only (adaptive batching) |
| `--render` | MP4 after resolve; `render` command = render-only (no agent) |
| `--skip-practice-review` | Dev only; marks practice passed without QA |
| `--skip-script-review` | Skips narration QA before TTS |
| `--repair-practice` | Re-runs practice gen + QA only; keeps video |
| Adaptive courses | `enableGetimgTool: false` for agent; sequence context uses skill graph not linear “lecture N of M”; skill `adaptive-micro-lesson` on **initial video gen**, **script repair**, and **video-frame repair** only (overrides divide-and-conquer → single `index.html`; not used for practice) |
| Script review | **Soft gate** — continues to render even if rubric still fails after one repair |
| Video frame QA | **Soft gate** (adaptive only) — one agent repair on `index.html`; continues to resolve; `needs-review` at finalize if still failing |
| Practice review | **Hard gate** — `needs-review` blocks `--go-live`; one agent repair pass then re-review |

---

## 7. External integrations

| Dependency | How coursegen uses it |
| --- | --- |
| `packages/lecture-agent/src/cli.ts` | `spawnAgent`: `--new-session`, `--skill <name>`, `AGENT_WORKSPACE=<lecture folder>`, parses `cost=$X` from stdout |
| `src/build-plan.ts` | TTS + timeline → `resolved*.html` |
| `src/render-video.ts` | Playwright + ffmpeg → MP4; multi-scene concat via ffmpeg |
| `src/captions-vtt.ts` | VTT from resolved segments |
| `src/config.ts` | `generationDir`, TTS defaults, render dimensions/fps |
| `mylecture-website/scripts/admin.mjs` | `upload-lecture` (requires .mp4), `publish-lecture`, `publish-course` |
| HTML contract | Video lectures must satisfy `window.__VIDEO_*` globals (lecture-agent validates) |

**Publish contract:** `upload-lecture` requires a local `.mp4`. Resolved-only courses cannot publish until `render`.

**Website learn path:** Adaptive courses produce `skillGraph.json` consumed by website `learn/` (Prisma `LearningPath` / `Skill` — seeding is website-side; coursegen only writes the JSON).

---

## 8. QA layers (practice)

**HUD ownership:** The activity shell owns score, progress, goal, streak, and feedback chrome. Stages render only question/manipulative content inside `#shell-stage-inner` and report via `checkAnswer`. Duplicate stage HUDs are flagged deterministically in the shell walk and in `practice-rubric.md` criterion 15.

1. **Deterministic** (`interaction-qa.ts`): horizontal/vertical overflow, internal scroll, font size floors, answer leakage (dashed markers before attempt), overlap placed/marker, practice/challenge mode detection — runs on **desktop and phone** viewports
2. **Shell walk** (`shell-qa.ts`, when `data-shell-version` present): Check/Next flow, counter text, feedback visibility, duplicate stage HUD scan (including `.game-hud`), stage content overlap, **post-Check** stage-fit remeasure, `__SHELL_QA__` state
3. **Playwright** (`review-practice.ts`): viewports 1280×720 + 390×844, screenshots (extra phone item-2 shot for shell pages)
4. **LLM rubric** (`practice-rubric.md`): objective alignment, spec compliance, findings from (1–3)
5. **Repair passes** (up to 2) via agent — adaptive shell activities edit `stage.js` only; `index.html` is reassembled before re-review. Repair policy: **remove/defer content**, never shrink text to fit.

**Video frame QA** (`video-frame-qa.ts`, adaptive only, before TTS): at `loadAppConfig` render resolution, checks visible content bbox fills ≥80% of viewport, no horizontal/vertical overflow, **content-box overlap** (shared `layout-overlap.ts`), text defects, and seek/replay statefulness; screenshots saved for findings; one `index.html` repair pass on fail.

**Stage content budget** (`stage-authoring.md`): format is free (quiz, demo, manipulative, …); per item at most one primary visual, one control cluster, one feedback path via `checkAnswer.explanation`.

Keep `interaction-qa.ts`, `interactive-practice.md`, and `review-practice.ts` typography constants aligned (comments mark this).

---

## 9. Adaptive mode

Triggered by: `plan --adaptive`, or `intent=practice` + topic matching `/algebra|adaptive|skill path|duolingo|pre-algebra/i`.

Extra constraints (`validateAdaptiveCoursePlan`):
- Regular skill nodes: `video` + `interactive` (game allowed on legacy plans but planner forbids it on new plans)
- Section review nodes (`review: true`): `video` + `game`, non-empty `prerequisites` (all module skills), `durationMinutes` 2
- Every lecture: explicit `prerequisites[]`, `durationMinutes` 2 or 3
- `skillGraph.json` built by `buildSkillGraphFromPlan` (includes optional `review` on nodes), validated (no cycles, slug refs)
- Planner prompt: `planner-adaptive.md` — one review node per module
- Video prompts: `formatAdaptiveSkillContext`; review nodes use recap structure + section skills list for game tasks
- Practice: coursegen seeds `stage.js` scaffold (when missing) before the practice agent; agent edits stubs; `activity-shell/assemble.ts` builds `index.html` with shared chrome (challenge score scale from `N out of M` criterion)
- Challenge pacing: planner sets `gameSpec.pacing` (`relaxed`|`steady`|`brisk`); `challenge-pacing.ts` maps the band to `{ start, min, shrink }` seconds on the shell activity config. Stages must use `ctx.activity.timer` — never invent raw seconds

---

## 10. Tests

```bash
cd mylecture && npm run test:coursegen
```

| Test file | Covers |
| --- | --- |
| `skill-graph.test.ts` | Plan validation, cycle detection, algebra-foundations fixture, review nodes |
| `video-frame-qa.test.ts` | Video frame bbox QA unit + Playwright fixtures |
| `shell-qa-hud.test.ts` | Stage HUD duplicate detection |
| `interaction-qa.test.ts` | Deterministic interaction findings |
| `challenge-pacing.test.ts` | Coarse pacing bands → timer seconds |
| `activity-shell/assemble.test.ts` | Shell config, assembly escaping, stage validation |
| `activity-shell/stage-scaffold.test.ts` | Adaptive stage.js scaffold + `validateStageJs` |
| `spawn.test.ts` | `--skill` CLI args when skills provided |
| `activity-shell/shell-e2e.test.ts` | Playwright shell fixture flow (desktop + phone) |

Full renderer smoke: `npm test` (fixtures under `tests/fixtures/` — not coursegen-specific).

---

## 11. Review checklist (by concern)

### Correctness / orchestration
- [ ] `shouldRunLecture` covers resume, render-only, repair-practice, force-lecture, needs-review
- [ ] `syncStateFromPlan` preserves done/failed state when plan extended
- [ ] Budget and attempt caps cannot be bypassed accidentally (except force-lecture / render-only)
- [ ] Status transitions always persisted via `writeCourseState` before long IO
- [ ] `finalizeLectureStatus`: practice or video-frame `needs-review` → lecture `needs-review`, not `done`

### Prompt / generalization (`coursegen-principles.md`)
- [ ] No topic-specific hacks in prompts (fractions, pizza, etc.)
- [ ] Rules live in prompt vs reviewer vs validator vs website — right layer?
- [ ] `interactive-practice.md` skeleton (`#app`, `#activity-stage`, `data-activity-tab`) unchanged without updating QA

### Practice QA
- [ ] Answer leakage checks match prompt “no markers before submit” rules
- [ ] Mobile viewport still tested; website may disable activities on phones
- [ ] Repair pass uses `maxPracticeTurns`, not video `maxTurns`

### Publish safety
- [ ] `--go-live` blocked on `needs-review` and not-`done`
- [ ] Draft upload warns on `needs-review`
- [ ] `spawnAdmin` strips website DB secrets (child uses its own `.env`)

### Spawn / subprocess
- [ ] Agent timeout kills process tree on Windows (`taskkill`) and Unix (`SIGTERM`)
- [ ] TTS voice → provider mapping in `spawn.ts` (`omnivoice` vs `kokoro`)
- [ ] Multi-scene lectures: resolve all `indexN.html`, concat MP4s

### Adaptive / skill graph
- [ ] Prerequisites acyclic; all slugs exist
- [ ] Non-adaptive plans still get implicit linear prereq in `buildSkillGraphFromPlan` when `prerequisites` omitted

---

## 12. What NOT to read (unless task-specific)

| Area | Skip unless reviewing… |
| --- | --- |
| `gens/courses/*` generated artifacts | One sample lecture folder is enough for format |
| `mylecture-website/src/**` | Publish/upload behavior → `admin.mjs` help + `publish-course.ts` only |
| `packages/lecture-agent/src/**` | Agent loop internals → read `spawn.ts` + `system_prompt.md` only |
| `src/build-plan.ts`, `render-video.ts` | Full file only for TTS/render bugs; coursegen calls are in `spawn.ts` |
| All profile `.md` files | Skim one audience + one intent; they follow the same pattern |
| `server.ts` / UI HTML | Only for UI feature work |

---

## 13. Sample commands for targeted review

```bash
# Planner output shape (no API cost if --dry-run)
npm run coursegen -- plan --topic "Photosynthesis" --lectures 6 --dry-run

# Per-lecture prompts only
npm run coursegen -- run --course <slug> --dry-run

# Publish dry-run
npm run coursegen -- publish --course <slug> --dry-run

# Status
npm run coursegen -- status --course <slug>

# Unit tests
npm run test:coursegen
```

---

## 14. Known edge cases / risks

- **Resolve without render:** `done` lectures may have empty `mp4Path` — valid for local preview, not publishable.
- **Script review soft-fail:** Bad narration can reach TTS; by design to avoid pipeline stalls.
- **Cost estimate** (`estimateCourseCostUsd`): rough formula `minutes * 0.35 + practiceAssets * 0.25 + 0.15`, not enforced per-lecture.
- **Extend + existing state:** `plan` keeps existing `course-state.json`; `extend` syncs new lectures as `pending`.
- **getimg disabled for adaptive:** image tool off to reduce cost/complexity on micro-lessons.
- **Windows:** process tree kill uses `taskkill`; verify spawn paths use `process.execPath` + `tsx`.
- **admin.mjs upload:** strips env from parent; website `.env` must have `DATABASE_URL`, R2 keys locally for publish.
- **Adaptive shell assembly:** `</script>` in `stage.js` must be escaped in assembled HTML; runtime errors in `stage.js` surface as visible error + Playwright `pageerror`.
- **Legacy adaptive practice:** if agent writes `index.html` but no `stage.js`, coursegen logs a warning and QA runs the legacy free-form page.
- **Shell vs legacy repair:** `--repair-practice` detects `stage.js` beside `index.html` and repairs only the stage module.

---

## 15. Index entry

Workspace index: `WORKSPACE_INDEX.md` §4.5 (coursegen), §7 task row “AI course generation”.
