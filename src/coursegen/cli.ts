import { loadEnv } from './env.ts';
import { rootDir } from './paths.ts';
import { extendCourse, type ExtensionPlacementMode } from './extend-course.ts';
import { generateAssessments } from './generate-assessments.ts';
import { planClass } from './plan-class.ts';
import { planCourse } from './plan-course.ts';
import { planModule } from './plan-module.ts';
import { publishCourse } from './publish-course.ts';
import { printCourseStatus, runCourse } from './run-course.ts';
import { runScriptLab } from './script-lab.ts';
import { writeCourseCaptions } from './write-captions.ts';
import { AUDIENCES, LEARNING_INTENTS, isLearningIntent, type Audience } from './types.ts';

loadEnv(rootDir);

type ParsedArgs = {
  command: string;
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command: positionals[0] || 'help', flags };
}

function flagString(flags: Record<string, string | boolean>, key: string, fallback = '') {
  const value = flags[key];
  if (value === undefined || value === true) return fallback;
  return String(value);
}

function flagBool(flags: Record<string, string | boolean>, key: string) {
  return flags[key] === true;
}

function flagNumber(flags: Record<string, string | boolean>, key: string, fallback: number) {
  const raw = flagString(flags, key, '');
  if (!raw) return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new Error(`--${key} must be a number`);
  }
  return num;
}

function flagPositiveNumber(flags: Record<string, string | boolean>, key: string, fallback: number) {
  const num = flagNumber(flags, key, fallback);
  if (num <= 0) {
    throw new Error(`--${key} must be greater than 0`);
  }
  return num;
}

function flagIntegerRange(flags: Record<string, string | boolean>, key: string, fallback: number, min: number, max: number) {
  const num = flagNumber(flags, key, fallback);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new Error(`--${key} must be an integer from ${min} to ${max}`);
  }
  return num;
}

const EDIT_TARGETS = ['video', 'interactive', 'game'] as const;

function validateEditFlags(flags: Record<string, string | boolean>) {
  const editTarget = flagString(flags, 'edit-target') || undefined;
  const editPrompt = flagString(flags, 'edit-prompt') || undefined;
  if (!editTarget && !editPrompt) {
    return { editTarget: undefined, editPrompt: undefined };
  }
  if (!editTarget || !editPrompt) {
    throw new Error('--edit-target and --edit-prompt must be used together');
  }
  if (!EDIT_TARGETS.includes(editTarget as (typeof EDIT_TARGETS)[number])) {
    throw new Error(`--edit-target must be one of: ${EDIT_TARGETS.join(', ')}`);
  }
  if (!editPrompt.trim()) {
    throw new Error('--edit-prompt must be non-empty');
  }
  if (!flagString(flags, 'force-lecture')) {
    throw new Error('--force-lecture is required with --edit-target and --edit-prompt');
  }
  if (flagBool(flags, 'retry-practice')) {
    throw new Error('--edit-target cannot be combined with --retry-practice');
  }
  if (flagBool(flags, 'repair-practice')) {
    throw new Error('--edit-target cannot be combined with --repair-practice');
  }
  return {
    editTarget: editTarget as (typeof EDIT_TARGETS)[number],
    editPrompt: editPrompt.trim()
  };
}

