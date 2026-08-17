import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadAppConfig } from '../config.ts';
import { writeLectureCaptionsVtt } from '../../../mylecture-agent/src/render-worker/captions-vtt.ts';
import { calculateTokenCostUsd } from '../../../mylecture-agent/src/token-tracker/token_tracker.ts';
import { resolveAgentModel } from './models.ts';
import { getAgentRoot, requireAgentFile, resolveAgentSrc } from './agent-paths.ts';
import {
  ffmpegConcatPath,
  isIndexHtmlName,
  isResolvedHtmlName,
  resolvedSiblingPathForIndex,
  rootDir,
  websiteRoot
} from './paths.ts';

export const DEFAULT_COURSEGEN_TTS_VOICE = 'Leda';
export const LECTUREGEN_USAGE_FILE = '.lecturegen-usage.jsonl';

export function lectureUsagePath(workspaceDir: string) {
  return path.join(workspaceDir, LECTUREGEN_USAGE_FILE);
}

export function lectureUsageFileExists(workspaceDir: string): boolean {
  return existsSync(lectureUsagePath(workspaceDir));
}

export function readLectureUsageCostUsd(workspaceDir: string): number {
  const filePath = lectureUsagePath(workspaceDir);
  if (!existsSync(filePath)) {
    return 0;
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    let total = 0;
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          costUsd?: unknown;
          model?: unknown;
          inputTokens?: unknown;
          outputTokens?: unknown;
          cachedInputTokens?: unknown;
        };
        const raw = parsed?.costUsd;
        if (raw !== null && raw !== undefined) {
          const stored = Number(raw);
          if (Number.isFinite(stored)) {
            total += stored;
            continue;
          }
        }
        const estimated = calculateTokenCostUsd({
          model: String(parsed?.model || ''),
          inputTokens: Number(parsed?.inputTokens) || 0,
          outputTokens: Number(parsed?.outputTokens) || 0,
          cachedInputTokens: Number(parsed?.cachedInputTokens) || 0
        });
        if (typeof estimated === 'number' && Number.isFinite(estimated)) {
          total += estimated;
        }
      } catch {
        // skip invalid JSONL lines
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export function resolveLectureCostUsd(options: {
  jsonlExists: boolean;
  jsonlCost: number;
  stdoutCost: number;
  previousCost: number;
}): number {
  if (options.jsonlExists) {
    return Number(options.jsonlCost.toFixed(4));
  }
  if (options.stdoutCost > 0) {
    return Number(Math.max(options.previousCost, options.stdoutCost).toFixed(4));
  }
  return options.previousCost;
}

function tokenTrackerSpawnEnv(workspaceDir: string): NodeJS.ProcessEnv {
  return {
    TOKEN_TRACKER_SESSION_ID: path.basename(workspaceDir),
    TOKEN_TRACKER_USAGE_PATH: lectureUsagePath(workspaceDir),
  };
}

const GEMINI_TTS_VOICES = new Set([
  'achernar', 'achird', 'algenib', 'algieba', 'alnilam', 'aoede',
  'autonoe', 'callirrhoe', 'charon', 'despina', 'enceladus', 'erinome',
  'fenrir', 'gacrux', 'iapetus', 'kore', 'laomedeia', 'leda', 'orus',
  'puck', 'pulcherrima', 'rasalgethi', 'sadachbia', 'sadaltager',
  'schedar', 'sulafat', 'umbriel', 'vindemiatrix', 'zephyr', 'zubenelgenubi'
]);

export function killProcessTree(childProc: ReturnType<typeof spawn> | null) {
  if (!childProc || !childProc.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(childProc.pid), '/f', '/t'], { windowsHide: true });
  } else {
    childProc.kill('SIGTERM');
  }
}

export function summarizeSpawnFailure(
  stdout: string,
  stderr: string,
  command: string,
  code: number | null
) {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const useful = [...lines].reverse().find(line =>
    /cannot find module|err_module_not_found|error \[|error:|enoent/i.test(line)
  );
  const tail = lines.slice(-12).join('\n');
  if (useful && !useful.startsWith('node:internal/modules/run_main')) {
    return useful;
  }
  return tail || `${command} exited with code ${code}`;
}

export function runCapture(command: string, args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onSpawn?: (child: ReturnType<typeof spawn>) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
} = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: options.cwd || rootDir,
      // Use the caller env as-is. Re-merging process.env would undo spawnAdmin's
      // R2_/DATABASE_URL strip and make admin.mjs keep mylecture/.env keys
      // (dotenv does not override). Those keys 403 on the catalog R2 bucket.
      env: options.env ?? process.env,
      shell: false
    });

    options.onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr?.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(summarizeSpawnFailure(stdout, stderr, command, code)));
    });
  });
}

