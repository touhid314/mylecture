// @ts-nocheck
/**
 * ide-server.ts
 * Summer 2026, Touhidul Islam
 *
 * Local HTTP server for the MyLecture IDE. It serves the viewer UI, browses
 * lecture files, resolves source plans into renderable HTML, renders videos,
 * talks to the coding agent, and publishes rendered lecture folders to
 * the website package. This server is intentionally local-only on 127.0.0.1.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createViewerHtml } from '../packages/lecture-viewer/src/index.ts';
import { LectureAgent } from '../packages/lecture-agent/src/coding_agent.ts';

const rootDir = process.cwd();

// Load .env
function loadEnv() {
  const envPath = path.resolve(rootDir, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].split('#')[0].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1).trim();
        }
        process.env[key] = val;
      }
    }
  }
}
loadEnv();

const agentClientStates = new Map();

function normalizeAgentClientId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : 'default';
}

function getAgentState(agentClientId) {
  const id = normalizeAgentClientId(agentClientId);
  let state = agentClientStates.get(id);
  if (!state) {
    state = {
      id,
      currentWorkspace: '',
      activeJob: null,
      log: '',
      pendingNewSession: true,
      session: null
    };
    agentClientStates.set(id, state);
  }
  return state;
}

function getAgentWorkspaceDir() {
  let dir = process.env.AGENT_WORKSPACE_DIR;
  if (dir) {
    dir = dir.split('#')[0].trim();
    if ((dir.startsWith('"') && dir.endsWith('"')) || (dir.startsWith("'") && dir.endsWith("'"))) {
      dir = dir.slice(1, -1).trim();
    }
    return path.resolve(dir);
  }
  return path.resolve(rootDir, 'packages/lecture-agent/workspace');
}

function createNewSessionWorkspace(agentClientId = 'default') {
  const state = getAgentState(agentClientId);
  const baseDir = getAgentWorkspaceDir();
  mkdirSync(baseDir, { recursive: true });

  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const hh = pad(now.getHours());
  const min = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const dd = pad(now.getDate());
  const mm = pad(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const folderName = `${hh}-${min}-${ss}-${dd}-${mm}-${yyyy}-${randomSuffix}`;
  const folderPath = path.resolve(baseDir, folderName);

  mkdirSync(folderPath, { recursive: true });

  state.currentWorkspace = folderPath;
  console.log(`[Session] Created new session folder: ${folderPath}`);
  return folderPath;
}

function agentWorkspaceRoot(agentClientId = 'default') {
  const state = getAgentState(agentClientId);
  if (state.currentWorkspace) {
    return state.currentWorkspace;
  }
  return createNewSessionWorkspace(agentClientId);
}

const defaultPort = 4307;

// Source files without resolved timelines use this estimate for preview timing.
function estimateTextDuration(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2.5, words / 2.65);
}

// Inspect HTML for resolved duration metadata, falling back to rough plan estimates.
function tryGetHtmlDuration(fullPath) {
  try {
    const content = readFileSync(fullPath, 'utf8');
    const match = content.match(/window\.__RESOLVED_TIMELINE__\s*=\s*({[^;]+});?/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed.duration === 'number') {
        return parsed.duration;
      }
    }
    const durMatch = content.match(/window\.__VIDEO_DURATION__\s*=\s*(\d+(?:\.\d+)?)/);
    if (durMatch) {
      return Number(durMatch[1]);
    }

    // Fallback: Estimate duration of unresolved index HTML files by parsing window.__VIDEO_PLAN__ or VIDEO_PLAN
    const planMatch = content.match(/(?:VIDEO_PLAN|__VIDEO_PLAN__)\s*=\s*\[([\s\S]+?)\]/);
    if (planMatch) {
      const planText = planMatch[1];
      const itemsRegex = /\{\s*([^}]+?)\s*\}/g;
      let total = 0;
      let matchItem;
      while ((matchItem = itemsRegex.exec(planText)) !== null) {
        const itemContent = matchItem[1];
        const durMatchItem = itemContent.match(/(?:resolvedDuration|duration)\s*:\s*(\d+(?:\.\d+)?)/);
        if (durMatchItem) {
          total += Number(durMatchItem[1]);
          continue;
        }
        const textMatch = itemContent.match(/text\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`)/);
        if (textMatch) {
          const extractedText = textMatch[1] || textMatch[2] || textMatch[3] || '';
          total += estimateTextDuration(extractedText);
        }
      }
      if (total > 0) {
        return total;
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

// Parse server startup options such as port, initial file, and preview dimensions.
function parseArgs(argv) {
  const args = {
    port: defaultPort,
    openPath: '',
    openBrowser: false,
    width: 1920,
    height: 1080
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--port') args.port = Number(next), i++;
    else if (arg === '--file') args.openPath = next, i++;
    else if (arg === '--width') args.width = Number(next), i++;
    else if (arg === '--height') args.height = Number(next), i++;
    else if (arg === '--open') args.openBrowser = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65535) {
    throw new Error('--port must be a valid TCP port');
  }
  if (!Number.isInteger(args.width) || args.width <= 0) {
    throw new Error('--width must be a positive integer');
  }
  if (!Number.isInteger(args.height) || args.height <= 0) {
    throw new Error('--height must be a positive integer');
  }

  return args;
}

// Human-facing CLI help for the local IDE server.
function printHelp() {
  console.log(`Usage:
  npm run ide -- [options]

Options:
  --port <number>   Local server port. Default: ${defaultPort}
  --file <path>     HTML file to preselect in the viewer
  --width <pixels>  Preview viewport width. Default: 1920
  --height <pixels> Preview viewport height. Default: 1080
  --open            Open the viewer in the default browser
`);
}

// Open the IDE URL in the user's default browser when --open is provided.
function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const browserArgs = process.platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url];

  const child = spawn(command, browserArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

// Static file MIME types used by /files and /lecture-viewer routes.
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.avsl', 'text/plain; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.mp4', 'video/mp4']
]);

const agentUploadExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.bmp',
  '.pdf',
  '.mp4', '.mpeg', '.mpg', '.mov', '.avi', '.webm', '.wmv', '.3gp', '.3gpp', '.flv'
]);

// Small response helpers keep route handlers readable.
function sendText(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
}

function sendJson(response, status, payload) {
  sendText(response, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

// Normalize user-provided paths while allowing absolute Windows paths from the UI.
function resolveInputPath(inputPath) {
  let cleaned = String(inputPath || '').trim();

  if (process.platform === 'win32') {
    cleaned = cleaned.replace(/^[\/\\]+([a-zA-Z]:)/, '$1');
  }

  const isAbs = path.isAbsolute(cleaned) || (process.platform === 'win32' && /^[a-zA-Z]:/.test(cleaned));
  return isAbs ? path.resolve(cleaned) : path.resolve(rootDir, cleaned);
}

// Validate and normalize a file selected by the IDE.
function normalizeOpenPath(inputPath) {
  const resolvedPath = resolveInputPath(inputPath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`File does not exist: ${inputPath}`);
  }
  return resolvedPath.replaceAll(path.sep, '/');
}

// Viewer-facing paths are normalized to slash separators for browser consistency.
function toViewerPath(filePath) {
  return path.resolve(filePath).replaceAll(path.sep, '/');
}

// List sibling files for the current lecture file panel.
function listFolderFiles(filePath) {
  const resolvedPath = resolveInputPath(filePath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const folderPath = path.dirname(resolvedPath);
  const files = readdirSync(folderPath, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const fullPath = path.join(folderPath, entry.name);
      const stat = statSync(fullPath);
      const isHtml = entry.name.endsWith('.html');
      return {
        name: entry.name,
        path: toViewerPath(fullPath),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        duration: isHtml ? tryGetHtmlDuration(fullPath) : null
      };
    })
    .sort((a, b) => {
      const timeDiff = new Date(b.modified) - new Date(a.modified);
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  return {
    folder: toViewerPath(folderPath),
    files
  };
}

// Default file browser location prefers the coding agent output folder when present.
function defaultBrowserFolder() {
  const workspaceTargetPath = getAgentWorkspaceDir();
  if (existsSync(workspaceTargetPath) && statSync(workspaceTargetPath).isDirectory()) {
    return workspaceTargetPath;
  }
  return rootDir;
}

// Resolve and validate folders for the IDE directory browser.
function resolveDirectoryPath(inputPath = '') {
  const resolvedPath = inputPath ? resolveInputPath(inputPath) : defaultBrowserFolder();
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
    throw new Error(`Folder does not exist: ${inputPath || 'agent-workspace'}`);
  }
  return resolvedPath;
}

// List files and folders for the browse-folder endpoint.
function listDirectory(inputPath = '') {
  const folderPath = resolveDirectoryPath(inputPath);
  const entries = readdirSync(folderPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() || entry.isFile())
    .map(entry => {
      const fullPath = path.join(folderPath, entry.name);
      const stat = statSync(fullPath);
      const isHtml = entry.name.endsWith('.html');
      return {
        name: entry.name,
        path: toViewerPath(fullPath),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? stat.size : null,
        modified: stat.mtime.toISOString(),
        duration: isHtml ? tryGetHtmlDuration(fullPath) : null
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      const timeDiff = new Date(b.modified) - new Date(a.modified);
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  const parentPath = path.dirname(folderPath);
  const canGoUp = path.resolve(parentPath) !== path.resolve(folderPath);

  return {
    folder: toViewerPath(folderPath),
    parent: canGoUp ? toViewerPath(parentPath) : '',
    entries
  };
}

// Resolve the parent folder for an existing file.
function folderForFile(filePath) {
  const resolvedPath = resolveInputPath(filePath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  return path.dirname(resolvedPath);
}

// Ask the operating system to open a folder in the native file explorer.
function openFolderPath(folderPath) {
  const resolvedPath = resolveDirectoryPath(folderPath);
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const openArgs = [resolvedPath];
  const child = spawn(command, openArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.on('error', error => {
    console.error(`Failed to open folder: ${error.message}`);
  });
  child.unref();
  return toViewerPath(resolvedPath);
}

function openFolder(filePath) {
  const folderPath = folderForFile(filePath);
  return openFolderPath(folderPath);
}

// Workspace directories are dynamically set and managed via active pointers at the top of the file

function agentUploadRoot() {
  return path.resolve(rootDir, 'packages/lecture-agent/.tmp/uploads');
}

function agentProfilesRoot() {
  const workspaceProfilesRoot = path.resolve(rootDir, 'packages/lecture-agent/.agents/mylecture-profiles');
  if (existsSync(path.resolve(rootDir, 'packages/lecture-agent/src/coding_agent.ts'))) {
    return workspaceProfilesRoot;
  }
  return path.resolve(rootDir, '../lecture-agent/.agents/mylecture-profiles');
}

function listAgentProfiles() {
  const profilesRoot = agentProfilesRoot();
  if (!existsSync(profilesRoot) || !statSync(profilesRoot).isDirectory()) {
    return [];
  }

  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => {
      const fullPath = path.join(profilesRoot, entry.name);
      return {
        id: entry.name,
        name: path.basename(entry.name, path.extname(entry.name)),
        fileName: entry.name,
        content: readFileSync(fullPath, 'utf8').trim()
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function sanitizeUploadName(name) {
  const base = path.basename(String(name || 'attachment'));
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'attachment';
}

function isSupportedAgentUpload(fileName) {
  return agentUploadExtensions.has(path.extname(String(fileName || '')).toLowerCase());
}

function parseMultipartFormData(contentType, body) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('Missing multipart boundary.');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    cursor += boundary.length;
    if (body.slice(cursor, cursor + 2).toString() === '--') break;
    if (body.slice(cursor, cursor + 2).toString() === '\r\n') cursor += 2;

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) break;
    const headersText = body.slice(cursor, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    let next = body.indexOf(boundary, dataStart);
    if (next === -1) break;
    let dataEnd = next;
    if (body.slice(dataEnd - 2, dataEnd).toString() === '\r\n') dataEnd -= 2;

    const disposition = headersText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || '';
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || '';
    if (name) {
      parts.push({ name, filename, data: body.slice(dataStart, dataEnd) });
    }
    cursor = next;
  }
  return parts;
}

function receiveRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function saveAgentUploads(request) {
  const contentType = request.headers['content-type'] || '';
  if (!String(contentType).toLowerCase().startsWith('multipart/form-data')) {
    throw new Error('Upload must use multipart/form-data.');
  }

  const body = await receiveRequestBody(request);
  const parts = parseMultipartFormData(contentType, body);
  const files = parts.filter(part => part.name === 'files' && part.filename);
  if (files.length === 0) throw new Error('No files were uploaded.');

  const uploadDir = agentUploadRoot();
  mkdirSync(uploadDir, { recursive: true });
  const saved = [];

  for (const file of files) {
    const originalName = sanitizeUploadName(file.filename);
    if (!isSupportedAgentUpload(originalName)) {
      throw new Error(`Unsupported attachment type: ${originalName}`);
    }
    const ext = path.extname(originalName);
    const stem = path.basename(originalName, ext).slice(0, 80) || 'attachment';
    const targetName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${stem}${ext}`;
    const targetPath = path.join(uploadDir, targetName);
    writeFileSync(targetPath, file.data);
    saved.push({
      name: originalName,
      path: toViewerPath(targetPath),
      size: file.data.length
    });
  }

  return saved;
}

// Synchronizer setup completely removed

// Helpers for consistent output naming next to the selected source or resolved HTML.
function siblingPath(filePath, name) {
  return path.join(path.dirname(resolveInputPath(filePath)), name);
}

function defaultOutputPath(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/^(?:index|resolved)(.*)\.html$/i);
  return siblingPath(filePath, `rendered${match?.[1] || ''}.mp4`);
}

function finalBatchOutputPath(filePath) {
  return siblingPath(filePath, 'rendered.mp4');
}

// Scene naming conventions drive resolve/render batching.
function isIndexHtmlName(name) {
  return /^index.*\.html$/i.test(name);
}

function isResolvedHtmlName(name) {
  return /^resolved.*\.html$/i.test(name);
}

function resolvedSiblingPathForIndex(filePath) {
  const basename = path.basename(filePath);
  const suffix = basename.slice('index'.length, -'.html'.length);
  return siblingPath(filePath, `resolved${suffix}.html`);
}

// TTS options are normalized before being passed through to build-plan.ts.
function normalizeTtsVoice(value) {
  const voice = String(value || '').trim();
  return voice || 'af_heart';
}

function detectProvider(voice) {
  const v = String(voice || '').trim().toLowerCase();
  if (!v) return 'kokoro';
  if (v.startsWith('am_') || v.startsWith('af_') || v.startsWith('bf_') || v.startsWith('bm_')) {
    return 'kokoro';
  }
  const openAiVoices = new Set(['alloy', 'ash', 'ballad', 'coral', 'cedar', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);
  if (openAiVoices.has(v)) {
    return 'openai';
  }
  return 'google';
}

function normalizeTtsSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return '1';
  return String(Math.max(0.5, Math.min(2, speed)));
}

function normalizePositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return String(fallback);
  return String(number);
}

// Stop child process trees for long-running resolve, render, publish, or agent jobs.
function killProcessTree(childProc) {
  if (!childProc) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', childProc.pid, '/f', '/t'], { windowsHide: true });
  } else {
    childProc.kill('SIGTERM');
  }
}

// Resolve one file or a scene set by invoking build-plan.ts as a child process.
async function resolveLectureFile(filePath, options = {}) {
  const inputPath = resolveInputPath(filePath);
  const folderPath = path.dirname(inputPath);

  if (!isIndexHtmlName(path.basename(inputPath))) {
    throw new Error('Resolve is only available for index*.html files.');
  }

  const files = readdirSync(folderPath)
    .filter(name => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  if (files.length === 0) {
    throw new Error('No index*.html files found in the folder.');
  }

  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = detectProvider(voice);
  let finalResolvedPath = '';

  const filesToResolve = options.currentOnly ? [path.basename(inputPath)] : files;

  for (const file of filesToResolve) {
    const fileInputPath = path.join(folderPath, file);
    const fileOutPath = resolvedSiblingPathForIndex(fileInputPath);

    let childProc = null;
    activeJob = {
      type: 'resolve',
      outPath: fileOutPath,
      inputPath: fileInputPath,
      kill: () => {
        activeJob.aborted = true;
        if (childProc) {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', childProc.pid, '/f', '/t'], { windowsHide: true });
          } else {
            childProc.kill('SIGTERM');
          }
        }
      }
    };

    try {
      console.log(`Resolving scene: ${file} -> ${path.basename(fileOutPath)}`);
      await runCapture(process.execPath, [
        '--import',
        'tsx',
        'src/build-plan.ts',
        '--input', fileInputPath,
        '--out', fileOutPath,
        '--provider', provider,
        '--voice', voice,
        '--speed', normalizeTtsSpeed(options.ttsSpeed)
      ], {
        cwd: rootDir,
        windowsHide: true,
        onSpawn: (child) => {
          childProc = child;
        }
      });

      if (fileInputPath === inputPath) {
        finalResolvedPath = toViewerPath(fileOutPath);
      }
    } catch (error) {
      if (existsSync(fileOutPath)) {
        try {
          unlinkSync(fileOutPath);
        } catch (err) {
          console.error(`Failed to delete partial resolve file: ${err.message}`);
        }
      }
      if (activeJob && activeJob.aborted) {
        throw new Error('Process stopped by user');
      }
      throw error;
    } finally {
      activeJob = null;
    }
  }

  return finalResolvedPath || toViewerPath(resolvedSiblingPathForIndex(path.join(folderPath, files[0])));
}

// Build the render-video.ts child-process argument list for one HTML file.
function renderArgsForFile(inputPath, outPath, options = {}, extraArgs = []) {
  const basename = path.basename(inputPath);
  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = detectProvider(voice);
  const renderArgs = [
    'src/render-video.ts',
    '--html', inputPath,
    '--out', outPath,
    '--fps', normalizePositiveInteger(options.fps, 60, 1, 240),
    '--width', normalizePositiveInteger(options.width, 1080, 1),
    '--height', normalizePositiveInteger(options.height, 1920, 1),
    '--tts-provider', provider,
    '--tts-voice', voice,
    '--tts-speed', normalizeTtsSpeed(options.ttsSpeed),
    '--force-audio'
  ];

  if (isIndexHtmlName(basename)) {
    renderArgs.push('--resolved-html', resolvedSiblingPathForIndex(inputPath));
  } else {
    renderArgs.push('--no-auto-build');
  }

  renderArgs.push(...extraArgs);
  return renderArgs;
}

// Build the build-plan.ts child-process argument list for one index HTML file.
function buildPlanArgsForIndex(inputPath, outPath, options = {}) {
  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = detectProvider(voice);
  return [
    'src/build-plan.ts',
    '--input', inputPath,
    '--out', outPath,
    '--provider', provider,
    '--voice', voice,
    '--speed', normalizeTtsSpeed(options.ttsSpeed),
    '--force-audio'
  ];
}

// Determine which sibling scenes belong to the same lecture render batch.
function renderSceneSet(inputPath) {
  const folderPath = path.dirname(inputPath);
  const basename = path.basename(inputPath);
  const predicate = isIndexHtmlName(basename) ? isIndexHtmlName : isResolvedHtmlName;
  return readdirSync(folderPath)
    .filter(name => predicate(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(name => path.join(folderPath, name));
}

// Run asynchronous work with a fixed concurrency limit.
async function runLimited(items, limit, worker) {
  let nextIndex = 0;
  let firstError = null;
  const workerCount = Math.min(limit, items.length);
  await Promise.allSettled(Array.from({ length: workerCount }, async () => {
    while (!firstError && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        await worker(items[index], index);
      } catch (error) {
        firstError = error;
        throw error;
      }
    }
  }));
  if (firstError) throw firstError;
}

// Escape file paths for ffmpeg concat list files.
function ffmpegConcatPath(filePath) {
  return path.resolve(filePath).replaceAll('\\', '/').replaceAll("'", "'\\''");
}

// Concatenate per-scene MP4 renders into the final lecture video.
async function concatRenderedScenes(tempFiles, outputPath, listPath) {
  const listBody = tempFiles
    .map(file => `file '${ffmpegConcatPath(file)}'`)
    .join('\n');
  writeFileSync(listPath, `${listBody}\n`, 'utf8');
  await runCapture('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath
  ], {
    cwd: rootDir,
    windowsHide: true
  });
}

// Remove temporary scene MP4s after a successful batch concat.
function deleteIntermediateSceneRenders(sceneOutputs, finalOutputPath) {
  const finalResolvedPath = path.resolve(finalOutputPath);
  for (const sceneOutput of sceneOutputs) {
    if (path.resolve(sceneOutput) === finalResolvedPath || !existsSync(sceneOutput)) continue;
    try {
      unlinkSync(sceneOutput);
    } catch (error) {
      console.error(`Failed to delete intermediate scene render ${sceneOutput}: ${error.message}`);
    }
  }
}

// Render a single lecture file, or delegate to batch rendering for scene folders.
async function renderLectureFile(filePath, options = {}) {
  const inputPath = resolveInputPath(filePath);
  const basename = path.basename(inputPath);
  if (!isIndexHtmlName(basename) && !isResolvedHtmlName(basename)) {
    throw new Error('Render is only available for index*.html or resolved*.html files.');
  }

  const sceneFiles = renderSceneSet(inputPath);
  if (sceneFiles.length > 1) {
    return await renderLectureBatch(inputPath, sceneFiles, options);
  }

  const outPath = defaultOutputPath(inputPath);
  const renderArgs = renderArgsForFile(inputPath, outPath, options);
  let childProc = null;
  activeJob = {
    type: 'render',
    outPath,
    inputPath,
    kill: () => {
      activeJob.aborted = true;
      killProcessTree(childProc);
    }
  };

  try {
    await runCapture(process.execPath, ['--import', 'tsx', ...renderArgs], {
      cwd: rootDir,
      windowsHide: true,
      onSpawn: (child) => {
        childProc = child;
      }
    });
    return toViewerPath(outPath);
  } catch (error) {
    if (existsSync(outPath)) {
      try {
        unlinkSync(outPath);
      } catch (err) {
        console.error(`Failed to delete partial render file: ${err.message}`);
      }
    }
    if (activeJob && activeJob.aborted) {
      throw new Error('Process stopped by user');
    }
    throw error;
  } finally {
    activeJob = null;
  }
}

// Resolve and render multiple scenes, then concatenate them into one final MP4.
async function renderLectureBatch(inputPath, sceneFiles, options = {}) {
  const batchId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempDir = path.resolve(rootDir, '.render', 'batch-render', batchId);
  const outputPath = finalBatchOutputPath(inputPath);
  const concatListPath = path.join(tempDir, 'concat.txt');
  const childProcs = new Set();
  let firstSceneError = null;
  let renderSceneFiles = sceneFiles;

  mkdirSync(tempDir, { recursive: true });
  activeJob = {
    type: 'render',
    outPath: outputPath,
    inputPath,
    aborted: false,
    kill: () => {
      activeJob.aborted = true;
      for (const childProc of childProcs) {
        killProcessTree(childProc);
      }
    }
  };

  try {
    if (isIndexHtmlName(path.basename(inputPath))) {
      console.log(`Resolving ${sceneFiles.length} index scene(s) before batch render...`);
      const resolvedSceneFiles = [];
      for (let index = 0; index < sceneFiles.length; index++) {
        const scenePath = sceneFiles[index];
        const resolvedPath = resolvedSiblingPathForIndex(scenePath);
        const buildArgs = buildPlanArgsForIndex(scenePath, resolvedPath, options);
        let childProc = null;
        console.log(`Resolving scene ${index + 1}/${sceneFiles.length}: ${path.basename(scenePath)} -> ${path.basename(resolvedPath)}`);
        try {
          await runCapture(process.execPath, ['--import', 'tsx', ...buildArgs], {
            cwd: rootDir,
            windowsHide: true,
            onSpawn: (child) => {
              childProc = child;
              childProcs.add(child);
            }
          });
        } catch (error) {
          throw new Error(`Scene resolve failed for ${path.basename(scenePath)}:\n${error.message}`);
        } finally {
          if (childProc) childProcs.delete(childProc);
        }
        resolvedSceneFiles.push(resolvedPath);
      }
      renderSceneFiles = resolvedSceneFiles;
    }

    if (activeJob && activeJob.aborted) {
      throw new Error('Process stopped by user');
    }

    const sceneOutputs = renderSceneFiles.map(scenePath => defaultOutputPath(scenePath));
    console.log(`Batch rendering ${renderSceneFiles.length} scenes with up to 4 parallel processes...`);
    await runLimited(renderSceneFiles, 4, async (scenePath, index) => {
      const sceneOutput = sceneOutputs[index];
      const sceneTempDir = path.join(tempDir, `scene-${String(index + 1).padStart(3, '0')}`);
      const framesDir = path.join(sceneTempDir, 'frames');
      const renderArgs = renderArgsForFile(scenePath, sceneOutput, options, [
        '--frames-dir', framesDir,
        '--workers', '1',
        '--video-codec', 'libx264'
      ]);
      let childProc = null;
      console.log(`Rendering scene ${index + 1}/${sceneFiles.length}: ${path.basename(scenePath)} -> ${path.basename(sceneOutput)}`);
      await runCapture(process.execPath, ['--import', 'tsx', ...renderArgs], {
        cwd: rootDir,
        windowsHide: true,
        onSpawn: (child) => {
          childProc = child;
          childProcs.add(child);
        }
      }).catch((error) => {
        const sceneError = new Error(`Scene render failed for ${path.basename(scenePath)}:\n${error.message}`);
        if (!firstSceneError) {
          firstSceneError = sceneError;
          for (const runningChild of childProcs) {
            if (runningChild !== childProc) killProcessTree(runningChild);
          }
        }
        if (existsSync(sceneOutput)) {
          try {
            unlinkSync(sceneOutput);
          } catch (err) {
            console.error(`Failed to delete partial scene render file: ${err.message}`);
          }
        }
        throw firstSceneError;
      }).finally(() => {
        if (childProc) childProcs.delete(childProc);
      });
    });

    if (activeJob && activeJob.aborted) {
      throw new Error('Process stopped by user');
    }

    console.log(`Joining ${sceneOutputs.length} rendered scene files -> ${path.basename(outputPath)}`);
    await concatRenderedScenes(sceneOutputs, outputPath, concatListPath);
    deleteIntermediateSceneRenders(sceneOutputs, outputPath);
    return toViewerPath(outputPath);
  } catch (error) {
    if (existsSync(outputPath)) {
      try {
        unlinkSync(outputPath);
      } catch (err) {
        console.error(`Failed to delete partial render file: ${err.message}`);
      }
    }
    if (activeJob && activeJob.aborted) {
      throw new Error('Process stopped by user');
    }
    throw error;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    activeJob = null;
  }
}

// Resolve /files URLs to local workspace files without allowing path traversal.
function resolveWorkspacePath(urlPath) {
  const rawPath = decodeURIComponent(urlPath.replace(/^\/files\/?/, ''));
  if (!rawPath) return rootDir;
  return resolveInputPath(rawPath);
}

// Resolve browser package assets served under /lecture-viewer.
function resolveViewerPackagePath(urlPath) {
  const rawPath = decodeURIComponent(urlPath.replace(/^\/lecture-viewer\/?/, ''));
  if (!rawPath) return null;
  const packageRoot = path.resolve(rootDir, 'packages', 'lecture-viewer', 'dist');
  const distPath = rawPath.replace(/\.mjs$/i, '.js');
  const resolvedPath = path.resolve(packageRoot, distPath);
  if (!resolvedPath.startsWith(packageRoot + path.sep) && resolvedPath !== packageRoot) {
    return null;
  }
  return resolvedPath;
}

// Stream a workspace file to the browser with a conservative MIME type.
function serveFile(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const resolvedPath = resolveWorkspacePath(requestUrl.pathname);

  if (!resolvedPath || !existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    sendText(response, 404, 'Not found');
    return;
  }

  const stat = statSync(resolvedPath);
  const fileSize = stat.size;
  const range = request.headers.range;
  const extension = path.extname(resolvedPath).toLowerCase();
  const contentType = mimeTypes.get(extension) || 'application/octet-stream';

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    let start = parts[0] ? parseInt(parts[0], 10) : null;
    let end = parts[1] ? parseInt(parts[1], 10) : null;

    if (start === null && end !== null) {
      start = fileSize - end;
      end = fileSize - 1;
    } else if (end === null) {
      end = fileSize - 1;
    }

    if (start === null || start < 0 || start >= fileSize || end >= fileSize || start > end) {
      response.writeHead(416, {
        "Content-Range": `bytes */${fileSize}`,
        "Accept-Ranges": "bytes"
      });
      return response.end();
    }

    const chunksize = (end - start) + 1;
    const file = createReadStream(resolvedPath, { start, end });
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    file.pipe(response);
  } else {
    response.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });
    createReadStream(resolvedPath).pipe(response);
  }
}

// Stream the packaged lecture-viewer runtime used by preview iframes.
function serveViewerPackageFile(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const resolvedPath = resolveViewerPackagePath(requestUrl.pathname);

  if (!resolvedPath || !existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    sendText(response, 404, 'Not found');
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  response.writeHead(200, {
    'content-type': mimeTypes.get(extension) || 'application/octet-stream',
    'cache-control': 'no-cache'
  });
  createReadStream(resolvedPath).pipe(response);
}

// Capture child-process output while still allowing callers to track spawned jobs.
function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      ...options
    });

    if (typeof options.onSpawn === 'function') {
      options.onSpawn(child);
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else {
        const output = `${stdout}\n${stderr}`
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .slice(-80)
          .join('\n');
        reject(new Error(output || `${command} exited with code ${code}`));
      }
    });
  });
}

// Windows-native picker used by the browser UI's Pick/Open command.
async function pickHtmlFile() {
  if (process.platform !== 'win32') {
    throw new Error('Native file picker is only implemented for Windows in this viewer.');
  }

  const escapedRoot = rootDir.replaceAll("'", "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$form = New-Object System.Windows.Forms.Form',
    '$form.TopMost = $true',
    '$form.ShowInTaskbar = $false',
    '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$form.Size = New-Object System.Drawing.Size(1, 1)',
    '$form.Opacity = 0',
    '$form.Show()',
    '$form.Activate()',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    `$dialog.InitialDirectory = '${escapedRoot}'`,
    "$dialog.Filter = 'Supported files (*.html;*.avsl;*.md;*.txt)|*.html;*.avsl;*.md;*.txt|HTML files (*.html)|*.html|AVSL scripts (*.avsl)|*.avsl|Markdown files (*.md)|*.md|Text files (*.txt)|*.txt|All files (*.*)|*.*'",
    "$dialog.Title = 'Open lecture IDE file'",
    'if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.FileName',
    '}',
    '$form.Dispose()'
  ].join('; ');

  const selectedPath = await runCapture('powershell', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script
  ]);

  if (!selectedPath) return null;

  const resolvedPath = path.resolve(selectedPath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error('Selected file does not exist.');
  }

  return normalizeOpenPath(resolvedPath);
}

// Server-wide state tracks the selected file, preview size, and active background job.
const args = parseArgs(process.argv.slice(2));
let activeJob = null;
// A server restart starts a new agent chat session. The first agent request
// consumes this flag and runs the agent with --new-session.
const viewerState = {
  version: 0,
  path: args.openPath,
  width: args.width,
  height: args.height
};

// If another IDE server is already running, pass the selected file to it instead.
async function pushFileToExistingViewer(args) {
  const url = new URL(`http://127.0.0.1:${args.port}/open-file`);
  url.searchParams.set('file', args.openPath);
  url.searchParams.set('width', String(args.width));
  url.searchParams.set('height', String(args.height));

  const response = await fetch(url, { method: 'POST' });
  const body = await response.text();
  let payload = {};
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    payload = { error: body };
  }

  if (!response.ok) {
    throw new Error(payload.error || `Existing viewer returned HTTP ${response.status}`);
  }

  console.log(`Sent file to existing viewer on port ${args.port}: ${payload.path || args.openPath}`);
}

