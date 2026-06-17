// @ts-nocheck
/**
 * build-plan.ts
 * Summer 2026, Touhidul Islam
 *
 * Resolves a source lecture HTML file into a renderable HTML file.
 * The source page exposes a video plan on window.__VIDEO_PLAN__. This script
 * reads that plan in Playwright, generates or reuses narration audio,
 * measures audio duration with ffprobe, builds the resolved timelines,
 * and injects the runtime metadata needed by the renderer and IDE.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();

// Worker defaults are intentionally based on local machine capacity, except Kokoro
// TTS is capped lower because concurrent model startup can be expensive.
function defaultWorkerCount() {
  return Math.max(1, os.cpus()?.length || 1);
}

function defaultAudioWorkerCount(provider) {
  return provider === 'kokoro' ? 6 : defaultWorkerCount();
}

// Parse CLI options for resolving source HTML into timeline-ready HTML.
function parseArgs(argv) {
  const args = {
    input: path.join('tests', 'fixtures', 'plan-pipeline', 'source.html'),
    out: path.join('tests', 'fixtures', 'plan-pipeline', 'index.html'),
    provider: 'kokoro',
    voice: 'af_heart',
    speed: 1,
    audioWorkers: null,
    forceAudio: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--input') args.input = next, i++;
    else if (arg === '--out') args.out = next, i++;
    else if (arg === '--provider') args.provider = next, i++;
    else if (arg === '--voice') args.voice = next, i++;
    else if (arg === '--speed') args.speed = Number(next), i++;
    else if (arg === '--audio-workers') args.audioWorkers = Number(next), i++;
    else if (arg === '--force-audio') args.forceAudio = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.speed) || args.speed <= 0) {
    throw new Error('--speed must be a positive number');
  }

  if (args.audioWorkers === null) {
    args.audioWorkers = Number(
      process.env.TTS_AUDIO_WORKERS ||
      process.env.KOKORO_TTS_WORKERS ||
      defaultAudioWorkerCount(args.provider)
    );
  }
  if (!Number.isInteger(args.audioWorkers) || args.audioWorkers <= 0) {
    throw new Error('--audio-workers must be a positive integer');
  }

  return args;
}

// Human-facing CLI help kept close to parseArgs so option behavior is easy to audit.
function printHelp() {
  console.log(`Usage:
  npm run build:plan -- [options]

Options:
  --input <file>       Source HTML. Default: tests/fixtures/plan-pipeline/source.html
  --out <file>         Final renderable HTML. Default: tests/fixtures/plan-pipeline/index.html
  --provider <name>    TTS provider passed to src/utils/tts.py. Default: kokoro
  --voice <name>       TTS voice passed to src/utils/tts.py. Default: af_heart
  --speed <number>     TTS speed passed to src/utils/tts.py. Default: 1
  --audio-workers <n>  Concurrent audio files to generate. Default: 6 for Kokoro, CPU count otherwise
  --force-audio        Regenerate narration audio even if files already exist
`);
}

// Run a child command while streaming its output directly to this process.
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...options
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

// Run a child command and return stdout, used for tools where the output is data.
function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => stdout += data.toString());
    child.stderr.on('data', data => stderr += data.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

// Resolve user-provided paths relative to the repository root.
function resolveProjectPath(inputPath) {
  return path.resolve(rootDir, inputPath);
}

// HTML references should be slash-separated even on Windows.
function toPosixRelative(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join('/');
}

// Safely embed JSON into an HTML script tag without allowing a raw "<" escape hatch.
function jsString(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Accept legacy and shorthand section names while normalizing to the resolver contract.
function normalizeSectionKind(kind) {
  if (kind === 'visual-only' || kind === 'visual') return 'visual-only';
  if (kind === 'narration+visual' || kind === 'narration') return 'narration+visual';
  return kind;
}

// Narration sections default to audio/<section-id>.wav and only write WAV files.
function normalizeAudioRequest(requestedAudio, sectionId) {
  const rawAudio = requestedAudio || `audio/${sectionId}.wav`;
  const parsed = path.parse(rawAudio);

  if (!parsed.ext) {
    return `${rawAudio}.wav`;
  }

  if (parsed.ext.toLowerCase() === '.wav') {
    return rawAudio;
  }

  return path.join(parsed.dir, `${parsed.name}.wav`);
}

// File existence checks are wrapped because statSync throws for missing paths.
function isFile(pathName) {
  try {
    return statSync(pathName).isFile();
  } catch {
    return false;
  }
}

// Load the source HTML in Chromium so the plan is read after the page's scripts run.
async function readPlanFromHtml(inputPath) {
  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  const errors = [];

  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(inputPath).href, { waitUntil: 'load' });
  const plan = await page.evaluate(() => window.__VIDEO_PLAN__);
  await browser.close();

  if (errors.length > 0) {
    throw new Error(`Source page errors:\n${errors.join('\n')}`);
  }
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('Source HTML must expose a non-empty window.__VIDEO_PLAN__ array.');
  }

  return plan;
}

// Single-file TTS helper retained for direct generation paths; batch generation below
// is the main path for normal resolve runs.
async function generateAudio({ text, outputPath, provider, voice, speed }) {
  const code = [
    'import os',
    'import sys',
    'from pathlib import Path',
    'sys.path.insert(0, str(Path(os.environ["PROJECT_ROOT"]) / "src" / "utils"))',
    'from tts import tts',
    'tts(',
    '    os.environ["TTS_TEXT"],',
    '    provider=os.environ.get("TTS_PROVIDER", "kokoro"),',
    '    voice=os.environ.get("TTS_VOICE") or None,',
    '    output_path=os.environ["TTS_OUTPUT"],',
    '    speed=float(os.environ.get("TTS_SPEED", "1.0")),',
    ')'
  ].join('\n');

  await run('python', ['-c', code], {
    cwd: rootDir,
    env: {
      ...process.env,
      PROJECT_ROOT: rootDir,
      TTS_TEXT: text,
      TTS_OUTPUT: outputPath,
      TTS_PROVIDER: provider,
      TTS_VOICE: voice,
      TTS_SPEED: String(speed)
    }
  });
}

// Generate missing narration audio in one Python process to avoid repeated model loads.
async function runAudioJobs(audioJobs, maxWorkers) {
  if (audioJobs.length === 0) return;

  console.log(`Generating ${audioJobs.length} audio file(s) in a single batch with ${maxWorkers} workers...`);
  const tempJobsFile = path.resolve(rootDir, '.tmp', `jobs_${Date.now()}.json`);
  mkdirSync(path.dirname(tempJobsFile), { recursive: true });
  writeFileSync(tempJobsFile, JSON.stringify(audioJobs, null, 2), 'utf8');

  const code = [
    'import os',
    'import sys',
    'import json',
    'from concurrent.futures import ThreadPoolExecutor',
    'from pathlib import Path',
    'sys.path.insert(0, str(Path(os.environ["PROJECT_ROOT"]) / "src" / "utils"))',
    'from tts import tts',
    '',
    'jobs_file = os.environ["TTS_JOBS_FILE"]',
    'max_workers = int(os.environ.get("TTS_MAX_WORKERS", "6"))',
    'with open(jobs_file, "r", encoding="utf-8") as f:',
    '    jobs = json.load(f)',
    '',
    'def run_job(job):',
    '    print(f"Generating audio for {job[\'sectionId\']} -> {job[\'displayPath\']}", flush=True)',
    '    tts(',
    '        job["text"],',
    '        provider=job["provider"],',
    '        voice=job["voice"],',
    '        output_path=job["outputPath"],',
    '        speed=job["speed"]',
    '    )',
    '',
    'if len(jobs) > 0:',
    '    # Warm up sequentially first to cache the session and avoid concurrent CUDA initialization',
    '    run_job(jobs[0])',
    'if len(jobs) > 1:',
    '    with ThreadPoolExecutor(max_workers=max_workers) as executor:',
    '        list(executor.map(run_job, jobs[1:]))',
    '',
    'try:',
    '    os.unlink(jobs_file)',
    'except:',
    '    pass'
  ].join('\n');

  try {
    await run('python', ['-c', code], {
      cwd: rootDir,
      env: {
        ...process.env,
        PROJECT_ROOT: rootDir,
        TTS_JOBS_FILE: tempJobsFile,
        TTS_MAX_WORKERS: String(maxWorkers)
      }
    });
  } catch (error) {
    if (existsSync(tempJobsFile)) {
      try {
        unlinkSync(tempJobsFile);
      } catch (_) {}
    }
    throw error;
  }
}

// ffprobe gives the actual narration length; this drives the final timeline timing.
async function measureAudioDuration(audioPath) {
  const output = await runCapture('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nk=1:nw=1',
    audioPath
  ]);
  const duration = Number(output);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not measure audio duration for ${audioPath}`);
  }
  return duration;
}

// Convert the authored plan into render and audio timelines.
async function resolveTimeline(plan, inputPath, outputPath, args) {
  const outputDir = path.dirname(outputPath);

  let cursor = 0;
  const videoTimeline = [];
  const audioTimeline = [];
  const audioInfoBySection = new Map();
  const audioJobs = [];

  // First pass: decide which narration files need to exist before timing can be resolved.
  for (const [index, section] of plan.entries()) {
    if (!section || typeof section !== 'object') {
      throw new Error(`Plan item ${index} must be an object.`);
    }
    if (!section.id) {
      throw new Error(`Plan item ${index} is missing id.`);
    }

    const sectionKind = normalizeSectionKind(section.kind);

    if (sectionKind === 'narration+visual') {
      if (!section.text || !String(section.text).trim()) {
        throw new Error(`Narration+visual section "${section.id}" must include text.`);
      }

      const requestedAudio = normalizeAudioRequest(section.audio, section.id);
      const audioPath = path.resolve(outputDir, requestedAudio);
      const displayPath = toPosixRelative(outputPath, audioPath);
      mkdirSync(path.dirname(audioPath), { recursive: true });
      audioInfoBySection.set(section.id, { audioPath, displayPath });

      if (section.audio && section.audio !== requestedAudio) {
        console.log(`Normalized audio path for ${section.id}: ${section.audio} -> ${requestedAudio}`);
      }

      if (args.forceAudio || !isFile(audioPath)) {
        audioJobs.push({
          sectionId: section.id,
          text: section.text,
          outputPath: audioPath,
          displayPath,
          provider: args.provider,
          voice: args.voice,
          speed: args.speed
        });
      } else {
        console.log(`Using existing audio for ${section.id} -> ${displayPath}`);
      }
    }
  }

  await runAudioJobs(audioJobs, args.audioWorkers);

  // Second pass: construct the ordered timelines now that narration durations are known.
  for (const [index, section] of plan.entries()) {
    if (!section || typeof section !== 'object') {
      throw new Error(`Plan item ${index} must be an object.`);
    }
    if (!section.id) {
      throw new Error(`Plan item ${index} is missing id.`);
    }

    const sectionKind = normalizeSectionKind(section.kind);

    if (sectionKind === 'visual-only') {
      const duration = Number(section.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Visual-only section "${section.id}" must declare a positive duration.`);
      }

      const item = { ...section, kind: sectionKind, resolvedDuration: duration };
      videoTimeline.push({
        start: cursor,
        end: cursor + duration,
        duration,
        sectionId: section.id,
        item
      });
      cursor += duration;
      continue;
    }

    if (sectionKind === 'narration+visual') {
      if (!section.text || !String(section.text).trim()) {
        throw new Error(`Narration+visual section "${section.id}" must include text.`);
      }

      const audioInfo = audioInfoBySection.get(section.id);
      if (!audioInfo) {
        throw new Error(`Internal error: missing audio info for "${section.id}".`);
      }

      const duration = await measureAudioDuration(audioInfo.audioPath);
      const audioSrc = audioInfo.displayPath;
      const item = { ...section, kind: sectionKind, audio: audioSrc, resolvedDuration: duration };

      videoTimeline.push({
        start: cursor,
        end: cursor + duration,
        duration,
        sectionId: section.id,
        item
      });
      audioTimeline.push({
        start: cursor,
        duration,
        src: audioSrc,
        text: section.text,
        sectionId: section.id
      });
      cursor += duration;
      continue;
    }

    throw new Error(`Plan item "${section.id}" has unsupported kind: ${section.kind}. Use "visual-only" or "narration+visual".`);
  }

  return {
    duration: cursor,
    videoTimeline,
    audioTimeline
  };
}

// Inject resolved metadata and a deterministic renderAt(time) runtime into the output HTML.
function writeResolvedHtml(inputPath, outputPath, timeline, resolvedAt = new Date().toISOString()) {
  const source = readFileSync(inputPath, 'utf8');
  const sourceDir = path.dirname(inputPath);
  const outputDir = path.dirname(outputPath);
  const needsBaseHref = path.resolve(sourceDir) !== path.resolve(outputDir) && !/<base\s/i.test(source);
  const baseHref = pathToFileURL(`${sourceDir}${path.sep}`).href;
  const sourceWithBase = needsBaseHref && /<\/head>/i.test(source)
    ? source.replace(/<\/head>/i, `<base href="${baseHref}">\n</head>`)
    : source;
  const injection = [
    '<style id="resolved-export-motion-guard">',
    'body.export-mode:not(.viewer-mode) *, body.export-mode:not(.viewer-mode) *::before, body.export-mode:not(.viewer-mode) *::after {',
    '  animation: none !important;',
    '  transition: none !important;',
    '}',
    '</style>',
    '<script id="resolved-metadata">',
    `window.__VIDEO_METADATA__ = { ...(window.__VIDEO_METADATA__ || {}), lastResolved: ${jsString(resolvedAt)} };`,
    '</script>',
    '<script id="resolved-timeline">',
    `window.__RESOLVED_TIMELINE__ = ${jsString(timeline)};`,
    '</script>',
    '<script id="resolved-render-runtime">',
    `(() => {
  const timeline = window.__RESOLVED_TIMELINE__;
  if (!timeline) return;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const videoTimeline = Array.isArray(timeline.videoTimeline) ? timeline.videoTimeline : [];
  const audioTimeline = Array.isArray(timeline.audioTimeline) ? timeline.audioTimeline : [];

  window.__VIDEO_DURATION__ = Number(timeline.duration) || 0;
  window.__VIDEO_TIMELINE__ = videoTimeline;
  window.__AUDIO_TIMELINE__ = audioTimeline;

  function updateOptionalControls(time) {
    const total = window.__VIDEO_DURATION__ || 0;
    const scrubber = document.getElementById("scrubber");
    if (scrubber) {
      scrubber.max = total.toFixed(3);
      scrubber.value = time.toFixed(3);
    }

    const readout = document.getElementById("readout") || document.getElementById("time-display");
    if (readout) {
      const mins = Math.floor(time / 60);
      const secs = Math.floor(time % 60).toString().padStart(2, "0");
      readout.textContent = readout.id === "time-display"
        ? \`\${mins}:\${secs}\`
        : \`\${time.toFixed(2)} / \${total.toFixed(2)}\`;
    }

    const progress = document.getElementById("progress-fill");
    if (progress && total > 0) {
      progress.style.width = \`\${(time / total) * 100}%\`;
    }
  }

  window.renderAt = function renderAt(time) {
    const total = window.__VIDEO_DURATION__ || 0;
    const activeTime = clamp(Number(time) || 0, 0, total);
    window.__CURRENT_RENDER_TIME__ = activeTime;

    let cue = videoTimeline[0];
    for (const candidate of videoTimeline) {
      if (candidate.start <= activeTime) cue = candidate;
      if (candidate.start > activeTime) break;
    }

    const renderSection = window.__RENDER_SECTION__ || window.__HTML_RENDER_SECTION__ || window.__AI_RENDER_SECTION__;
    if (cue && typeof renderSection === "function") {
      renderSection(cue.item, activeTime - cue.start, activeTime);
    }

    updateOptionalControls(activeTime);
    return activeTime;
  };

  const renderInitial = () => window.renderAt(0);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderInitial, { once: true });
  } else {
    renderInitial();
  }
})();`,
    '</script>'
  ].join('\n');

  const html = sourceWithBase.includes('</body>')
    ? sourceWithBase.replace('</body>', `${injection}\n</body>`)
    : `${sourceWithBase}\n${injection}\n`;

  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error('Refusing to overwrite input HTML. Use a separate --out path.');
  }
  writeFileSync(outputPath, html, 'utf8');
}

// CLI entrypoint: read source plan, resolve media/timing, and write renderable HTML.
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolveProjectPath(args.input);
  const outputPath = resolveProjectPath(args.out);

  if (!existsSync(inputPath)) {
    throw new Error(`Input HTML does not exist: ${inputPath}`);
  }

  const plan = await readPlanFromHtml(inputPath);
  const timeline = await resolveTimeline(plan, inputPath, outputPath, args);
  writeResolvedHtml(inputPath, outputPath, timeline);

  console.log(`Resolved duration: ${timeline.duration.toFixed(3)}s`);
  console.log(`Audio cues: ${timeline.audioTimeline.length}`);
  console.log(`Wrote ${outputPath}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