export function parseCostUsdFromOutput(output: string) {
  const matches = [...String(output || '').matchAll(/cost=\$([0-9]+(?:\.[0-9]+)?)/g)];
  if (matches.length === 0) return 0;
  const amount = Number(matches[matches.length - 1][1]);
  return Number.isFinite(amount) ? amount : 0;
}

function locateLectureGenCli() {
  return requireAgentFile('lecturegen.ts');
}

function locateEditorAgentCli() {
  return requireAgentFile('editor-agent', 'cli.ts');
}

export type LectureGenSpawnSettings = {
  generationLength?: string;
  aspectRatio?: string;
  theme?: string;
  teachingStyle?: string;
  enableGetimg?: boolean;
  /** When true, LectureGen skips in-pipeline resolve (coursegen resolves after script review). */
  skipResolve?: boolean;
  /** When true, LectureGen skips video and runs IAGen/GameGen only. */
  skipVideo?: boolean;
  includeInteractive?: boolean;
  includeGame?: boolean;
};

export type SpawnAgentOptions = {
  workspaceDir: string;
  taskMessage: string;
  maxTurns: number;
  model?: string;
  scriptModel?: string;
  animatorModel?: string;
  ttsVoice?: string;
  ttsSpeed?: string | number;
  ttsProvider?: string;
  /** Typed LectureGen settings — emitted as CLI flags (explicit args beat stdin marker). */
  settings?: LectureGenSpawnSettings;
  /** Optional reference file for no-video IAGen/GameGen (--reference). */
  referencePath?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onSpawn?: (child: ReturnType<typeof spawn>, kill: () => void) => void;
};

/** Build LectureGen CLI argv from typed settings (process-boundary flags only). */
export function buildLectureGenCliFlags(settings?: LectureGenSpawnSettings): string[] {
  if (!settings) return [];
  const flags: string[] = [];
  if (settings.generationLength) {
    flags.push('--length', settings.generationLength);
  }
  if (settings.aspectRatio) {
    flags.push('--aspect-ratio', settings.aspectRatio);
  }
  if (settings.theme) {
    flags.push('--theme', settings.theme);
  }
  if (settings.teachingStyle) {
    flags.push('--teaching-style', settings.teachingStyle);
  }
  if (settings.enableGetimg === false) {
    flags.push('--no-getimg');
  }
  if (settings.skipResolve) {
    flags.push('--no-resolve');
  }
  if (settings.skipVideo) {
    flags.push('--no-video');
  }
  if (settings.includeInteractive) {
    flags.push('--interactive');
  }
  if (settings.includeGame) {
    flags.push('--game');
  }
  return flags;
}

/** Full lecture generation via LectureGen (not the edit-only EditorAgent). */
export function spawnAgent(options: SpawnAgentOptions) {
  const cliPath = locateLectureGenCli();
  const model = resolveAgentModel(options.model);
  const scriptModel = String(options.scriptModel || '').trim();
  const animatorModel = String(options.animatorModel || '').trim();

  const settings = options.settings ? { ...options.settings } : undefined;
  if (settings?.theme && !existsSync(settings.theme) && settings.theme.includes('\n')) {
    const themePath = path.join(options.workspaceDir, '.coursegen-theme.md');
    writeFileSync(themePath, settings.theme, 'utf8');
    settings.theme = themePath;
  }
  if (settings?.teachingStyle && !existsSync(settings.teachingStyle) && settings.teachingStyle.includes('\n')) {
    const stylePath = path.join(options.workspaceDir, '.coursegen-teaching-style.md');
    writeFileSync(stylePath, settings.teachingStyle, 'utf8');
    settings.teachingStyle = stylePath;
  }

  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = resolveTtsProvider(voice, options.ttsProvider);
  const speed = normalizeTtsSpeed(options.ttsSpeed);

  const args = [
    '--import', 'tsx', cliPath,
    '--model', model,
    ...(scriptModel ? ['--script-model', scriptModel] : []),
    ...(animatorModel ? ['--animator-model', animatorModel] : []),
    '--workspace-dir', options.workspaceDir,
    '--tts-provider', provider,
    '--tts-voice', voice,
    '--tts-speed', speed,
    ...buildLectureGenCliFlags(settings),
    ...(options.referencePath && existsSync(options.referencePath)
      ? ['--reference', options.referencePath]
      : [])
  ];

  let childProc: ReturnType<typeof spawn> | null = null;
  const env = {
    ...process.env,
    ...tokenTrackerSpawnEnv(options.workspaceDir),
    AGENT_WORKSPACE: options.workspaceDir,
    AGENT_NEW_SESSION: 'true',
    DOTENVX_LOG_LEVEL: 'error',
    DOTENV_LOG_LEVEL: 'error',
    DOTENV_CONFIG_QUIET: 'true'
  };

  const promise = new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.workspaceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
      shell: false
    });
    childProc = child;
    options.onSpawn?.(child, () => killProcessTree(child));

    let stdout = '';
    let stderr = '';
    child.stdin?.write(options.taskMessage);
    child.stdin?.end();

    child.stdout?.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const output = `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(-80)
        .join('\n');
      reject(new Error(output || `LectureGen exited with code ${code}`));
    });
  });

  return {
    promise,
    kill: () => killProcessTree(childProc)
  };
}

/** Alias — preferred name at coursegen call sites. */
export const spawnLectureGen = spawnAgent;

/** Edit / practice / repair turns via EditorAgent (tool loops). */
export function spawnEditorAgent(options: SpawnAgentOptions) {
  const cliPath = locateEditorAgentCli();
  const model = resolveAgentModel(options.model);

  const args = [
    '--import', 'tsx', cliPath,
    '--model', model,
    '--max-turns', String(options.maxTurns),
    '--workspace', options.workspaceDir,
    '--new-session'
  ];

  let childProc: ReturnType<typeof spawn> | null = null;
  const env = {
    ...process.env,
    ...tokenTrackerSpawnEnv(options.workspaceDir),
    AGENT_WORKSPACE: options.workspaceDir,
    AGENT_NEW_SESSION: 'true',
    DOTENVX_LOG_LEVEL: 'error',
    DOTENV_LOG_LEVEL: 'error',
    DOTENV_CONFIG_QUIET: 'true'
  };

  const promise = new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.workspaceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
      shell: false
    });
    childProc = child;
    options.onSpawn?.(child, () => killProcessTree(child));

    let stdout = '';
    let stderr = '';
    child.stdin?.write(options.taskMessage);
    child.stdin?.end();

    child.stdout?.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const output = `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(-80)
        .join('\n');
      reject(new Error(output || `EditorAgent exited with code ${code}`));
    });
  });

  return {
    promise,
    kill: () => killProcessTree(childProc)
  };
}

