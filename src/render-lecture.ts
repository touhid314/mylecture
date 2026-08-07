// @ts-nocheck
/**
 * render-lecture.ts
 *
 * Renders a catalog lecture folder (resolved*.html scenes + audio/) to a single final.mp4.
 * Invokes render-video.ts per scene and concatenates when multiple scenes are present.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

const rootDir = process.cwd();

const PASSTHROUGH_FLAGS = [
  '--fps',
  '--width',
  '--height',
  '--video-codec',
  '--x264-preset',
  '--workers',
  '--max-short-edge',
  '--max-frames'
];

function printHelp() {
  console.log(`Usage:
  npm run render:lecture -- [options]

Options:
  --dir <folder>         Lecture folder containing resolved*.html and audio/ (required)
  --out <file>           Output MP4 path. Default: <dir>/final.mp4
  --fps <number>         Frames per second (forwarded to render-video)
  --width <pixels>       Viewport width (forwarded to render-video)
  --height <pixels>      Viewport height (forwarded to render-video)
  --video-codec <codec>  MP4 video encoder (forwarded to render-video)
  --x264-preset <preset> libx264 speed preset (forwarded to render-video)
  --workers <number>     Parallel frame workers (forwarded to render-video)
  --max-frames <number>  Render only the first N frames (forwarded to render-video)
  --keep-parts           Keep intermediate per-scene MP4s in <dir>/.parts
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    dir: null,
    out: null,
    keepParts: false,
    forwardedFlags: []
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--dir') args.dir = next, i++;
    else if (arg === '--out') args.out = next, i++;
    else if (arg === '--keep-parts') args.keepParts = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (PASSTHROUGH_FLAGS.includes(arg)) {
      if (next === undefined) throw new Error(`${arg} requires a value`);
      args.forwardedFlags.push(arg, next);
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.dir) throw new Error('--dir is required (lecture folder with resolved*.html and audio/)');

  args.dir = path.resolve(args.dir);
  if (!existsSync(args.dir)) throw new Error(`Lecture folder does not exist: ${args.dir}`);

  args.out = path.resolve(args.out || path.join(args.dir, 'final.mp4'));

  return args;
}

function discoverScenes(dir) {
  const resolvedHtml = path.join(dir, 'resolved.html');
  if (existsSync(resolvedHtml)) {
    return ['resolved.html'];
  }

  const pattern = /^resolved(\d+)\.html$/i;
  const scenes = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(pattern)[1]);
      const numB = Number(b.match(pattern)[1]);
      return numA - numB;
    });

  return scenes;
}

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

function runExit(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...options
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

async function renderScene(sceneHtml, outPath, forwardedFlags) {
  const absSceneHtml = path.resolve(sceneHtml);
  const absOut = path.resolve(outPath);
  const renderArgs = [
    '--import', 'tsx', 'src/render-video.ts',
    '--html', absSceneHtml,
    '--out', absOut,
    ...forwardedFlags
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, renderArgs, {
      cwd: rootDir,
      stdio: 'inherit',
      windowsHide: true
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`render-video for ${path.basename(sceneHtml)} exited with code ${code}`));
    });
  });
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  const started = performance.now();
  const args = parseArgs(process.argv.slice(2));
  const partsDir = path.join(args.dir, '.parts');

  const scenes = discoverScenes(args.dir);
  if (scenes.length === 0) {
    throw new Error(`No resolved*.html scenes found in ${args.dir}`);
  }

  console.log(`Scenes (${scenes.length}): ${scenes.join(', ')}`);

  if (scenes.length === 1) {
    const scenePath = path.join(args.dir, scenes[0]);
    console.log(`Rendering single scene to ${args.out}`);
    await renderScene(scenePath, args.out, args.forwardedFlags);
  } else {
    if (existsSync(partsDir)) rmSync(partsDir, { recursive: true, force: true });
    mkdirSync(partsDir, { recursive: true });

    const partPaths = [];
    for (let i = 0; i < scenes.length; i++) {
      const scenePath = path.join(args.dir, scenes[i]);
      const partPath = path.join(partsDir, `part_${String(i + 1).padStart(2, '0')}.mp4`);
      console.log(`Rendering scene ${i + 1}/${scenes.length}: ${scenes[i]}`);
      await renderScene(scenePath, partPath, args.forwardedFlags);
      partPaths.push(partPath);
    }

    const concatTxt = path.join(partsDir, 'concat.txt');
    const concatLines = partPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`);
    writeFileSync(concatTxt, concatLines.join('\n') + '\n', 'utf8');

    const copyArgs = [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-f', 'concat', '-safe', '0', '-i', concatTxt,
      '-c', 'copy',
      args.out
    ];

    const copyCode = await runExit('ffmpeg', copyArgs);
    if (copyCode === 0) {
      console.log('Concatenation succeeded (stream copy)');
    } else {
      console.log('Stream copy failed; falling back to re-encode');
      const reencodeArgs = [
        '-y', '-hide_banner', '-loglevel', 'warning',
        '-f', 'concat', '-safe', '0', '-i', concatTxt,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        args.out
      ];
      await run('ffmpeg', reencodeArgs);
      console.log('Concatenation succeeded (re-encode)');
    }

    if (!args.keepParts) {
      rmSync(partsDir, { recursive: true, force: true });
    }
  }

  const elapsed = performance.now() - started;
  console.log(`Output: ${args.out}`);
  console.log(`Total time: ${formatSeconds(elapsed)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
