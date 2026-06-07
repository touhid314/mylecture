import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();

function parseArgs(argv) {
  const args = {
    input: '',
    output: '',
    srt: '',
    autoWhisper: false,
    whisperModel: 'base',
    layout: 'overlay',
    belowPixels: null,
    belowAspect: '',
    belowHeightAspect: '',
    keepTemp: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--input') args.input = next, i++;
    else if (arg === '--out') args.output = next, i++;
    else if (arg === '--srt') args.srt = next, i++;
    else if (arg === '--auto-whisper') args.autoWhisper = true;
    else if (arg === '--whisper-model') args.whisperModel = next, i++;
    else if (arg === '--layout') args.layout = String(next || '').toLowerCase(), i++;
    else if (arg === '--below-pixels') args.belowPixels = Number(next), i++;
    else if (arg === '--below-aspect') args.belowAspect = next, i++;
    else if (arg === '--below-height-aspect') args.belowHeightAspect = next, i++;
    else if (arg === '--keep-temp') args.keepTemp = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) throw new Error('--input is required');
  if (!args.output) args.output = defaultOutputPath(args.input, args.layout);
  if (!args.srt && !args.autoWhisper) throw new Error('Provide --srt <file> or --auto-whisper');
  if (!['overlay', 'below'].includes(args.layout)) throw new Error('--layout must be overlay or below');
  if (args.belowPixels !== null && (!Number.isInteger(args.belowPixels) || args.belowPixels <= 0)) {
    throw new Error('--below-pixels must be a positive integer');
  }
  if (args.belowAspect && args.belowHeightAspect) {
    throw new Error('Use only one of --below-aspect or --below-height-aspect');
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run subtitle:burn -- --input rendered.mp4 --srt captions.srt --out rendered-subtitled.mp4

Options:
  --input <file>          Rendered MP4 to subtitle.
  --out <file>            Output MP4. Default: <input>-subtitled.mp4 or <input>-subtitled-below.mp4
  --srt <file>            Subtitle source.
  --auto-whisper          Generate SRT using a local whisper CLI, then burn it.
  --whisper-model <name>  Whisper model when --auto-whisper is used. Default: base
  --layout <mode>         overlay or below. Default: overlay
  --below-pixels <n>      Caption band height for --layout below. Default: 5% of added height.
  --below-aspect <w:h>    Target output width:height for --layout below. Default: 9:16.
  --below-height-aspect <h:w>
                          Target output height:width for --layout below. Adds bottom padding only.
  --keep-temp             Keep generated ASS/SRT temp files.
`);
}

function resolveProjectPath(filePath) {
  return path.resolve(rootDir, filePath);
}

function assertFileExists(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
}

function defaultOutputPath(inputPath, layout) {
  const parsed = path.parse(inputPath);
  const suffix = layout === 'below' ? '-subtitled-below' : '-subtitled';
  return path.join(parsed.dir, `${parsed.name}${suffix}.mp4`);
}

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

async function probeVideo(inputPath) {
  const { stdout } = await runCapture('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    inputPath
  ]);
  const stream = JSON.parse(stdout).streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`Could not read video dimensions from ${inputPath}`);
  }
  return { width, height };
}

function parseSrtTime(value) {
  const match = String(value).trim().match(/^(\d+):(\d+):(\d+),(\d+)$/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  const [, h, m, s, ms] = match.map(Number);
  return h * 3600 + m * 60 + s + ms / 1000;
}

function parseSrt(srt) {
  return String(srt)
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n').filter(Boolean);
      const timingIndex = lines.findIndex(line => line.includes('-->'));
      if (timingIndex === -1) return null;
      const [start, end] = lines[timingIndex].split('-->').map(part => part.trim().split(/\s+/)[0]);
      const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (!text) return null;
      return { start: parseSrtTime(start), end: parseSrtTime(end), text };
    })
    .filter(cue => cue && cue.end > cue.start);
}

function chunkWords(text, maxWords = 8) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [words.join(' ')];
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
}

function splitCues(cues) {
  const result = [];
  for (const cue of cues) {
    const chunks = chunkWords(cue.text);
    const duration = cue.end - cue.start;
    const chunkDuration = duration / chunks.length;
    chunks.forEach((text, index) => {
      result.push({
        start: cue.start + chunkDuration * index,
        end: cue.start + chunkDuration * (index + 1),
        text
      });
    });
  }
  return result;
}

function assTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe - Math.floor(safe)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text) {
  return String(text)
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, '\\N');
}

function buildAss(cues, dimensions, layout, bandHeight) {
  const { width, height } = dimensions;
  const fontSize = layout === 'below'
    ? Math.max(54, Math.min(72, Math.round((bandHeight || height * 0.125) * 0.56)))
    : Math.max(30, Math.min(62, Math.round(height * 0.036)));
  const marginV = layout === 'below'
    ? Math.max(12, Math.round((bandHeight || height * 0.125) * 0.16))
    : Math.max(54, Math.round(height * 0.08));
  const marginH = Math.max(48, Math.round(width * 0.08));
  const positionedPrefix = layout === 'below' && dimensions.subtitleY
    ? `{\\an5\\pos(${Math.round(width / 2)},${Math.round(dimensions.subtitleY)})}`
    : '';
  const events = splitCues(cues)
    .map(cue => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Social,,0,0,0,,${positionedPrefix}${escapeAssText(cue.text)}`)
    .join('\n');

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Social,Arial,${fontSize},&H30FFFFFF,&H30FFFFFF,&H70000000,&HCC000000,1,0,0,0,100,100,0,0,1,4,1,2,${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

function parseAspect(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error('--below-aspect must be in w:h format');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0) throw new Error('--below-aspect values must be positive');
  return { width, height };
}

function even(value) {
  return Math.ceil(value / 2) * 2;
}

function belowDimensions(source, args) {
  const minimumCaptionBandHeight = args.belowPixels || 1;
  const minimumHeight = source.height + minimumCaptionBandHeight;
  let targetHeight = even(source.width * 16 / 9);
  if (args.belowAspect) {
    const aspect = parseAspect(args.belowAspect);
    targetHeight = even(source.width * aspect.height / aspect.width);
    if (targetHeight < minimumHeight) {
      throw new Error(`--below-aspect ${args.belowAspect} does not leave subtitle space for ${source.width}x${source.height}`);
    }
  }
  if (args.belowHeightAspect) {
    const aspect = parseAspect(args.belowHeightAspect);
    targetHeight = even(source.width * aspect.width / aspect.height);
    if (targetHeight < minimumHeight) {
      throw new Error(`--below-height-aspect ${args.belowHeightAspect} does not leave subtitle space for ${source.width}x${source.height}`);
    }
  }
  targetHeight = even(Math.max(targetHeight, minimumHeight));
  const addedHeight = targetHeight - source.height;
  const captionBandHeight = args.belowPixels || Math.max(1, Math.round(addedHeight * 0.05));
  const contentY = Math.floor(addedHeight * 0.45);
  return {
    width: source.width,
    height: targetHeight,
    bandHeight: captionBandHeight,
    contentY,
    subtitleY: contentY + source.height + captionBandHeight / 2
  };
}

function escapeFilterPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function generateWhisperSrt(inputPath, tempDir, model) {
  await run('whisper', [
    inputPath,
    '--model', model,
    '--output_format', 'srt',
    '--output_dir', tempDir
  ]);
  const expected = path.join(tempDir, `${path.parse(inputPath).name}.srt`);
  assertFileExists(expected, 'Whisper SRT output');
  return expected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolveProjectPath(args.input);
  const outputPath = resolveProjectPath(args.output);
  assertFileExists(inputPath, 'Input video');

  const tempDir = path.join(rootDir, '.render', 'subtitle-burner', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const srtPath = args.autoWhisper
      ? await generateWhisperSrt(inputPath, tempDir, args.whisperModel)
      : resolveProjectPath(args.srt);
    assertFileExists(srtPath, 'SRT file');

    const sourceDimensions = await probeVideo(inputPath);
    const outputDimensions = args.layout === 'below'
      ? belowDimensions(sourceDimensions, args)
      : { ...sourceDimensions, bandHeight: 0 };
    const assPath = path.join(tempDir, 'captions.ass');
    const cues = parseSrt(readFileSync(srtPath, 'utf8'));
    if (!cues.length) throw new Error(`No subtitle cues found in ${srtPath}`);

    writeFileSync(assPath, buildAss(cues, outputDimensions, args.layout, outputDimensions.bandHeight), 'utf8');
    mkdirSync(path.dirname(outputPath), { recursive: true });

    const subtitlesFilter = `subtitles='${escapeFilterPath(assPath)}'`;
    const vf = args.layout === 'below'
      ? `pad=${outputDimensions.width}:${outputDimensions.height}:0:${outputDimensions.contentY}:black,${subtitlesFilter}`
      : subtitlesFilter;

    await run('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputPath
    ]);

    console.log(`Input: ${inputPath}`);
    console.log(`Subtitles: ${srtPath}`);
    console.log(`Layout: ${args.layout}`);
    console.log(`Output: ${outputPath}`);
    console.log(`Output size: ${outputDimensions.width}x${outputDimensions.height}`);
  } finally {
    if (!args.keepTemp) rmSync(tempDir, { recursive: true, force: true });
    else console.log(`Kept temp files: ${tempDir}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