function envTtsVoice() {
  return String(process.env.TTS_VOICE || process.env.GOOGLE_TTS_VOICE || '').trim();
}

function envTtsProvider() {
  const explicit = String(process.env.TTS_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit === 'gemini' ? 'google' : explicit;
  if (process.env.GOOGLE_TTS_MODEL || process.env.GOOGLE_TTS_VOICE) return 'google';
  return '';
}

function normalizeTtsVoice(value?: string) {
  const voice = String(value || '').trim();
  return voice || envTtsVoice() || DEFAULT_COURSEGEN_TTS_VOICE;
}

function normalizeTtsSpeed(value?: string | number) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return '1';
  return String(Math.max(0.5, Math.min(2, speed)));
}

function resolveTtsProvider(voice: string, explicit?: string) {
  const config = loadAppConfig(rootDir);
  if (explicit) return explicit === 'gemini' ? 'google' : explicit;
  const fromEnv = envTtsProvider();
  if (fromEnv) return fromEnv;
  if (voice === config.tts.voice) return config.tts.provider;
  const v = voice.toLowerCase();
  if (GEMINI_TTS_VOICES.has(v)) {
    return 'google';
  }
  const voicesDir = path.join(rootDir, 'voices');
  if (existsSync(voicesDir)) {
    try {
      const folders = readdirSync(voicesDir).filter((name) =>
        statSync(path.join(voicesDir, name)).isDirectory()
      );
      if (folders.some((folder) => folder.toLowerCase() === v)) {
        return 'omnivoice';
      }
    } catch {
      // fall through
    }
  }
  return config.tts.provider;
}

