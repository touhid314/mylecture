import { loadEnv } from './env.ts';
import { rootDir } from './paths.ts';
import { coursegenApi } from './api.ts';
import type { ExtensionPlacementMode } from './extend-course.ts';
import { printPlanSummary } from './lecture-prompt.ts';
import type { CourseSummary } from './status-api.ts';
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

function printCourseStatus(summary: CourseSummary) {
  printPlanSummary(summary.plan);
  if (!summary.state) {
    console.log('\nNo generation state exists yet.');
    return;
  }
  console.log('\nLecture status:');
  for (const lecture of summary.lectures) {
    console.log(`  [${lecture.status}] ${lecture.order}. ${lecture.title} (attempts=${lecture.attempts}, cost=$${lecture.costUsd.toFixed(2)})`);
    if (lecture.error) console.log(`    error: ${lecture.error.split('\n')[0]}`);
    if (lecture.hasMp4 && lecture.mp4Path) console.log(`    mp4: ${lecture.mp4Path}`);
  }
  console.log(`\nSpent: $${summary.state.spentUsd.toFixed(2)} / $${summary.state.budgetUsd.toFixed(2)}`);
}

function printHelp() {
  console.log(`MyLecture course generator

Usage:
  npm run coursegen -- ingest --pdf <path> --source <slug> [options]
  npm run coursegen -- plan --topic <text> [options]
  npm run coursegen -- extend --course <slug> [options]
  npm run coursegen -- run --course <slug> [options]
  npm run coursegen -- resume --course <slug> [options]
  npm run coursegen -- render --course <slug> [options]
  npm run coursegen -- captions --course <slug> [options]
  npm run coursegen -- publish --course <slug> [options]
  npm run coursegen -- status --course <slug>

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
  --lecture-timeout <min>  Kill hung agent generation after N minutes (resolve/render not covered) (default 20)
  --retry-failed           Retry failed lectures only
  --force-lecture <slug>   Regenerate one lecture (ignores budget/attempt caps)
  --render                 Render MP4 after resolve (default: resolve-only)
  --tts-provider <name>    Narration provider (default from mylecture-agent)
  --tts-voice <voice>      Narration voice (default maruf)
  --tts-speed <speed>
  --dry-run                Print per-lecture prompts only

Render options (mux MP4 from existing resolved HTML only — no generation or resolve):
  --course <slug>          Required course slug
  --yes                    Skip confirmation prompt
  --force-lecture <slug>   Render MP4 for one lecture only
  --tts-provider <name>    Narration provider (default from mylecture-agent)
  --tts-voice <voice>      Narration voice (default maruf)
  --tts-speed <speed>
  --dry-run                List lectures that would render

Captions options (build captions.vtt from resolved HTML — no render):
  --course <slug>          Required course slug
  --lecture <slug>         Optional single lecture slug

Publish options:
  --yes                    Skip confirmation
  --go-live                Publish course publicly after upload
  --dry-run                Print upload commands only
`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp();
      return;
    }

    if (command === 'ingest') {
      const pdfPath = flagString(flags, 'pdf');
      const source = flagString(flags, 'source');
      if (!pdfPath) throw new Error('--pdf is required');
      if (!source) throw new Error('--source is required');
      await coursegenApi.ingest({
        pdfPath,
        source,
        chapters: flagString(flags, 'chapters') || undefined,
        title: flagString(flags, 'title') || undefined
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
      await coursegenApi.plan({
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
      await coursegenApi.extend({
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
    if (!courseSlug && command !== 'help') {
      throw new Error('--course <slug> is required');
    }

    if (command === 'run' || command === 'resume') {
      const run = command === 'resume' ? coursegenApi.resume : coursegenApi.run;
      await run({
        courseSlug,
        yes: flagBool(flags, 'yes'),
        budgetUsd: flags.budget !== undefined ? flagPositiveNumber(flags, 'budget', 5) : undefined,
        lectureTimeoutMinutes: flagPositiveNumber(flags, 'lecture-timeout', 20),
        retryFailed: command === 'resume' || flagBool(flags, 'retry-failed'),
        forceLecture: flagString(flags, 'force-lecture') || undefined,
        ttsProvider: flagString(flags, 'tts-provider') || undefined,
        ttsVoice: flagString(flags, 'tts-voice') || undefined,
        ttsSpeed: flagString(flags, 'tts-speed') || undefined,
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run'),
        render: flagBool(flags, 'render')
      });
      return;
    }

    if (command === 'render') {
      await coursegenApi.render({
        courseSlug,
        yes: flagBool(flags, 'yes'),
        forceLecture: flagString(flags, 'force-lecture') || undefined,
        ttsProvider: flagString(flags, 'tts-provider') || undefined,
        ttsVoice: flagString(flags, 'tts-voice') || undefined,
        ttsSpeed: flagString(flags, 'tts-speed') || undefined,
        dryRun: flagBool(flags, 'dry-run')
      });
      return;
    }

    if (command === 'captions') {
      await coursegenApi.captions({
        courseSlug,
        lectureSlug: flagString(flags, 'lecture') || flagString(flags, 'force-lecture') || undefined
      });
      return;
    }

    if (command === 'publish') {
      await coursegenApi.publish({
        courseSlug,
        yes: flagBool(flags, 'yes'),
        goLive: flagBool(flags, 'go-live'),
        dryRun: flagBool(flags, 'dry-run')
      });
      return;
    }

    if (command === 'status') {
      printCourseStatus(coursegenApi.status(courseSlug));
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
