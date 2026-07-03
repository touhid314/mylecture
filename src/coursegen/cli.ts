import { loadEnv } from './env.ts';
import { rootDir } from './paths.ts';
import { planCourse } from './plan-course.ts';
import { publishCourse } from './publish-course.ts';
import { printCourseStatus, runCourse } from './run-course.ts';
import { AUDIENCES, DEFAULT_LEARNING_INTENT, LEARNING_INTENTS, isLearningIntent, type Audience } from './types.ts';

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

function printHelp() {
  console.log(`MyLecture course generator

Usage:
  npm run coursegen -- plan --topic <text> --audience <level> [options]
  npm run coursegen -- run --course <slug> [options]
  npm run coursegen -- resume --course <slug> [options]
  npm run coursegen -- publish --course <slug> [options]
  npm run coursegen -- status --course <slug>

Audiences: ${AUDIENCES.join(', ')}
Learning intents: ${LEARNING_INTENTS.join(', ')}

Plan options:
  --scope <text>           Narrow the unit scope
  --intent <name>          Learning intent (default ${DEFAULT_LEARNING_INTENT})
  --lectures <n>           Target lecture count (default 12, max 30)
  --budget <usd>           Budget cap for later run (default 5)
  --model <name>           Override AGENT_MODEL
  --dry-run                Print prompts only

Run / resume options:
  --yes                    Skip confirmation prompt
  --budget <usd>           Budget cap (default from state or 5)
  --max-turns <n>          Agent turn cap per video lecture (default 60)
  --max-practice-turns <n> Agent turn cap per interactive/game pass (default 40)
  --skip-practice-review   Skip screenshot QA (dev only)
  --lecture-timeout <min>  Kill hung agent generation after N minutes (resolve/render not covered) (default 20)
  --retry-failed           Retry failed lectures only
  --force-lecture <slug>   Regenerate one lecture (ignores budget/attempt caps)
  --tts-voice <voice>
  --tts-speed <speed>
  --dry-run                Print per-lecture prompts only

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

    if (command === 'plan') {
      const topic = flagString(flags, 'topic');
      const audience = flagString(flags, 'audience') as Audience;
      if (!topic) throw new Error('--topic is required');
      if (!AUDIENCES.includes(audience)) {
        throw new Error(`--audience must be one of: ${AUDIENCES.join(', ')}`);
      }
      const intent = flagString(flags, 'intent', DEFAULT_LEARNING_INTENT);
      if (!isLearningIntent(intent)) {
        throw new Error(`--intent must be one of: ${LEARNING_INTENTS.join(', ')}`);
      }
      await planCourse({
        topic,
        audience,
        intent,
        scope: flagString(flags, 'scope') || undefined,
        maxLectures: flagIntegerRange(flags, 'lectures', 12, 1, 30),
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run'),
        budgetUsd: flagPositiveNumber(flags, 'budget', 5)
      });
      return;
    }

    const courseSlug = flagString(flags, 'course');
    if (!courseSlug && command !== 'help') {
      throw new Error('--course <slug> is required');
    }

    if (command === 'run' || command === 'resume') {
      await runCourse({
        courseSlug,
        yes: flagBool(flags, 'yes'),
        budgetUsd: flags.budget !== undefined ? flagPositiveNumber(flags, 'budget', 5) : undefined,
        maxTurns: flagIntegerRange(flags, 'max-turns', 60, 1, 500),
        maxPracticeTurns: flagIntegerRange(flags, 'max-practice-turns', 40, 1, 500),
        skipPracticeReview: flagBool(flags, 'skip-practice-review'),
        lectureTimeoutMinutes: flagPositiveNumber(flags, 'lecture-timeout', 20),
        retryFailed: command === 'resume' || flagBool(flags, 'retry-failed'),
        forceLecture: flagString(flags, 'force-lecture') || undefined,
        ttsVoice: flagString(flags, 'tts-voice') || undefined,
        ttsSpeed: flagString(flags, 'tts-speed') || undefined,
        model: flagString(flags, 'model') || undefined,
        dryRun: flagBool(flags, 'dry-run')
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