export async function spawnResolve(indexPath: string, options: { ttsVoice?: string; ttsSpeed?: string | number } = {}) {
  const folderPath = path.dirname(indexPath);
  const files = readdirSync(folderPath)
    .filter(name => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = resolveTtsProvider(voice);
  const speed = normalizeTtsSpeed(options.ttsSpeed);
  const agentRoot = getAgentRoot();
  requireAgentFile('resolve-render', 'build-plan.ts');

  for (const file of files) {
    const inputPath = path.join(folderPath, file);
    const outPath = resolvedSiblingPathForIndex(inputPath);
    await runCapture(process.execPath, [
      '--import', 'tsx', 'src/resolve-render/build-plan.ts',
      '--input', inputPath,
      '--out', outPath,
      '--provider', provider,
      '--voice', voice,
      '--speed', speed,
      '--no-caption'
    ], { cwd: agentRoot });
  }

  writeLectureCaptionsVtt(folderPath);
}

function descriptiveBaseName(folderPath: string) {
  const folderName = path.basename(folderPath);
  return folderName.replace(/^\d+-/, '') || 'lecture';
}

function defaultSceneOutputPath(scenePath: string) {
  const basename = path.basename(scenePath);
  const match = basename.match(/^(?:index|resolved)(\d+)\.html$/i);
  const sceneNum = match?.[1];
  const base = descriptiveBaseName(path.dirname(scenePath));
  const folderPath = path.dirname(scenePath);
  const sceneCount = readdirSync(folderPath).filter(name => isIndexHtmlName(name) || isResolvedHtmlName(name)).length;
  const fileName = sceneNum && sceneCount > 1 ? `${base}-${sceneNum}.mp4` : `${base}.mp4`;
  return path.join(folderPath, fileName);
}

function finalOutputPath(folderPath: string) {
  return path.join(folderPath, `${descriptiveBaseName(folderPath)}.mp4`);
}

export async function spawnRenderLecture(folderPath: string, options: {
  ttsVoice?: string;
  ttsSpeed?: string | number;
  onSpawn?: (child: ReturnType<typeof spawn>) => void;
  /** When true, skip captions write (e.g. resolve just ran in the same lecture pass). */
  skipCaptions?: boolean;
} = {}) {
  const indexFiles = readdirSync(folderPath)
    .filter(name => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(name => path.join(folderPath, name));

  if (indexFiles.length === 0) {
    throw new Error('No index*.html files found for render.');
  }

  const config = loadAppConfig(rootDir);
  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = resolveTtsProvider(voice);
  const speed = normalizeTtsSpeed(options.ttsSpeed);
  const agentRoot = getAgentRoot();
  requireAgentFile('resolve-render', 'build-plan.ts');
  requireAgentFile('resolve-render', 'render-video.ts');

  for (const indexPath of indexFiles) {
    const resolvedPath = resolvedSiblingPathForIndex(indexPath);
    const needsResolve = !existsSync(resolvedPath)
      || statSync(resolvedPath).mtimeMs < statSync(indexPath).mtimeMs;
    if (needsResolve) {
      await runCapture(process.execPath, [
        '--import', 'tsx', 'src/resolve-render/build-plan.ts',
        '--input', indexPath,
        '--out', resolvedPath,
        '--provider', provider,
        '--voice', voice,
        '--speed', speed,
        '--no-caption'
      ], { cwd: agentRoot, onSpawn: options.onSpawn });
    }
  }

  if (!options.skipCaptions) {
    writeLectureCaptionsVtt(folderPath);
  }

  const resolvedFiles = indexFiles.map(indexPath => resolvedSiblingPathForIndex(indexPath));
  const sceneOutputs = resolvedFiles.map(scenePath => defaultSceneOutputPath(scenePath));

  for (let index = 0; index < resolvedFiles.length; index++) {
    const scenePath = resolvedFiles[index];
    const sceneOutput = sceneOutputs[index];
    await runCapture(process.execPath, [
      '--import', 'tsx', 'src/resolve-render/render-video.ts',
      '--html', scenePath,
      '--out', sceneOutput,
      '--resolved-html', scenePath,
      '--no-auto-build',
      '--fps', String(config.render.fps),
      '--width', String(config.render.baseWidth),
      '--height', String(config.render.baseHeight),
      '--tts-provider', provider,
      '--tts-voice', voice,
      '--tts-speed', speed,
      '--workers', '1',
      '--video-codec', 'libx264'
    ], { cwd: agentRoot, onSpawn: options.onSpawn });
  }

  const outputPath = finalOutputPath(folderPath);
  if (sceneOutputs.length === 1) {
    if (path.resolve(sceneOutputs[0]) !== path.resolve(outputPath) && existsSync(sceneOutputs[0])) {
      renameSync(sceneOutputs[0], outputPath);
    }
    return outputPath;
  }

  const tempDir = path.join(rootDir, '.render', 'coursegen', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  const listPath = path.join(tempDir, 'concat.txt');
  const listBody = sceneOutputs.map(file => `file '${ffmpegConcatPath(file)}'`).join('\n');
  writeFileSync(listPath, `${listBody}\n`, 'utf8');

  try {
    await runCapture('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', outputPath
    ], { onSpawn: options.onSpawn });
  } finally {
    for (const sceneOutput of sceneOutputs) {
      if (path.resolve(sceneOutput) !== path.resolve(outputPath) && existsSync(sceneOutput)) {
        try { unlinkSync(sceneOutput); } catch { /* ignore */ }
      }
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  return outputPath;
}

export async function spawnAdmin(args: string[]) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === 'DATABASE_URL' ||
      key === 'DIRECT_URL' ||
      key === 'STORAGE_BACKEND' ||
      key === 'NEXT_PUBLIC_CDN_URL' ||
      key.startsWith('R2_') ||
      key.startsWith('SUPABASE_') ||
      key.startsWith('NEXT_PUBLIC_SUPABASE_')
    ) {
      delete env[key];
    }
  }
  const output = await runCapture(process.execPath, ['scripts/admin.mjs', ...args], {
    cwd: websiteRoot(),
    env
  });
  console.log(output);
  return output;
}
