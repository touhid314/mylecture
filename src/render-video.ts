// @ts-nocheck
/**
 * render-video.ts
 * Summer 2026, Touhidul Islam
 *
 * Renders a lecture HTML file to video. If the input is an unresolved plan
 * source, this script first calls build-plan.ts to create resolved HTML.
 * It then uses Playwright to render deterministic frames via window.renderAt,
 * mixes narration audio with ffmpeg, and encodes the final MP4 with the best
 * available H.264 encoder.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lecturePageShimScript } from './utils/lecture-page-shims.ts';

const rootDir = process.cwd();

// Default frame-render parallelism follows the local CPU count.
function defaultWorkerCount() {
  return Math.max(1, os.cpus()?.length || 1);
}

// Kokoro audio generation is intentionally capped lower than frame rendering.
function defaultTtsAudioWorkerCount(provider) {
  return (provider === 'kokoro' || provider === 'omnivoice') ? 6 : defaultWorkerCount();
}

export function defaultRenderVideoOptions() {
  return {
    html: path.join('tests', 'fixtures', 'input-contract-test', 'index.html'),
    out: null,
    fps: 60,
    width: 1080,
    height: 1920,
    framesDir: path.join('.render', 'frames'),
    frameFormat: 'jpeg',
    jpegQuality: 90,
    workers: defaultWorkerCount(),
    autoBuildPlan: true,
    forceAudio: false,
    ttsProvider: 'kokoro',
    ttsVoice: 'af_heart',
    ttsSpeed: 1,
    ttsAudioWorkers: null,
    videoCodec: 'auto',
    x264Preset: 'veryfast',
    renderMode: 'stateful',
    resolvedHtml: null,
    premixedAudio: null,
    keepFrames: false,
    maxFrames: null,
    skipVideo: false,
    colorRange: 'tv'
  };
}

export function normalizeRenderVideoOptions(options = {}) {
  const args = {
    ...defaultRenderVideoOptions(),
    ...options
  };

  args.fps = Number(args.fps);
  args.width = Number(args.width);
  args.height = Number(args.height);
  args.jpegQuality = Number(args.jpegQuality);
  args.workers = Number(args.workers);
  args.ttsSpeed = Number(args.ttsSpeed);
  args.renderMode = String(args.renderMode || '').toLowerCase();
  args.frameFormat = String(args.frameFormat || '').toLowerCase();
  args.videoCodec = String(args.videoCodec || '').toLowerCase();
  args.colorRange = String(args.colorRange || '').toLowerCase();
  if (args.maxFrames !== null) args.maxFrames = Number(args.maxFrames);
  if (args.ttsAudioWorkers !== null) args.ttsAudioWorkers = Number(args.ttsAudioWorkers);

  if (!Number.isFinite(args.fps) || args.fps <= 0) throw new Error('--fps must be a positive number');
  if (!Number.isInteger(args.width) || args.width <= 0) throw new Error('--width must be a positive integer');
  if (!Number.isInteger(args.height) || args.height <= 0) throw new Error('--height must be a positive integer');
  if (!['jpeg', 'png'].includes(args.frameFormat)) throw new Error('--frame-format must be either jpeg or png');
  if (!Number.isInteger(args.jpegQuality) || args.jpegQuality < 1 || args.jpegQuality > 100) {
    throw new Error('--jpeg-quality must be an integer from 1 to 100');
  }
  if (!Number.isInteger(args.workers) || args.workers <= 0) throw new Error('--workers must be a positive integer');
  if (!['stateful', 'stateless', 'sequential'].includes(args.renderMode)) {
    throw new Error('--render-mode must be one of: stateful, stateless, sequential');
  }
  if (!args.ttsProvider) throw new Error('--tts-provider must not be empty');
  if (!args.ttsVoice) throw new Error('--tts-voice must not be empty');
  if (!Number.isFinite(args.ttsSpeed) || args.ttsSpeed <= 0) throw new Error('--tts-speed must be a positive number');
  if (args.ttsAudioWorkers === null) {
    args.ttsAudioWorkers = Number(
      process.env.TTS_AUDIO_WORKERS ||
      process.env.KOKORO_TTS_WORKERS ||
      defaultTtsAudioWorkerCount(args.ttsProvider)
    );
  }
  if (!Number.isInteger(args.ttsAudioWorkers) || args.ttsAudioWorkers <= 0) {
    throw new Error('--tts-audio-workers must be a positive integer');
  }
  if (!['auto', 'libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf'].includes(args.videoCodec)) {
    throw new Error('--video-codec must be one of: auto, libx264, h264_nvenc, h264_qsv, h264_amf');
  }
  if (!args.x264Preset) throw new Error('--x264-preset must not be empty');
  if (!['tv', 'pc'].includes(args.colorRange)) throw new Error('--color-range must be "tv" or "pc"');
  if (args.maxFrames !== null && (!Number.isInteger(args.maxFrames) || args.maxFrames <= 0)) {
    throw new Error('--max-frames must be a positive integer');
  }
  if (!args.out) args.out = defaultOutputPath(args.html);

  return args;
}

// Parse render, auto-build, audio, frame, and encoder options from the CLI.
export function parseArgs(argv) {
  const args = defaultRenderVideoOptions();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--html') args.html = next, i++;
    else if (arg === '--out') args.out = next, i++;
    else if (arg === '--fps') args.fps = next, i++;
    else if (arg === '--width') args.width = next, i++;
    else if (arg === '--height') args.height = next, i++;
    else if (arg === '--frames-dir') args.framesDir = next, i++;
    else if (arg === '--frame-format') args.frameFormat = next, i++;
    else if (arg === '--jpeg-quality') args.jpegQuality = next, i++;
    else if (arg === '--workers') args.workers = next, i++;
    else if (arg === '--render-mode') args.renderMode = next, i++;
    else if (arg === '--video-codec') args.videoCodec = next, i++;
    else if (arg === '--x264-preset') args.x264Preset = String(next || '').toLowerCase(), i++;
    else if (arg === '--resolved-html') args.resolvedHtml = next, i++;
    else if (arg === '--premixed-audio') args.premixedAudio = next, i++;
    else if (arg === '--max-frames') args.maxFrames = next, i++;
    else if (arg === '--tts-provider') args.ttsProvider = next, i++;
    else if (arg === '--tts-voice') args.ttsVoice = next, i++;
    else if (arg === '--tts-speed') args.ttsSpeed = next, i++;
    else if (arg === '--tts-audio-workers') args.ttsAudioWorkers = next, i++;
    else if (arg === '--no-auto-build' || arg === '--no-auto-build-plan') args.autoBuildPlan = false;
    else if (arg === '--force-audio') args.forceAudio = true;
    else if (arg === '--keep-frames') args.keepFrames = true;
    else if (arg === '--skip-video') args.skipVideo = true;
    else if (arg === '--color-range') args.colorRange = next, i++;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return normalizeRenderVideoOptions(args);
}

// Human-facing CLI help for the render command.
function printHelp() {
  console.log(`Usage:
  npm run render:video -- [options]

Options:
  --html <file>          HTML file to render. Default: tests/fixtures/input-contract-test/index.html
  --out <file>           Output MP4 path. Default: rendered.mp4, or rendered<suffix>.mp4 for index/resolved variants
  --fps <number>         Frames per second. Default: 60
  --width <pixels>       Viewport width. Default: 1080
  --height <pixels>      Viewport height. Default: 1920
  --frames-dir <dir>     Temporary frame directory. Default: .render/frames
  --frame-format <fmt>   Temporary frame format: jpeg or png. Default: jpeg
  --jpeg-quality <1-100> JPEG quality when --frame-format jpeg. Default: 90
  --workers <number>     Parallel Playwright pages for frame rendering. Default: logical CPU core count
  --render-mode <mode>   Frame scheduling: stateful, stateless, or sequential. Default: stateful
  --video-codec <codec>   MP4 video encoder: auto, libx264, h264_nvenc, h264_qsv, h264_amf. Default: auto
  --x264-preset <preset>  libx264 speed preset. Default: veryfast
  --resolved-html <file>  Output path for auto-built source HTML. Default: sibling resolved.html
  --premixed-audio <file> Use an already mixed audio file instead of building the audio mix
  --no-auto-build         Do not auto-build source HTML before rendering
  --force-audio           Regenerate narration audio when auto-building source HTML
  --tts-provider <name>   TTS provider for auto-build. Default: kokoro
  --tts-voice <name>      TTS voice for auto-build. Default: af_heart
  --tts-speed <number>    TTS speed for auto-build. Default: 1
  --tts-audio-workers <n> Concurrent audio files for auto-build. Default: 6 for Kokoro
  --max-frames <number>  Render only the first N frames for a smoke test
  --keep-frames          Do not delete rendered PNG frames
  --skip-video           Render frames and audio only; do not mux final MP4
  --color-range <tv|pc>  Encoded video color range. Use pc for full-range browser colors. Default: tv
`);
}

// Run a child process while streaming output directly to the terminal.
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...options
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

// Run a child process and capture stdout/stderr for inspection.
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

// Run a child process and return only its exit code for encoder fallback logic.
function runExitCode(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...options
    });

    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
}

// Log elapsed timings consistently across render stages.
function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

// Chromium flags keep file URLs, GPU rendering, WebGL, and background timing stable.
function chromiumLaunchArgs() {
  return [
    '--allow-file-access-from-files',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-accelerated-2d-canvas',
    '--enable-webgl',
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion,BackForwardCache,Translate'
  ];
}

// Each render starts with a clean frame directory to avoid stale frames in ffmpeg input.
function ensureCleanDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// ffmpeg expects a zero-padded numeric image sequence.
function frameName(index, extension) {
  return `frame_${String(index).padStart(6, '0')}.${extension}`;
}

// Resolve user-provided paths relative to the current project root.
function resolveProjectPath(inputPath) {
  return path.resolve(rootDir, inputPath);
}

// Remote assets are passed through; local assets are resolved against the HTML file.
function isRemoteUrl(inputPath) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath);
}

// Audio cue paths are relative to the rendered HTML's folder.
function resolveHtmlAsset(htmlPath, assetPath) {
  if (!assetPath) return null;
  if (isRemoteUrl(assetPath)) return assetPath;
  return path.resolve(path.dirname(htmlPath), assetPath);
}

// Fail early when a required input is missing.
function assertFileExists(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

// Source plan files need build-plan.ts before they can be rendered frame-by-frame.
function isPlanSourceHtml(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  return (
    html.includes('__VIDEO_PLAN__')
  ) && !html.includes('id="resolved-timeline"');
}

// Match the historical rendered*.mp4 naming convention for index/resolved variants.
function defaultOutputPath(htmlPath) {
  const basename = path.basename(htmlPath);
  const match = basename.match(/^(?:index|resolved)(.*)\.html$/i);
  return path.join(path.dirname(htmlPath), `rendered${match?.[1] || ''}.mp4`);
}

// Auto-build defaults to a sibling resolved.html next to the source HTML.
function defaultResolvedPath(htmlPath) {
  return path.join(path.dirname(htmlPath), 'resolved.html');
}

// Detect unresolved plan HTML and produce resolved HTML before frame capture.
async function resolveRenderableHtml(htmlPath, args) {
  if (!args.autoBuildPlan || !isPlanSourceHtml(htmlPath)) {
    return htmlPath;
  }

  const resolvedPath = args.resolvedHtml
    ? resolveProjectPath(args.resolvedHtml)
    : defaultResolvedPath(htmlPath);

  if (path.resolve(resolvedPath) === path.resolve(htmlPath)) {
    throw new Error('Auto-build resolved HTML path must not overwrite the source HTML.');
  }

  console.log(`Detected plan source HTML: ${htmlPath}`);
  console.log(`Building resolved HTML: ${resolvedPath}`);

  const buildArgs = [
    'src/build-plan.ts',
    '--input', htmlPath,
    '--out', resolvedPath,
    '--provider', args.ttsProvider,
    '--voice', args.ttsVoice,
    '--speed', String(args.ttsSpeed),
    '--audio-workers', String(args.ttsAudioWorkers)
  ];

  if (args.forceAudio) buildArgs.push('--force-audio');
  await run(process.execPath, ['--import', 'tsx', ...buildArgs]);
  return resolvedPath;
}

// Build an ffmpeg filter graph that delays and mixes all timeline audio cues.
function buildAudioMixArgs(audioTimeline, htmlPath, outputPath, totalDuration) {
  const inputs = [];
  const filters = [];
  const labels = [];

  audioTimeline.forEach((cue, index) => {
    const src = resolveHtmlAsset(htmlPath, cue.src);
    if (!src || isRemoteUrl(src)) {
      throw new Error(`Audio cue ${index} must point to a local file. Got: ${cue.src || '(empty)'}`);
    }
    assertFileExists(src, `Audio cue ${index}`);

    inputs.push('-i', src);
    const delayMs = Math.max(0, Math.round(Number(cue.start || 0) * 1000));
    const label = `a${index}`;
    filters.push(`[${index}:a]adelay=${delayMs}:all=1,atrim=0:${totalDuration.toFixed(3)},asetpts=N/SR/TB[${label}]`);
    labels.push(`[${label}]`);
  });

  let filterComplex = filters.join(';') + ';';
  if (labels.length === 1) {
    filterComplex += `${labels[0]}apad,atrim=0:${totalDuration.toFixed(3)}[aout]`;
  } else {
    let currentMix = labels[0];
    for (let i = 1; i < labels.length; i++) {
      const isLast = i === labels.length - 1;
      const nextMix = isLast ? '[aout]' : `[m${i}]`;
      filterComplex += `${currentMix}${labels[i]}amix=inputs=2:duration=longest:normalize=0${isLast ? `,apad,atrim=0:${totalDuration.toFixed(3)}` : ''}${nextMix};`;
      currentMix = nextMix;
    }
    if (filterComplex.endsWith(';')) filterComplex = filterComplex.slice(0, -1);
  }

  return [
    '-y',
    '-hide_banner',
    '-loglevel', 'warning',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[aout]',
    '-ar', '48000',
    '-ac', '2',
    outputPath
  ];
}

// Query ffmpeg once so auto codec selection can prefer available hardware encoders.
async function availableFfmpegEncoders() {
  try {
    const { stdout, stderr } = await runCapture('ffmpeg', ['-hide_banner', '-encoders']);
    return `${stdout}\n${stderr}`;
  } catch {
    return '';
  }
}

// Auto mode tries GPU encoders first and falls back to libx264.
async function videoCodecCandidates(requestedCodec) {
  if (requestedCodec !== 'auto') return [requestedCodec];

  const encoders = await availableFfmpegEncoders();
  const preferred = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];
  const detected = preferred.filter(codec => encoders.includes(codec));
  return detected.length > 0 ? detected : ['libx264'];
}

// Encoder-specific ffmpeg arguments stay isolated so fallback behavior is simple.
function videoCodecArgs(codec, args) {
  if (codec === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'fast'];
  }
  if (codec === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-preset', 'veryfast'];
  }
  if (codec === 'h264_amf') {
    return ['-c:v', 'h264_amf', '-quality', 'speed'];
  }
  return ['-c:v', 'libx264', '-preset', args.x264Preset, '-threads', '0'];
}

// Build the final image-sequence-to-MP4 ffmpeg command.
function buildVideoEncodeArgs({ args, codec, framesDir, fps, audioTimeline, mixedAudioPath, outputPath }) {
  const ffmpegArgs = [
    '-y',
    '-hide_banner',
    '-loglevel', 'warning',
    '-framerate', String(fps),
    '-i', path.join(framesDir, `frame_%06d.${args.frameFormat === 'jpeg' ? 'jpg' : 'png'}`)
  ];

  if (audioTimeline.length > 0) {
    ffmpegArgs.push('-i', mixedAudioPath);
  }

  ffmpegArgs.push(
    ...videoCodecArgs(codec, args),
    '-vf', `scale=in_range=pc:out_range=${args.colorRange}`,
    '-pix_fmt', 'yuv420p',
    '-color_range', args.colorRange,
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-r', String(fps)
  );

  if (audioTimeline.length > 0) {
    ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  }

  ffmpegArgs.push(outputPath);
  return ffmpegArgs;
}

// Try candidate encoders in order, preserving explicit codec failures as hard errors.
async function encodeVideoWithFallback({ args, framesDir, fps, audioTimeline, mixedAudioPath, outputPath }) {
  const candidates = await videoCodecCandidates(args.videoCodec);

  for (let index = 0; index < candidates.length; index++) {
    const codec = candidates[index];
    console.log(`Encoding video with ${codec}...`);
    const code = await runExitCode('ffmpeg', buildVideoEncodeArgs({
      args,
      codec,
      framesDir,
      fps,
      audioTimeline,
      mixedAudioPath,
      outputPath
    }));

    if (code === 0) return codec;
    if (args.videoCodec !== 'auto' || index === candidates.length - 1) {
      throw new Error(`ffmpeg video encode failed with ${codec} (exit code ${code})`);
    }

    console.log(`Encoder ${codec} failed; trying ${candidates[index + 1]}...`);
  }

  throw new Error('No usable video encoder found.');
}

// Read the resolved timeline from the page after its scripts have initialized.
async function getTimelineFromPage(page) {
  return await page.evaluate(() => {
    // Inject SFX for Quick Sort Comparison
    if (window.__RESOLVED_TIMELINE__ && window.__RESOLVED_TIMELINE__.videoTimeline) {
      const plan = window.__RESOLVED_TIMELINE__.videoTimeline;
      const audioTimeline = window.__RESOLVED_TIMELINE__.audioTimeline;
      for (const segment of plan) {
          const id = segment.item ? segment.item.id : segment.id;
          if (id && (id.includes('-outro') || id === "winner")) {
              audioTimeline.push({
                  src: '../../../assets/sfx/correct.mp3',
                  start: segment.start,
                  duration: 2
              });
          }
      }
    }
    return window.__RESOLVED_TIMELINE__;
  });
}

// Prepare a Playwright page with export-mode timing and animation suppression.
async function preparePage(browser, url, width, height) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1
  });

  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[page] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    console.error(`[pageerror] ${error.message}`);
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(lecturePageShimScript);
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `
  });
  await page.waitForFunction(() => typeof window.renderAt === 'function' && Number.isFinite(window.__VIDEO_DURATION__));
  return page;
}

// Render one exact timeline frame by calling the page's deterministic renderAt(time).
async function renderSingleFrame(page, framesDir, frame, fps, options, totalFrames) {
  const extension = options.frameFormat === 'jpeg' ? 'jpg' : 'png';
  const time = frame / fps;
  await page.evaluate((t) => window.renderAt(t), time);
  const screenshotOptions = {
    path: path.join(framesDir, frameName(frame, extension)),
    type: 'png',
    animations: 'disabled'
  };

  if (options.frameFormat === 'jpeg') {
    screenshotOptions.type = 'jpeg';
    screenshotOptions.quality = options.jpegQuality;
  }

  await page.screenshot(screenshotOptions);

  if (frame === 0 || frame === totalFrames - 1 || frame % Math.max(1, Math.floor(fps * 2)) === 0) {
    console.log(`Rendered frame ${frame + 1}/${totalFrames} at ${time.toFixed(3)}s`);
  }
}

// Render frames as quickly as possible. This mode requires renderAt(time) to be
// fully independent of previously rendered frames.
async function renderFramesStateless(browser, url, framesDir, frameCount, fps, args) {
  const workerCount = Math.min(args.workers, frameCount);
  const pages = await Promise.all(
    Array.from({ length: workerCount }, () => preparePage(browser, url, args.width, args.height))
  );

  let nextFrame = 0;
  await Promise.all(pages.map(async (page) => {
    while (nextFrame < frameCount) {
      const frame = nextFrame++;
      await renderSingleFrame(page, framesDir, frame, fps, args, frameCount);
    }
  }));

  await Promise.all(pages.map(page => page.close()));
}

function frameChunks(frameCount, workerCount) {
  const chunkCount = Math.min(workerCount, frameCount);
  const baseSize = Math.floor(frameCount / chunkCount);
  const remainder = frameCount % chunkCount;
  const chunks = [];
  let start = 0;

  for (let index = 0; index < chunkCount; index++) {
    const size = baseSize + (index < remainder ? 1 : 0);
    chunks.push({ index, start, end: start + size });
    start += size;
  }

  return chunks;
}

// Replay frames without screenshots so a chunk starts with the same DOM state
// it would have had in one-page sequential playback.
async function warmPageToFrame(page, startFrame, fps, workerIndex) {
  if (startFrame <= 0) return;
  console.log(`Worker ${workerIndex + 1}: warming ${startFrame} frame(s) before capture`);
  for (let frame = 0; frame < startFrame; frame++) {
    await page.evaluate((t) => window.renderAt(t), frame / fps);
  }
}

async function renderFrameRange(page, framesDir, startFrame, endFrame, fps, args, totalFrames) {
  for (let frame = startFrame; frame < endFrame; frame++) {
    await renderSingleFrame(page, framesDir, frame, fps, args, totalFrames);
  }
}

// Stateful-compatible parallel rendering. Each worker captures a contiguous
// range after replaying earlier frames, preserving sequential playback state at
// chunk boundaries while still parallelizing screenshot capture.
async function renderFramesStateful(browser, url, framesDir, frameCount, fps, args) {
  const chunks = frameChunks(frameCount, Math.min(args.workers, frameCount));
  await Promise.all(chunks.map(async (chunk) => {
    const page = await preparePage(browser, url, args.width, args.height);
    try {
      await warmPageToFrame(page, chunk.start, fps, chunk.index);
      await renderFrameRange(page, framesDir, chunk.start, chunk.end, fps, args, frameCount);
    } finally {
      await page.close();
    }
  }));
}

async function renderFramesSequential(browser, url, framesDir, frameCount, fps, args) {
  const page = await preparePage(browser, url, args.width, args.height);
  try {
    await renderFrameRange(page, framesDir, 0, frameCount, fps, args, frameCount);
  } finally {
    await page.close();
  }
}

async function renderFrames(browser, url, framesDir, frameCount, fps, args) {
  if (args.renderMode === 'stateless') {
    await renderFramesStateless(browser, url, framesDir, frameCount, fps, args);
    return;
  }

  if (args.renderMode === 'sequential' || args.workers === 1) {
    await renderFramesSequential(browser, url, framesDir, frameCount, fps, args);
    return;
  }

  await renderFramesStateful(browser, url, framesDir, frameCount, fps, args);
}

// Prefer explicit video metadata, then inspect known frame containers, then canvas size.
async function detectPageViewport(page) {
  return await page.evaluate(() => {
    const presets = {
      '9:16': { width: 1080, height: 1920 },
      '16:9': { width: 1920, height: 1080 },
      '1:1': { width: 1080, height: 1080 },
      '4:5': { width: 1080, height: 1350 }
    };
    
    const aspectRatio = window.__VIDEO_METADATA__?.aspectRatio;
    if (aspectRatio) {
      const normalized = String(aspectRatio).trim();
      if (presets[normalized]) return presets[normalized];
      
      const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
      if (match) {
        const widthRatio = Number(match[1]);
        const heightRatio = Number(match[2]);
        if (Number.isFinite(widthRatio) && Number.isFinite(heightRatio) && widthRatio > 0 && heightRatio > 0) {
          const longEdge = 1920;
          if (widthRatio >= heightRatio) {
            return {
              width: longEdge,
              height: Math.round(longEdge * heightRatio / widthRatio)
            };
          } else {
            return {
              width: Math.round(longEdge * widthRatio / heightRatio),
              height: longEdge
            };
          }
        }
      }
    }

    const candidates = [
      document.getElementById('frame'),
      document.querySelector('.video-frame'),
      document.getElementById('video-frame'),
      document.getElementById('player-container')
    ].filter(Boolean);

    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      const cssWidth = parseFloat(style.width);
      const cssHeight = parseFloat(style.height);
      if (Number.isFinite(cssWidth) && Number.isFinite(cssHeight) && cssWidth >= 320 && cssHeight >= 240) {
        const rounded = { width: Math.round(cssWidth), height: Math.round(cssHeight) };
        const ratio = rounded.width / rounded.height;
        if (ratio > 1.2 || ratio < 0.85) return rounded;
      }
    }

    const canvas = document.querySelector('canvas[width][height]');
    if (canvas) {
      const width = Number(canvas.getAttribute('width'));
      const height = Number(canvas.getAttribute('height'));
      if (Number.isFinite(width) && Number.isFinite(height) && width >= 320 && height >= 240) {
        return { width, height };
      }
    }

    return null;
  });
}

// Programmatic renderer API. The CLI below is a thin wrapper around this.
export async function renderVideo(options = {}) {
  const totalStart = performance.now();
  const args = normalizeRenderVideoOptions(options);
  const sourceHtmlPath = resolveProjectPath(args.html);
  assertFileExists(sourceHtmlPath, 'HTML file');
  const htmlPath = await resolveRenderableHtml(sourceHtmlPath, args);
  const outputPath = resolveProjectPath(args.out);
  const framesDir = resolveProjectPath(args.framesDir);
  const renderDir = path.dirname(framesDir);
  const mixedAudioPath = path.join(renderDir, 'mixed-audio.wav');
  const premixedAudioPath = args.premixedAudio ? resolveProjectPath(args.premixedAudio) : null;

  assertFileExists(htmlPath, 'Renderable HTML file');
  mkdirSync(renderDir, { recursive: true });
  ensureCleanDir(framesDir);

  const browser = await chromium.launch({
    args: chromiumLaunchArgs()
  });
  const url = `${pathToFileURL(htmlPath).href}?export=1`;
  const timelinePage = await preparePage(browser, url, args.width, args.height);

  const detectedViewport = await detectPageViewport(timelinePage);
  if (detectedViewport) {
    console.log(`Auto-detected viewport from metadata: ${detectedViewport.width}x${detectedViewport.height} (originally: ${args.width}x${args.height})`);
    args.width = detectedViewport.width;
    args.height = detectedViewport.height;
  }

  const timeline = await getTimelineFromPage(timelinePage);
  await timelinePage.close();

  if (timeline && Array.isArray(timeline.audioTimeline)) {
    for (const cue of timeline.audioTimeline) {
      if (cue.src && cue.src.includes('assets/sfx/correct.mp3')) {
        const absoluteCorrectPath = path.resolve(rootDir, 'assets', 'sfx', 'correct.mp3');
        const htmlDir = path.dirname(htmlPath);
        const relativeSrc = path.relative(htmlDir, absoluteCorrectPath);
        cue.src = relativeSrc.replace(/\\/g, '/');
      }
    }
  }
  const totalDuration = Number(timeline.duration);
  const audioTimeline = Array.isArray(timeline.audioTimeline) ? timeline.audioTimeline : [];

  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    throw new Error(`Invalid video duration from page: ${timeline.duration}`);
  }

  const fullFrameCount = Math.ceil(totalDuration * args.fps);
  const frameCount = args.maxFrames ? Math.min(args.maxFrames, fullFrameCount) : fullFrameCount;
  const renderDuration = frameCount / args.fps;

  console.log(`HTML: ${sourceHtmlPath}`);
  if (htmlPath !== sourceHtmlPath) console.log(`Renderable HTML: ${htmlPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Viewport: ${args.width}x${args.height}, fps: ${args.fps}`);
  const activeFrameWorkers = args.renderMode === 'sequential' ? 1 : Math.min(args.workers, frameCount);
  console.log(`Frame format: ${args.frameFormat}${args.frameFormat === 'jpeg' ? ` quality ${args.jpegQuality}` : ''}, workers: ${activeFrameWorkers}, mode: ${args.renderMode}`);
  console.log(`Video codec: ${args.videoCodec}${args.videoCodec === 'libx264' || args.videoCodec === 'auto' ? `, x264 preset: ${args.x264Preset}` : ''}`);
  console.log(`Timeline duration: ${totalDuration.toFixed(3)}s, frames: ${frameCount}${args.maxFrames ? `/${fullFrameCount}` : ''}`);
  console.log(`Audio cues: ${audioTimeline.length}`);

  const renderStart = performance.now();
  await renderFrames(browser, url, framesDir, frameCount, args.fps, args);
  await browser.close();
  const renderElapsed = performance.now() - renderStart;
  console.log(`Frame rendering time: ${formatSeconds(renderElapsed)} (${(frameCount / (renderElapsed / 1000)).toFixed(2)} fps effective)`);

  const audioDuration = args.maxFrames ? renderDuration : totalDuration;
  let audioInputPath = mixedAudioPath;
  let encodeAudioTimeline = audioTimeline;
  if (premixedAudioPath) {
    assertFileExists(premixedAudioPath, 'Premixed audio');
    audioInputPath = premixedAudioPath;
    encodeAudioTimeline = [{ start: 0, duration: totalDuration, src: premixedAudioPath }];
    console.log(`Using premixed audio: ${premixedAudioPath}`);
  } else if (audioTimeline.length > 0) {
    console.log('Mixing audio...');
    const audioStart = performance.now();
    await run('ffmpeg', buildAudioMixArgs(audioTimeline, htmlPath, mixedAudioPath, audioDuration));
    console.log(`Audio mix time: ${formatSeconds(performance.now() - audioStart)}`);
  }

  if (!args.skipVideo) {
    const encodeStart = performance.now();
    const encoder = await encodeVideoWithFallback({
      args,
      framesDir,
      fps: args.fps,
      audioTimeline: encodeAudioTimeline,
      mixedAudioPath: audioInputPath,
      outputPath
    });
    console.log(`Video encode time: ${formatSeconds(performance.now() - encodeStart)} using ${encoder}`);

    if (!premixedAudioPath) rmSync(mixedAudioPath, { force: true });
  }

  if (!args.keepFrames) {
    rmSync(framesDir, { recursive: true, force: true });
  } else {
    const renderedCount = readdirSync(framesDir).filter((name) => name.endsWith(args.frameFormat === 'jpeg' ? '.jpg' : '.png')).length;
    console.log(`Kept ${renderedCount} frames in ${framesDir}`);
  }

  console.log(`Total render command time: ${formatSeconds(performance.now() - totalStart)}`);
  console.log('Render complete.');
  return {
    html: sourceHtmlPath,
    renderableHtml: htmlPath,
    output: outputPath,
    framesDir,
    duration: totalDuration,
    frameCount,
    fps: args.fps,
    skippedVideo: args.skipVideo
  };
}

// CLI entrypoint: parse args and call the typed renderer API.
async function main() {
  await renderVideo(parseArgs(process.argv.slice(2)));
}

const isCliEntrypoint = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCliEntrypoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