function printHelp() {
  console.log(`MyLecture course generator

Usage:
  npm run coursegen -- ingest --pdf <path> --source <slug> [options]
  npm run coursegen -- plan-class --topic <text> [options]
  npm run coursegen -- plan-module --class <slug> --module <slug> [options]
  npm run coursegen -- plan --topic <text> [options]
  npm run coursegen -- extend --course <slug> [options]
  npm run coursegen -- run --course <slug> [options]
  npm run coursegen -- resume --course <slug> [options]
  npm run coursegen -- render --course <slug> [options]
  npm run coursegen -- captions --course <slug> [options]
  npm run coursegen -- script --course <slug> [options]
  npm run coursegen -- generate-assessments --course <slug> [options]
  npm run coursegen -- publish --course <slug> [options]
  npm run coursegen -- status --course <slug>
  npm run coursegen -- ui
  npm run coursegen:ui

Audiences: ${AUDIENCES.join(', ')}
Learning intents: ${LEARNING_INTENTS.join(', ')}

Ingest options:
  --pdf <path>             Path to the textbook PDF (required)
  --source <slug>          Source slug under gens/sources/<slug>/ (required)
  --chapters <spec>        Optional chapter filter, e.g. 1-9 or 1,2,5
  --title <text>           Optional display title (defaults from PDF filename)

Plan options:
  --scope <text>           Narrow the unit scope
  --audience <level>       Override inferred learner level
  --intent <name>          Override inferred learning intent
  --lectures <n>           Target lecture count (default 12, max 30)
  --budget <usd>           Budget cap for later run (default 5)
  --source <slug>          Ground the plan in an ingested source
  --model <name>           Override AGENT_MODEL
  --dry-run                Print prompts only

Plan-class options:
  --topic <text>           Class topic (required)
  --class <slug>           Preferred class slug (optional)
  --scope <text>           Narrow the class scope
  --audience <level>       Optional catalog audience hint
  --intent <name>          Optional catalog intent hint
  --source <slug>          Ground modules in an ingested source
  --model <name>           Override AGENT_MODEL
  --dry-run                Print prompts only

Plan-module options:
  --class <slug>           Parent class slug (required)
  --module <slug>          Module slug from class-plan.json (required)
  --source <slug>          Override source slug from class plan
  --lectures <n>           Target lecture count (omit for coverage-first, max 30)
  --audience <level>       Override class plan audience
  --intent <name>          Override class plan intent
  --budget <usd>           Budget cap for later run (default 5)
  --model <name>           Override AGENT_MODEL
  --dry-run                Print prompts only

Generate-assessments options:
  --course <slug>          Course slug (required)
  --model <name>           Override AGENT_MODEL
  --dry-run                Print prompts only

Extend options:
  --course <slug>          Existing course slug (required)
  --topic <text>           Optional hint for what to add (planner infers if omitted)
  --scope <text>           Optional hint to narrow the addition
  --module-title <text>    Optional preferred module title hint
  --placement <mode>       auto, append-last, or new-module (default auto)
  --lectures <n>           Target new lecture count (default 3)
  --model <name>           Override AGENT_MODEL
  --dry-run                Print prompts only

Run / resume options:
  --yes                    Skip confirmation prompt
  --budget <usd>           Budget cap (default from state or 5)
  --max-turns <n>          Agent turn cap per video lecture (default 60)
  --max-practice-turns <n> Agent turn cap per interactive/game pass (default 40)
  --skip-practice-review   Skip screenshot QA (dev only)
  --skip-script-review     Skip narration-quality review before render (dev only)
  --lecture-timeout <min>  Kill hung agent generation after N minutes (resolve/render not covered) (default 20)
  --retry-failed           Retry failed lectures only
  --retry-practice         Regenerate interactive/game only (keeps video). Use with --force-lecture or resume
  --repair-practice        Keep existing practice HTML; run QA + one IAGen/GameGen repair. Use with --force-lecture or resume
  --force-lecture <slug>   Regenerate one lecture (ignores budget/attempt caps)
  --edit-target <kind>     Edit existing HTML: video, interactive, or game (requires --edit-prompt and --force-lecture)
  --edit-prompt <text>     Instruction for EditorAgent edit pass (requires --edit-target and --force-lecture)
  --render                 Render MP4 after resolve (default: resolve-only)
  --tts-voice <voice>      Narration voice (default Leda / Gemini TTS)
  --tts-speed <speed>
  --dry-run                Print per-lecture prompts only

Render options (mux MP4 from existing resolved HTML only — no agent, resolve, or practice):
  --course <slug>          Required course slug
  --yes                    Skip confirmation prompt
  --force-lecture <slug>   Render MP4 for one lecture only
  --tts-voice <voice>      Narration voice (default Leda / Gemini TTS)
  --tts-speed <speed>
  --dry-run                List lectures that would render

Captions options (build captions.vtt from resolved HTML — no render):
  --course <slug>          Required course slug
  --lecture <slug>         Optional single lecture slug

Script lab options:
  --lecture <slug>         Generate a script draft for one lecture (default all lectures)
  --model <name>           Override AGENT_MODEL
  --no-review              Skip narration-quality review

Publish options:
  --yes                    Skip confirmation
  --go-live                Publish course publicly; unfinished lectures stay off the catalog
  --dry-run                Print upload commands only

Draft publish captures a random early video frame as thumbnail.jpg per lecture
(same idea as the admin upload auto-thumbnail) and admin.mjs uploads it to the CDN.
`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp();
      return;
    }

    if (command === 'ui') {
      await import('./server.ts');
      return;
    }

    if (command === 'ingest') {
      const pdfPath = flagString(flags, 'pdf');
      const source = flagString(flags, 'source');
      if (!pdfPath) throw new Error('--pdf is required');
      if (!source) throw new Error('--source is required');
      // Dynamic import keeps pdfjs out of the default CLI module graph.
      const { ingestSource } = await import('./ingest-source.ts');
      await ingestSource({
        pdfPath,
        source,
        chapters: flagString(flags, 'chapters') || undefined,
        title: flagString(flags, 'title') || undefined
      });
      return;
    }

    if (command === 'plan-class') {
      const topic = flagString(flags, 'topic');
      if (!topic) throw new Error('--topic is required');
      const audienceRaw = flagString(flags, 'audience');
      const audience = audienceRaw as Audience;
      if (audienceRaw && !AUDIENCES.includes(audience)) {
        throw new Error(`--audience must be one of: ${AUDIENCES.join(', ')}`);
      }
      const intentRaw = flagString(flags, 'intent');
      if (intentRaw && !isLearningIntent(intentRaw)) {
        throw new Error(`--intent must be one of: ${LEARNING_INTENTS.join(', ')}`);
      }
      await planClass({
        topic,
        classSlug: flagString(flags, 'class') || undefined,
        audience: audienceRaw ? audience : undefined,
        intent: intentRaw && isLearningIntent(intentRaw) ? intentRaw : undefined,
        scope: flagString(flags, 'scope') || undefined,
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run'),
        source: flagString(flags, 'source') || undefined
      });
      return;
    }

    if (command === 'plan-module') {
      const classSlug = flagString(flags, 'class');
      const moduleSlug = flagString(flags, 'module');
      if (!classSlug) throw new Error('--class is required');
      if (!moduleSlug) throw new Error('--module is required');
      const audienceRaw = flagString(flags, 'audience');
      const audience = audienceRaw as Audience;
      if (audienceRaw && !AUDIENCES.includes(audience)) {
        throw new Error(`--audience must be one of: ${AUDIENCES.join(', ')}`);
      }
      const intentRaw = flagString(flags, 'intent');
      if (intentRaw && !isLearningIntent(intentRaw)) {
        throw new Error(`--intent must be one of: ${LEARNING_INTENTS.join(', ')}`);
      }
      const lecturesRaw = flagString(flags, 'lectures');
      await planModule({
        classSlug,
        moduleSlug,
        source: flagString(flags, 'source') || undefined,
        maxLectures: lecturesRaw ? flagIntegerRange(flags, 'lectures', 12, 1, 30) : undefined,
        audience: audienceRaw ? audience : undefined,
        intent: intentRaw && isLearningIntent(intentRaw) ? intentRaw : undefined,
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run'),
        budgetUsd: flagPositiveNumber(flags, 'budget', 5)
      });
      return;
    }

    if (command === 'generate-assessments' || command === 'assessments') {
      const courseSlug = flagString(flags, 'course');
      if (!courseSlug) throw new Error('--course is required');
      await generateAssessments({
        courseSlug,
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run')
      });
      return;
    }

    if (command === 'plan') {
      const topic = flagString(flags, 'topic');
      if (!topic) throw new Error('--topic is required');
      const audienceRaw = flagString(flags, 'audience');
      const audience = audienceRaw as Audience;
      if (audienceRaw && !AUDIENCES.includes(audience)) {
        throw new Error(`--audience must be one of: ${AUDIENCES.join(', ')}`);
      }
      const intentRaw = flagString(flags, 'intent');
      if (intentRaw && !isLearningIntent(intentRaw)) {
        throw new Error(`--intent must be one of: ${LEARNING_INTENTS.join(', ')}`);
      }
      const audienceOverride = audienceRaw ? audience : undefined;
      const intentOverride = intentRaw && isLearningIntent(intentRaw) ? intentRaw : undefined;
      await planCourse({
        topic,
        audience: audienceOverride,
        intent: intentOverride,
        scope: flagString(flags, 'scope') || undefined,
        maxLectures: flagIntegerRange(flags, 'lectures', 12, 1, 30),
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run'),
        budgetUsd: flagPositiveNumber(flags, 'budget', 5),
        source: flagString(flags, 'source') || undefined
      });
      return;
    }

    if (command === 'extend') {
      const courseSlug = flagString(flags, 'course');
      if (!courseSlug) throw new Error('--course is required');
      const placementRaw = flagString(flags, 'placement') || 'auto';
      if (!['auto', 'append-last', 'new-module'].includes(placementRaw)) {
        throw new Error('--placement must be one of: auto, append-last, new-module');
      }
      await extendCourse({
        courseSlug,
        topic: flagString(flags, 'topic') || undefined,
        scope: flagString(flags, 'scope') || undefined,
        moduleTitle: flagString(flags, 'module-title') || undefined,
        placement: placementRaw as ExtensionPlacementMode,
        maxLectures: flagIntegerRange(flags, 'lectures', 3, 1, 30),
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run')
      });
      return;
    }

    const courseSlug = flagString(flags, 'course');
    if (
      !courseSlug &&
      command !== 'help' &&
      command !== 'plan-class' &&
      command !== 'plan-module' &&
      command !== 'generate-assessments' &&
      command !== 'assessments'
    ) {
      throw new Error('--course <slug> is required');
    }

    if (command === 'run' || command === 'resume') {
      const edit = validateEditFlags(flags);
      await runCourse({
        courseSlug,
        yes: flagBool(flags, 'yes'),
        budgetUsd: flags.budget !== undefined ? flagPositiveNumber(flags, 'budget', 5) : undefined,
        maxTurns: flagIntegerRange(flags, 'max-turns', 60, 1, 500),
        maxPracticeTurns: flagIntegerRange(flags, 'max-practice-turns', 40, 1, 500),
        skipPracticeReview: flagBool(flags, 'skip-practice-review'),
        skipScriptReview: flagBool(flags, 'skip-script-review'),
        lectureTimeoutMinutes: flagPositiveNumber(flags, 'lecture-timeout', 20),
        retryFailed: command === 'resume' || flagBool(flags, 'retry-failed'),
        practiceOnly: flagBool(flags, 'retry-practice'),
        practiceRepair: flagBool(flags, 'repair-practice'),
        forceLecture: flagString(flags, 'force-lecture') || undefined,
        editTarget: edit.editTarget,
        editPrompt: edit.editPrompt,
        ttsVoice: flagString(flags, 'tts-voice') || undefined,
        ttsSpeed: flagString(flags, 'tts-speed') || undefined,
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run'),
        render: flagBool(flags, 'render')
      });
      return;
    }

    if (command === 'render') {
      await runCourse({
        courseSlug,
        yes: flagBool(flags, 'yes'),
        forceLecture: flagString(flags, 'force-lecture') || undefined,
        ttsVoice: flagString(flags, 'tts-voice') || undefined,
        ttsSpeed: flagString(flags, 'tts-speed') || undefined,
        dryRun: flagBool(flags, 'dry-run'),
        renderOnly: true
      });
      return;
    }

    if (command === 'captions') {
      writeCourseCaptions({
        courseSlug,
        lectureSlug: flagString(flags, 'lecture') || flagString(flags, 'force-lecture') || undefined
      });
      return;
    }

    if (command === 'script') {
      await runScriptLab({
        courseSlug,
        lectureSlug: flagString(flags, 'lecture') || flagString(flags, 'force-lecture') || undefined,
        model: flagString(flags, 'model') || undefined,
        review: !flagBool(flags, 'no-review')
      });
      return;
    }

    if (command === 'publish') {
      await publishCourse({
        courseSlug,
        yes: flagBool(flags, 'yes'),
        goLive: flagBool(flags, 'go-live'),
        dryRun: flagBool(flags, 'dry-run')
      });
      return;
    }

    if (command === 'status') {
      printCourseStatus(courseSlug);
      return;
    }

    printHelp();
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Dry run complete')) {
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }
}

main();