// Main route table for the local IDE API and viewer UI.
const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, 'http://localhost');

  // Serve the IDE shell. The actual lecture preview is loaded through iframes/assets.
  if (requestUrl.pathname === '/' || requestUrl.pathname === '/viewer') {
    const width = Number(requestUrl.searchParams.get('width')) || args.width;
    const height = Number(requestUrl.searchParams.get('height')) || args.height;
    const openPath = requestUrl.searchParams.get('file') || viewerState.path || args.openPath;
    sendText(
      response,
      200,
      createViewerHtml(openPath, width, height),
      'text/html; charset=utf-8'
    );
    return;
  }

  // Lightweight polling endpoint used by the UI to detect selected-file changes.
  if (requestUrl.pathname === '/viewer-state') {
    const since = Number(requestUrl.searchParams.get('since')) || 0;
    sendJson(response, 200, {
      changed: viewerState.version > since,
      version: viewerState.version,
      path: viewerState.path,
      width: viewerState.width,
      height: viewerState.height
    });
    return;
  }

  // Change the currently selected file from another server instance or the browser UI.
  if (requestUrl.pathname === '/open-file') {
    try {
      const requestedPath = requestUrl.searchParams.get('file') || '';
      if (!requestedPath) throw new Error('Missing file path.');

      const width = Number(requestUrl.searchParams.get('width')) || viewerState.width;
      const height = Number(requestUrl.searchParams.get('height')) || viewerState.height;
      const normalizedPath = normalizeOpenPath(requestedPath);

      viewerState.version++;
      viewerState.path = normalizedPath;
      viewerState.width = Number.isInteger(width) && width > 0 ? width : viewerState.width;
      viewerState.height = Number.isInteger(height) && height > 0 ? height : viewerState.height;

      sendJson(response, 200, {
        ok: true,
        version: viewerState.version,
        path: viewerState.path,
        width: viewerState.width,
        height: viewerState.height
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // Return files next to the selected lecture file for the sidebar.
  if (requestUrl.pathname === '/folder-files') {
    try {
      const requestedPath = requestUrl.searchParams.get('file') || viewerState.path || args.openPath;
      if (!requestedPath) throw new Error('Missing file path.');
      sendJson(response, 200, listFolderFiles(requestedPath));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // Return directory entries for the full folder browser.
  if (requestUrl.pathname === '/browse-folder') {
    try {
      const requestedPath = requestUrl.searchParams.get('dir') || '';
      sendJson(response, 200, listDirectory(requestedPath));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // Open a folder in the native OS file explorer.
  if (requestUrl.pathname === '/open-folder') {
    try {
      const requestedFolder = requestUrl.searchParams.get('dir') || '';
      const requestedPath = requestUrl.searchParams.get('file') || viewerState.path || args.openPath;
      if (!requestedFolder && !requestedPath) throw new Error('Missing folder path.');
      sendJson(response, 200, {
        ok: true,
        folder: requestedFolder ? openFolderPath(requestedFolder) : openFolder(requestedPath)
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // Resolve source index*.html files into resolved*.html timeline files.
  if (requestUrl.pathname === '/resolve-file') {
    try {
      const requestedPath = requestUrl.searchParams.get('file') || '';
      if (!requestedPath) throw new Error('Missing file path.');
      const resolvedPath = await resolveLectureFile(requestedPath, {
        ttsVoice: requestUrl.searchParams.get('ttsVoice'),
        ttsSpeed: requestUrl.searchParams.get('ttsSpeed'),
        currentOnly: requestUrl.searchParams.get('currentOnly') === '1'
      });

      sendJson(response, 200, {
        ok: true,
        path: resolvedPath,
        folder: listFolderFiles(resolvedPath)
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Render selected index*.html or resolved*.html files to MP4.
  if (requestUrl.pathname === '/render-file') {
    try {
      const requestedPath = requestUrl.searchParams.get('file') || '';
      if (!requestedPath) throw new Error('Missing file path.');
      const outputPath = await renderLectureFile(requestedPath, {
        ttsVoice: requestUrl.searchParams.get('ttsVoice'),
        ttsSpeed: requestUrl.searchParams.get('ttsSpeed'),
        fps: requestUrl.searchParams.get('fps'),
        width: requestUrl.searchParams.get('width'),
        height: requestUrl.searchParams.get('height')
      });

      sendJson(response, 200, {
        ok: true,
        output: outputPath,
        folder: listFolderFiles(requestedPath)
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Stop the active long-running resolve, render, agent, or publish job.
  if (requestUrl.pathname === '/stop-job') {
    try {
      const agentState = getAgentState(requestUrl.searchParams.get('agentClientId'));
      if (agentState.activeJob) {
        const type = agentState.activeJob.type;
        agentState.activeJob.kill();
        sendJson(response, 200, { ok: true, stopped: true, type, message: `Stopped ${type} job successfully` });
        return;
      }
      if (!activeJob) {
        sendJson(response, 200, { ok: true, stopped: false, message: 'No active job' });
        return;
      }

      const type = activeJob.type;
      activeJob.kill();
      sendJson(response, 200, { ok: true, stopped: true, type, message: `Stopped ${type} job successfully` });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === '/agent-new-chat') {
    try {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const agentState = getAgentState(requestUrl.searchParams.get('agentClientId'));
      if (agentState.activeJob) {
        agentState.activeJob.kill();
      }
      agentState.log = '';
      agentState.currentWorkspace = '';
      agentState.pendingNewSession = true;
      agentState.session = null;
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Save browser-selected attachments so the CLI agent can receive them through
  // its explicit [(attachment: ...)] prompt directives.
  if (requestUrl.pathname === '/agent-upload') {
    try {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      getAgentState(requestUrl.searchParams.get('agentClientId'));
      const files = await saveAgentUploads(request);
      sendJson(response, 200, { ok: true, files });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // Return optional prompt profiles loaded from the lecture-agent workspace.
  if (requestUrl.pathname === '/agent-profiles') {
    try {
      sendJson(response, 200, { ok: true, profiles: listAgentProfiles() });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Send the user's message plus current IDE context to the coding agent.
  if (requestUrl.pathname === '/agent-chat') {
    try {
      let bodyData = '';
      request.on('data', chunk => { bodyData += chunk; });
      request.on('end', () => {
        try {
          const payload = JSON.parse(bodyData || '{}');
          const message = payload.message || '';
          const currentFile = payload.currentFile || '';
          const currentDir = payload.currentDir || '';
          const agentState = getAgentState(payload.agentClientId || requestUrl.searchParams.get('agentClientId'));

          if (!message) {
            sendJson(response, 400, { error: 'Missing message parameter.' });
            return;
          }

          if (agentState.pendingNewSession || !agentState.currentWorkspace) {
            createNewSessionWorkspace(agentState.id);
            agentState.pendingNewSession = false;
          }

          let task = '';
          if (currentFile) {
            const relPath = path.relative(rootDir, resolveInputPath(currentFile)).replaceAll(path.sep, '/');
            task += `[Context: The user is currently viewing the file "${relPath}" in the editor. Use this as the target file if they refer to "this file", "the script", "the code", or "the HTML".]\n\n`;
          }
          if (currentDir) {
            const relDir = path.relative(rootDir, resolveInputPath(currentDir)).replaceAll(path.sep, '/') || '.';
            task += `[Context: The folder browser is currently in the directory "${relDir}" of the repository.]\n\n`;
          }
          task += message;

          if (!agentState.session) {
            const agent = new LectureAgent({
              model: payload.model || process.env.AGENT_MODEL || "gemini-3.5-flash",
              workspaceDir: agentWorkspaceRoot(agentState.id),
              onLog: (text) => {
                agentState.log += text;
                process.stderr.write(text);
              }
            });
            agentState.session = agent.startChat();
          }

          agentState.log = ''; // Reset log buffer for this turn

          let isAborted = false;
          agentState.activeJob = {
            type: 'agent',
            kill: () => {
              isAborted = true;
              agentState.activeJob.aborted = true;
            }
          };

          console.log(`Starting in-process agent execution in: ${agentWorkspaceRoot(agentState.id)}`);

          (async () => {
            try {
              const responseText = await agentState.session.sendMessage(task);
              agentState.activeJob = null;
              if (isAborted) {
                return;
              }
              sendJson(response, 200, { ok: true, output: responseText.trim(), workspace: agentWorkspaceRoot(agentState.id) });
            } catch (err: any) {
              agentState.activeJob = null;
              if (isAborted) {
                return;
              }
              sendJson(response, 500, { error: err.message || `Agent execution failed: ${err}` });
            }
          })();
        } catch (error: any) {
          sendJson(response, 500, { error: error.message });
        }
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Ask the website package for available courses before publishing.
  if (requestUrl.pathname === '/list-courses') {
    try {
      const websiteDir = path.resolve(rootDir, '../mylecture-website');
      const output = await runCapture('node', ['scripts/admin.mjs', 'list'], {
        cwd: websiteDir,
        env: { ...process.env, NO_COLOR: '1' }
      });

      const lines = output.split(/\r?\n/);
      const courses = [];
      for (const line of lines) {
        const match = line.match(/^\[(published|draft)\]\s+([^\s]+)\s+-\s+(.+)$/);
        if (match) {
          courses.push({
            published: match[1] === 'published',
            slug: match[2],
            title: match[3]
          });
        }
      }

      sendJson(response, 200, { ok: true, courses });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Publish a rendered lecture folder through the website admin script.
  if (requestUrl.pathname === '/publish-lecture') {
    try {
      let bodyData = '';
      request.on('data', chunk => { bodyData += chunk; });
      request.on('end', async () => {
        try {
          const payload = JSON.parse(bodyData || '{}');
          
          const course = payload.course || '';
          const slug = payload.slug || '';
          const title = payload.title || '';
          const description = payload.description || '';
          const moduleName = payload.module || '';
          const order = payload.order || '';
          const thumbnailUrl = payload.thumbnailUrl || '';
          const published = payload.published ? 'true' : 'false';
          
          const courseTitle = payload.courseTitle || '';
          const courseDescription = payload.courseDescription || '';
          const coursePublished = payload.coursePublished !== undefined ? (payload.coursePublished ? 'true' : 'false') : null;
          
          const sourceDirRaw = payload.sourceDir || '';
          if (!sourceDirRaw) {
            sendJson(response, 400, { error: 'Missing source directory.' });
            return;
          }
          
          const sourceDir = resolveInputPath(sourceDirRaw);
          if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
            sendJson(response, 400, { error: `Directory does not exist: ${sourceDirRaw}` });
            return;
          }

          const args = [
            'scripts/admin.mjs',
            'upload-lecture',
            '--course', course,
            '--slug', slug,
            '--title', title,
            '--source-dir', sourceDir,
            '--published', published
          ];

          if (description) args.push('--description', description);
          if (moduleName) args.push('--module', moduleName);
          if (order) args.push('--order', order);
          if (thumbnailUrl) args.push('--thumbnail-url', thumbnailUrl);

          if (courseTitle) args.push('--course-title', courseTitle);
          if (courseDescription) args.push('--course-description', courseDescription);
          if (coursePublished !== null) args.push('--course-published', coursePublished);

          const websiteDir = path.resolve(rootDir, '../mylecture-website');
          
          console.log(`Starting publish process: node ${args.map(a => `"${a}"`).join(' ')}`);

          let stdout = '';
          let stderr = '';
          let childProc = null;

          activeJob = {
            type: 'publish',
            kill: () => {
              activeJob.aborted = true;
              if (childProc) killProcessTree(childProc);
            }
          };

          const child = spawn('node', args, {
            cwd: websiteDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
              ...process.env,
              NO_COLOR: '1'
            }
          });
          childProc = child;

          child.stdout.on('data', chunk => {
            const str = chunk.toString();
            stdout += str;
            console.log(str.trim());
          });

          child.stderr.on('data', chunk => {
            const str = chunk.toString();
            stderr += str;
            console.error(str.trim());
          });

          child.on('error', err => {
            activeJob = null;
            sendJson(response, 500, { error: err.message });
          });

          child.on('close', code => {
            activeJob = null;
            if (code === 0) {
              sendJson(response, 200, { ok: true, output: stdout.trim() });
            } else {
              const output = `${stdout}\n${stderr}`
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .slice(-80)
                .join('\n');
              sendJson(response, 500, { error: output || `Publish exited with code ${code}` });
            }
          });

        } catch (error) {
          sendJson(response, 500, { error: error.message });
        }
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Return the buffered stdout/stderr from the currently running coding agent job.
  if (requestUrl.pathname === '/agent-log') {
    const agentState = getAgentState(requestUrl.searchParams.get('agentClientId'));
    sendJson(response, 200, { log: agentState.log });
    return;
  }

  // Open a native file picker and return the selected path to the browser UI.
  if (requestUrl.pathname === '/pick') {
    try {
      const pickedPath = await pickHtmlFile();
      sendText(response, 200, JSON.stringify({ path: pickedPath }), 'application/json; charset=utf-8');
    } catch (error) {
      sendText(response, 500, JSON.stringify({ error: error.message }), 'application/json; charset=utf-8');
    }
    return;
  }

  // Serve arbitrary workspace files selected by the IDE preview.
  if (requestUrl.pathname.startsWith('/files/')) {
    serveFile(request, response);
    return;
  }

  // Serve the reusable lecture-viewer package files.
  if (requestUrl.pathname.startsWith('/lecture-viewer/')) {
    serveViewerPackageFile(request, response);
    return;
  }

  sendText(response, 404, 'Not found');
});

// If a server already owns the port, either hand off the requested file or fail clearly.
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && args.openPath) {
    pushFileToExistingViewer(args)
      .then(() => process.exit(0))
      .catch(pushError => {
        console.error(`Port ${args.port} is already in use, but the existing viewer did not accept the file.`);
        console.error(pushError.message);
        process.exit(1);
      });
    return;
  }

  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${args.port} is already in use. Pass --file <path> to send a file to the existing viewer, or choose another --port.`);
    process.exit(1);
    return;
  }

  console.error(error.message);
  process.exit(1);
});

// Bind only to localhost; this IDE server is not intended for network exposure.
server.listen(args.port, '127.0.0.1', () => {
  const encodedFile = args.openPath ? `?file=${encodeURIComponent(args.openPath)}` : '';
  const url = `http://127.0.0.1:${args.port}/${encodedFile}`;
  console.log(`IDE server running at ${url}`);
  if (args.openBrowser) openBrowser(url);
});
