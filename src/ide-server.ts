// @ts-nocheck
/**
 * ide-server.ts
 * Summer 2026, Touhidul Islam
 *
 * Local HTTP server for the MyLecture IDE. It serves the viewer UI, browses
 * lecture files, resolves source plans into renderable HTML, renders videos,
 * talks to the coding agent, and publishes rendered lecture folders to
 * the website package. It binds to localhost by default and can be explicitly
 * exposed to a trusted local network with --host 0.0.0.0.
 */
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { createViewerHtml } from './ui/viewer-html.ts';
import {
  editLectureViaAgentApi,
  generateLectureViaAgentApi,
  resolveViaAgentApi,
  renderViaAgentApi,
  resetAgentApiSession,
  getAgentOptions,
  ensureAgentApiAvailable as ensureAgentApiAvailableShared,
  stopManagedAgentApi
} from './lecture-agent-api-client.ts';
import { loadAppConfig, resolveConfigPath } from './config.ts';
import { writeLectureCaptionsVttIfMissing } from './captions-vtt.ts';
import {
  DEFAULT_ID_PATTERN,
  allocateFolderName,
  sanitizeTitle,
} from './session-folder-name.ts';

const rootDir = process.cwd();
const startupConfig = loadAppConfig(rootDir);

let managedAgentApiProcess = null;

const ideEnvKeys = new Set<string>();

async function ensureAgentApiAvailable() {
  await ensureAgentApiAvailableShared({ rootDir, envKeysToFilter: ideEnvKeys });
}

function valueAfter(label: string, text: string, fallback: string): string {
  const match = text.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\r\\n]+)`, 'i'));
  return match?.[1]?.trim() || fallback;
}

function parseIdeLectureGenRequest(task: string) {
  const attachments: string[] = [];
  const ATTACHMENT_PATTERN = /\[\(attachment:\s*([^)]+)\)\]/gi;
  for (const match of task.matchAll(ATTACHMENT_PATTERN)) {
    const trimmed = match[1].trim().replace(/[),.;:!?]+$/g, "");
    if (trimmed) {
      attachments.push(trimmed);
    }
  }

  const SETTINGS_MARKER_1 = 'if the user query is for lecture generation then follow this:';
  const SETTINGS_MARKER_2 = 'if the user query is for video generation then follow this:';
  
  let markerIndex = task.indexOf(SETTINGS_MARKER_1);
  let markerLength = SETTINGS_MARKER_1.length;
  if (markerIndex < 0) {
    markerIndex = task.indexOf(SETTINGS_MARKER_2);
    markerLength = SETTINGS_MARKER_2.length;
  }

  const rawRequest = (markerIndex >= 0 ? task.slice(0, markerIndex) : task)
    .replace(/\[Context:[\s\S]*?\]\s*/g, '')
    .replace(/\[\(attachment:\s*([^)]+)\)\]/gi, '')
    .trim();

  const settings = markerIndex >= 0 ? task.slice(markerIndex + markerLength) : '';
  const themeStart = settings.search(/(?:^|\n)theme:\s*/i);
  const teachingStart = settings.search(/(?:^|\n)teaching style:\s*/i);

  const theme = themeStart >= 0
    ? settings.slice(settings.indexOf(':', themeStart) + 1, teachingStart >= 0 ? teachingStart : settings.length).replace(/\[\(attachment:\s*([^)]+)\)\]/gi, '').trim()
    : '';

  const teachingStyle = teachingStart >= 0
    ? settings.slice(settings.indexOf(':', teachingStart) + 1).replace(/\[\(attachment:\s*([^)]+)\)\]/gi, '').trim()
    : '';

  return {
    request: rawRequest || 'Create a lecture video using the attached material.',
    aspectRatio: valueAfter('aspect ratio', settings, '16:9'),
    generationLength: valueAfter('generation length', settings, '1:00'),
    enableGetimg: valueAfter('getimg enabled', settings, 'yes').toLowerCase() !== 'no',
    includeVideo: valueAfter('output video', settings, 'yes').toLowerCase() !== 'no',
    includeInteractive: valueAfter('output interactive', settings, 'no').toLowerCase() === 'yes',
    includeGame: valueAfter('output practice game', settings, 'no').toLowerCase() === 'yes',
    theme,
    teachingStyle,
    attachments
  };
}

function readAppConfig() {
  return loadAppConfig(rootDir);
}

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
      sessionId: '',
      activeJob: null,
      log: '',
      pendingNewSession: true,
      phase: 'generate',
      session: null
    };
    agentClientStates.set(id, state);
  }
  return state;
}

function getAgentWorkspaceDir() {
  const config = readAppConfig();
  return resolveConfigPath(rootDir, config.agent.generationDir);
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
  state.sessionId = folderName;
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

const defaultPort = startupConfig.server.port;

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
    host: startupConfig.server.host,
    openPath: '',
    openBrowser: false,
    width: startupConfig.render.baseWidth,
    height: startupConfig.render.baseHeight,
    widthOverride: false,
    heightOverride: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--port') args.port = Number(next), i++;
    else if (arg === '--host') args.host = String(next || '').trim(), i++;
    else if (arg === '--file') args.openPath = next, i++;
    else if (arg === '--width') args.width = Number(next), args.widthOverride = true, i++;
    else if (arg === '--height') args.height = Number(next), args.heightOverride = true, i++;
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
  if (!args.host) {
    throw new Error('--host must be a hostname or IP address');
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
  --host <address> Local bind address. Default: ${startupConfig.server.host}
                   Use 0.0.0.0 to allow access from your local network
  --port <number>   Local server port. Default: ${defaultPort}
  --file <path>     HTML file to preselect in the viewer
  --width <pixels>  Preview viewport width. Default: ${startupConfig.render.baseWidth}
  --height <pixels> Preview viewport height. Default: ${startupConfig.render.baseHeight}
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

// Return URLs that humans can actually open. A wildcard bind address is
// replaced by localhost and each active non-internal IPv4 interface.
function getServerUrls(host, port) {
  if (host !== '0.0.0.0') {
    return [`http://${host}:${port}/`];
  }

  const urls = new Set([`http://127.0.0.1:${port}/`]);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.add(`http://${address.address}:${port}/`);
      }
    }
  }
  return [...urls];
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

function readJsonBody(request, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
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
    .filter(entry => entry.isFile() && entry.name !== '.mylecture-tts-overrides.json')
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

function agentUploadRoot(agentClientId = 'default') {
  return path.resolve(agentWorkspaceRoot(agentClientId), 'uploads');
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

async function saveAgentUploads(request, agentClientId = 'default') {
  const contentType = request.headers['content-type'] || '';
  if (!String(contentType).toLowerCase().startsWith('multipart/form-data')) {
    throw new Error('Upload must use multipart/form-data.');
  }

  const body = await receiveRequestBody(request);
  const parts = parseMultipartFormData(contentType, body);
  const files = parts.filter(part => part.name === 'files' && part.filename);
  if (files.length === 0) throw new Error('No files were uploaded.');

  const uploadDir = agentUploadRoot(agentClientId);
  mkdirSync(uploadDir, { recursive: true });
  const saved = [];

  for (const file of files) {
    const originalName = sanitizeUploadName(file.filename);
    if (!isSupportedAgentUpload(originalName)) {
      throw new Error(`Unsupported attachment type: ${originalName}`);
    }
    const targetPath = path.join(uploadDir, originalName);
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

const VIDEO_METADATA_TITLE_RE = /\btitle\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/;

function unescapeMetadataTitle(value) {
  return String(value).replace(/\\([\\'"])/g, '$1');
}

function titleFromVideoMetadataHtml(html) {
  // Scope extraction to the brace-matched metadata object so mid-edit partial HTML
  // cannot pick up a later unrelated `title:` outside the block.
  const blockMatch = /window\.__VIDEO_METADATA__\s*=\s*(\{[\s\S]*?\})/.exec(html);
  const block = blockMatch?.[1];
  if (!block) return null;
  const titleMatch = block.match(VIDEO_METADATA_TITLE_RE);
  if (titleMatch?.[2] != null) return unescapeMetadataTitle(titleMatch[2]);
  return null;
}

function lectureTitleForFolder(folderPath) {
  try {
    const resolvedFolder = path.resolve(folderPath);
    if (!existsSync(resolvedFolder) || !statSync(resolvedFolder).isDirectory()) return null;

    let indexFiles = [];
    try {
      indexFiles = readdirSync(resolvedFolder)
        .filter((name) => /^index.*\.html$/i.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch {
      indexFiles = [];
    }

    for (const name of indexFiles) {
      try {
        const html = readFileSync(path.join(resolvedFolder, name), 'utf8');
        const title = titleFromVideoMetadataHtml(html);
        if (typeof title === 'string' && title.trim()) return title.trim();
      } catch {
        // Try the next index*.html or fall through to metadata.json.
      }
    }

    const metadataPath = path.join(resolvedFolder, 'metadata.json');
    if (!existsSync(metadataPath)) return null;
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const rawName = metadata?.name ?? metadata?.title;
    if (typeof rawName === 'string' && rawName.trim()) return rawName.trim();
    return null;
  } catch {
    return null;
  }
}

function remapPathAfterFolderRename(filePath, oldFolder, newFolder) {
  if (!filePath) return filePath;
  const resolved = path.resolve(filePath);
  const oldResolved = path.resolve(oldFolder);
  const newResolved = path.resolve(newFolder);
  if (resolved === oldResolved) return newResolved;
  const prefix = oldResolved.endsWith(path.sep) ? oldResolved : `${oldResolved}${path.sep}`;
  if (resolved.startsWith(prefix)) {
    return path.join(newResolved, path.relative(oldResolved, resolved));
  }
  return filePath;
}

// True when a resolve (activeJob) or render (active/queued RenderJobs) is touching folderPath.
// Used to avoid renaming the session folder out from under an in-flight job.
function jobTouchesFolder(job, folderPath) {
  if (!job) return false;
  // Normalize case + separators so Windows C:\ vs c:\ (and / vs \) still match.
  const normalize = (p) => path.resolve(p).replaceAll('\\', '/').toLowerCase();
  const folder = normalize(folderPath);
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  for (const candidate of [job.inputPath, job.outPath]) {
    if (!candidate) continue;
    const resolved = normalize(candidate);
    if (resolved === folder || resolved.startsWith(prefix)) return true;
  }
  return false;
}

function hasActiveWorkInFolder(folderPath) {
  // /resolve-file uses the global activeJob; /render-file uses activeRenderJobs + queue.
  if (activeJob?.type === 'resolve' && jobTouchesFolder(activeJob, folderPath)) return true;
  for (const job of activeRenderJobs.values()) {
    if (jobTouchesFolder(job, folderPath)) return true;
  }
  for (const entry of queuedRenderJobs) {
    if (jobTouchesFolder(entry.job, folderPath)) return true;
  }
  return false;
}

// After LectureGen succeeds, rename <id> -> <title> (or <title> (N) on collision) when safe.
// Never throws. Keeps agentState.sessionId as the bare timestamp id (token tracker continuity);
// only currentWorkspace is updated here — viewerState.path is remapped by the caller.
// Opportunistic: skips (once) if render/resolve is mid-flight in this folder so the
// encode does not 500 on listFolderFiles(oldPath); rename-gens.ts can catch up later.
function renameSessionFolderAfterGeneration(agentState, workspaceDir) {
  try {
    const oldFolder = path.resolve(workspaceDir);
    const folderName = path.basename(oldFolder);
    if (!DEFAULT_ID_PATTERN.test(folderName)) return null;

    if (hasActiveWorkInFolder(oldFolder)) {
      console.warn(
        `[Session] Skip rename (render/resolve active in folder): ${folderName}`
      );
      return null;
    }

    const rawTitle = lectureTitleForFolder(oldFolder);
    const desiredName = sanitizeTitle(rawTitle);
    if (!desiredName) return null;

    // Idempotent: pattern-shaped titles still match DEFAULT_ID_PATTERN after rename;
    // skip when the folder already has the desired name so we never append (2)/(3)/…
    if (desiredName.toLowerCase() === folderName.toLowerCase()) {
      console.log(`[Session] Already named: ${folderName}`);
      return null;
    }

    const parentDir = path.dirname(oldFolder);
    const newFolderName = allocateFolderName(parentDir, desiredName);
    const newFolder = path.join(parentDir, newFolderName);

    renameSync(oldFolder, newFolder);
    agentState.currentWorkspace = newFolder;
    console.log(`[Session] Renamed session folder: ${folderName} -> ${newFolderName}`);
    return { oldFolder, newFolder, newFolderName };
  } catch (error) {
    console.warn(`[Session] Folder rename skipped: ${error?.message || error}`);
    return null;
  }
}

function defaultOutputPath(filePath, title) {
  const basename = path.basename(filePath);
  const match = basename.match(/^(?:index|resolved)(.*)\.html$/i);
  const suffix = match?.[1] || '';
  const resolvedTitle = title !== undefined
    ? title
    : sanitizeTitle(lectureTitleForFolder(path.dirname(resolveInputPath(filePath))));
  if (resolvedTitle) {
    // Scene delimiter is `~` (stripped from titles) so Part-2.mp4 finals are not parsed as scene 2.
    const name = suffix ? `${resolvedTitle}~${suffix}.mp4` : `${resolvedTitle}.mp4`;
    return siblingPath(filePath, name);
  }
  return siblingPath(filePath, `rendered${suffix}.mp4`);
}

function finalBatchOutputPath(filePath, title) {
  const resolvedTitle = title !== undefined
    ? title
    : sanitizeTitle(lectureTitleForFolder(path.dirname(resolveInputPath(filePath))));
  if (resolvedTitle) {
    return siblingPath(filePath, `${resolvedTitle}.mp4`);
  }
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

function sourceSiblingPathForLecture(filePath) {
  const resolvedPath = resolveInputPath(filePath);
  const basename = path.basename(resolvedPath);
  if (isIndexHtmlName(basename)) return resolvedPath;
  if (isResolvedHtmlName(basename)) {
    const suffix = basename.slice('resolved'.length, -'.html'.length);
    return siblingPath(resolvedPath, `index${suffix}.html`);
  }
  throw new Error('Narration editing is only available for source or resolved HTML files.');
}

function saveTtsOverride(sourcePath, sectionId, text, ttsText) {
  const overridesPath = path.join(path.dirname(sourcePath), '.mylecture-tts-overrides.json');
  let payload = { version: 1, files: {} };
  if (existsSync(overridesPath)) {
    try {
      const existing = JSON.parse(readFileSync(overridesPath, 'utf8'));
      if (existing && typeof existing === 'object') payload = existing;
    } catch (error) {
      throw new Error(`Could not read existing narration edits: ${error.message}`);
    }
  }
  if (!payload.files || typeof payload.files !== 'object') payload.files = {};
  const sourceName = path.basename(sourcePath);
  if (!payload.files[sourceName] || typeof payload.files[sourceName] !== 'object') {
    payload.files[sourceName] = {};
  }
  payload.version = 1;
  payload.files[sourceName][sectionId] = { text, ttsText };
  writeFileSync(overridesPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return overridesPath;
}

function escapeHtmlText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function replaceVisibleHtmlText(source, oldText, newText) {
  const encodedOldText = escapeHtmlText(oldText);
  const encodedNewText = escapeHtmlText(newText);
  let replacements = 0;
  const protectedBlocks = source.split(/(<(?:script|style)\b[\s\S]*?<\/(?:script|style)>)/gi);

  const updated = protectedBlocks.map(block => {
    if (/^<(?:script|style)\b/i.test(block)) return block;
    return block.replace(/>([^<]*)</g, (match, textContent) => {
      let nextText = textContent;
      for (const candidate of new Set([oldText, encodedOldText])) {
        if (!candidate) continue;
        const count = nextText.split(candidate).length - 1;
        if (count > 0) {
          nextText = nextText.split(candidate).join(encodedNewText);
          replacements += count;
        }
      }
      return `>${nextText}<`;
    });
  }).join('');

  return { source: updated, replacements };
}

function decodeHtmlText(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function visibleTextCandidatesFromHtml(source) {
  const withoutCode = source
    .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const candidates = new Set();
  for (const match of withoutCode.matchAll(/>([^<]+)</g)) {
    const text = decodeHtmlText(match[1]).replace(/\s+/g, ' ').trim();
    if (text && text.length <= 500) candidates.add(text);
  }
  return [...candidates].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );
}

function saveVisualTextEdit(sourcePath, oldText, newText) {
  const source = readFileSync(sourcePath, 'utf8');
  const updated = replaceVisibleHtmlText(source, oldText, newText);
  if (updated.replacements === 0) {
    throw new Error('That text was not found in the scene HTML. Choose it from the visible-text list or enter the exact on-screen wording.');
  }
  writeFileSync(sourcePath, updated.source, 'utf8');

  const resolvedPath = resolvedSiblingPathForIndex(sourcePath);
  let resolvedReplacements = 0;
  if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
    const resolved = readFileSync(resolvedPath, 'utf8');
    const resolvedUpdate = replaceVisibleHtmlText(resolved, oldText, newText);
    resolvedReplacements = resolvedUpdate.replacements;
    if (resolvedReplacements > 0) {
      writeFileSync(resolvedPath, resolvedUpdate.source, 'utf8');
    }
  }

  const scriptPath = path.join(path.dirname(sourcePath), 'script.md');
  let scriptReplacements = 0;
  if (existsSync(scriptPath) && statSync(scriptPath).isFile()) {
    const script = readFileSync(scriptPath, 'utf8');
    scriptReplacements = script.split(oldText).length - 1;
    if (scriptReplacements > 0) {
      writeFileSync(scriptPath, script.split(oldText).join(newText), 'utf8');
    }
  }

  return {
    htmlReplacements: updated.replacements,
    resolvedReplacements,
    scriptReplacements,
    resolvedPath
  };
}

const SCOPED_VISUAL_EDIT_MAX_TURNS = 8;

function visualEditLog(message: string): void {
  process.stdout.write(`[visual edit] ${message}\n`);
}

function scopedVisualEditorSystemPrompt(targetName) {
  return `You are a tightly scoped MyLecture visual scene editor.

# Scope

- The isolated workspace contains exactly one target file: ${targetName}.
- Read that file once, then apply one or a few small edits tool patches — never rewrite the whole file.
- Change only visual/layout/render code: HTML structure for visuals, CSS, SVG, Canvas, or window.__RENDER_SECTION__ drawing logic.
- Make the smallest sufficient change for the user's request.
- Keep every coordinate in its immediate positioned parent's local coordinate system. Never reuse 1920x1080 stage coordinates inside an inset or reduced-width container; prefer Flexbox/Grid for multi-node rows and verify equal intended edge margins.
- Do NOT edit, regenerate, reformat, or delete window.__VIDEO_METADATA__ or window.__VIDEO_PLAN__. Narration text, audio paths, cue IDs, cue ordering, and timing are immutable — the host discards any change to those blocks.
- For broad requests (e.g. "readd missing visuals"), implement only what existing cues already describe — do not invent new cue IDs or narration.
- Preserve unrelated visual content and timing.
- Do not add new facts, equations, statistics, labels, citations, or other technical content.
- Do not create files or inspect anything outside the target file.
- Do not modify resolved HTML, audio, scripts, or assets.
- The target must retain window.__VIDEO_METADATA__, window.__VIDEO_PLAN__, and window.__RENDER_SECTION__ and pass the HTML contract validator.
- When the edit is complete, provide one short sentence describing it.

# Available tools:

# Rules:

- Use read once to inspect the target, then use edits for the minimal change.
- Do not call list_dir.
- Do not finish until the edit has been applied.`;
}

async function runScopedVisualEdit(sourcePath, instruction, options = {}) {
  const visualEditRoot = path.resolve(rootDir, '.render', 'visual-edits');
  mkdirSync(visualEditRoot, { recursive: true });
  const workspacePath = mkdtempSync(path.join(visualEditRoot, 'scene-'));
  const sourceName = path.basename(sourcePath);
  const isolatedPath = path.join(workspacePath, sourceName);
  const original = readFileSync(sourcePath, 'utf8');
  writeFileSync(isolatedPath, original, 'utf8');

  visualEditLog(`Starting on ${sourceName} (max ${SCOPED_VISUAL_EDIT_MAX_TURNS} turns)`);

  try {
    await ensureAgentApiAvailableShared({ rootDir });
    const output = await editLectureViaAgentApi({
      request: `Target file: ${sourceName}\n\nRequested visual change:\n${instruction}`,
      workspaceDir: workspacePath,
      model: options.model || process.env.AGENT_MODEL || 'gemini-3.5-flash',
      maxTurns: SCOPED_VISUAL_EDIT_MAX_TURNS,
      tokenTrackerSessionId: `visual-${path.basename(workspacePath)}`,
      systemPrompt: scopedVisualEditorSystemPrompt(sourceName),
    }, {
      signal: options.signal,
      onLog: text => process.stdout.write(`[visual edit] ${text}`)
    });
    const modified = readFileSync(isolatedPath, 'utf8');
    if (modified === original) {
      throw new Error('The model completed without changing the scene.');
    }
    visualEditLog('Edit complete; applying.');
    return { original, modified, output: String(output || '').trim() };
  } catch (error) {
    visualEditLog(`Failed: ${error?.message || error}`);
    throw error;
  } finally {
    const resolvedWorkspace = path.resolve(workspacePath);
    if (resolvedWorkspace.startsWith(`${visualEditRoot}${path.sep}`)) {
      rmSync(resolvedWorkspace, { recursive: true, force: true });
    }
  }
}

function syncResolvedVisualFromSource(sourcePath, modifiedSource) {
  const resolvedPath = resolvedSiblingPathForIndex(sourcePath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) return '';

  const resolved = readFileSync(resolvedPath, 'utf8');
  const injectionStart = resolved.indexOf('<style id="resolved-export-motion-guard">');
  const resolvedBodyClose = resolved.lastIndexOf('</body>');
  const sourceBodyClose = modifiedSource.lastIndexOf('</body>');
  if (injectionStart < 0 || resolvedBodyClose < injectionStart || sourceBodyClose < 0) {
    throw new Error('The resolved scene could not be synchronized safely. The source scene was left unchanged.');
  }

  const preservedRuntime = resolved.slice(injectionStart, resolvedBodyClose).trim();
  const synchronized = `${modifiedSource.slice(0, sourceBodyClose)}${preservedRuntime}\n${modifiedSource.slice(sourceBodyClose)}`;
  writeFileSync(resolvedPath, synchronized, 'utf8');
  return resolvedPath;
}

// TTS options are normalized before being passed through to build-plan.ts.
function normalizeTtsVoice(value) {
  const config = readAppConfig();
  const voice = String(value || '').trim();
  return voice || config.tts.voice;
}

function normalizeTtsProvider(value) {
  const config = readAppConfig();
  const provider = String(value || '').trim();
  return provider || config.tts.provider;
}

function resolveTtsProvider(options, voice) {
  const config = readAppConfig();
  if (options.ttsProvider) {
    return normalizeTtsProvider(options.ttsProvider);
  }
  if (voice === config.tts.voice) {
    return config.tts.provider;
  }
  return detectProvider(voice);
}

function detectProvider(voice) {
  const v = String(voice || '').trim().toLowerCase();
  if (!v) return 'kokoro';

  if (v === 'bihbv24mwmergaszh58o') {
    return 'elevenlabs';
  }

  const omniVoices = new Set([
    'mike',
    'american-male-1',
    'american-male-2',
    'american-male-3',
    'johnny-harris',
    'maruf'
  ]);
  if (omniVoices.has(v)) {
    return 'omnivoice';
  }

  const voicesDir = path.resolve(rootDir, 'voices');
  if (existsSync(voicesDir)) {
    try {
      const folders = readdirSync(voicesDir).filter(name =>
        statSync(path.join(voicesDir, name)).isDirectory()
      );
      if (folders.some(folder => folder.toLowerCase() === v)) {
        return 'omnivoice';
      }
    } catch (e) {}
  }

  if (v.startsWith('am_') || v.startsWith('af_') || v.startsWith('bf_') || v.startsWith('bm_')) {
    return 'kokoro';
  }
  const openAiVoices = new Set(['alloy', 'ash', 'ballad', 'coral', 'cedar', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);
  if (openAiVoices.has(v)) {
    return 'openai';
  }
  return 'kokoro';
}

function normalizeTtsSpeed(value) {
  const configuredSpeed = Number(readAppConfig().tts.speed);
  const fallbackSpeed = Number.isFinite(configuredSpeed) && configuredSpeed > 0 ? configuredSpeed : 1;
  const speed = value === undefined || value === null || value === '' ? fallbackSpeed : Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return String(fallbackSpeed);
  return String(Math.max(0.5, Math.min(2, speed)));
}

function normalizePositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return String(fallback);
  return String(number);
}

function normalizeSubtitleFont(value) {
  const font = String(value || 'Arial').trim();
  if (!font || font.length > 80 || !/^[\p{L}\p{N} ._-]+$/u.test(font)) {
    throw new Error('Subtitle font must be a valid font-family name.');
  }
  return font;
}

function normalizeSubtitleNumber(value, fallback, min, max, label) {
  const number = value === null || value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function envPositiveInteger(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
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
  const provider = resolveTtsProvider(options, voice);
  let finalResolvedPath = '';

  const filesToResolve = options.currentOnly ? [path.basename(inputPath)] : files;

  for (const file of filesToResolve) {
    const fileInputPath = path.join(folderPath, file);
    const fileOutPath = resolvedSiblingPathForIndex(fileInputPath);

    const abortController = new AbortController();
    activeJob = {
      type: 'resolve',
      outPath: fileOutPath,
      inputPath: fileInputPath,
      kill: () => {
        activeJob.aborted = true;
        abortController.abort();
      }
    };

    try {
      console.log(`Resolving scene: ${file} -> ${path.basename(fileOutPath)}`);
      await ensureAgentApiAvailable();
      await resolveViaAgentApi({
        input: fileInputPath,
        out: fileOutPath,
        provider: provider,
        voice: voice,
        speed: parseFloat(normalizeTtsSpeed(options.ttsSpeed)),
        ...(options.forceAudioSection ? { forceAudioSection: options.forceAudioSection } : {})
      }, {
        signal: abortController.signal
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

// Burn exact narration text/timing from resolved lecture files into a rendered MP4.
async function burnRenderedSubtitles(inputPath, outputPath, resolvedFiles, options, job) {
  const config = readAppConfig();
  const args = [
    '--import',
    'tsx',
    'src/subtitle-burner.ts',
    '--input', inputPath,
    '--out', outputPath,
    '--font', normalizeSubtitleFont(options.subtitleFont || config.render.subtitleFont),
    '--font-size', String(normalizeSubtitleNumber(options.subtitleFontSize, config.render.subtitleFontSize, 12, 200, 'Subtitle font size')),
    '--bottom-percent', String(normalizeSubtitleNumber(options.subtitleBottomPercent, config.render.subtitleBottomPercent, 0, 50, 'Subtitle distance from bottom'))
  ];
  for (const resolvedFile of resolvedFiles) {
    args.push('--resolved-html', resolvedFile);
  }

  let childProc = null;
  try {
    await runCapture(process.execPath, args, {
      cwd: rootDir,
      windowsHide: true,
      onSpawn: (child) => {
        childProc = child;
        job.childProcs.add(child);
      }
    });
  } catch (error) {
    throw error;
  } finally {
    if (childProc) job.childProcs.delete(childProc);
  }
}

// Build list of scenes for sequential or parallel render steps.
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

function createRenderJob() {
  const abortController = new AbortController();
  const job = {
    id: nextRenderJobId++,
    type: 'render',
    status: 'queued',
    childProcs: new Set(),
    aborted: false,
    reject: null,
    abortController,
    kill: () => {
      job.aborted = true;
      abortController.abort();
      for (const childProc of job.childProcs) {
        killProcessTree(childProc);
      }
      if (job.status === 'queued' && job.reject) {
        job.reject(new Error('Process stopped by user'));
      }
    }
  };
  return job;
}

function pumpRenderQueue() {
  while (runningRenderJobs < maxParallelRenderJobs && queuedRenderJobs.length > 0) {
    const entry = queuedRenderJobs.shift();
    const { job, task, resolve, reject } = entry;
    if (job.aborted) {
      reject(new Error('Process stopped by user'));
      continue;
    }

    job.status = 'running';
    runningRenderJobs++;
    activeRenderJobs.set(job.id, job);
    Promise.resolve()
      .then(() => task(job))
      .then(resolve, reject)
      .finally(() => {
        activeRenderJobs.delete(job.id);
        runningRenderJobs = Math.max(0, runningRenderJobs - 1);
        pumpRenderQueue();
      });
  }
}

function enqueueRenderJob(task, inputPath) {
  const job = createRenderJob();
  // Stamp inputPath at enqueue so renameSessionFolderAfterGeneration can see queued
  // jobs that have not yet entered renderLectureFile (which also sets inputPath).
  if (inputPath) job.inputPath = resolveInputPath(inputPath);
  return new Promise((resolve, reject) => {
    job.reject = reject;
    queuedRenderJobs.push({ job, task, resolve, reject });
    console.log(`Queued render job ${job.id}. Running ${runningRenderJobs}/${maxParallelRenderJobs}, queued ${queuedRenderJobs.length}.`);
    pumpRenderQueue();
  });
}

function hasRenderJobs() {
  return activeRenderJobs.size > 0 || queuedRenderJobs.length > 0;
}

function killRenderJobs() {
  const count = activeRenderJobs.size + queuedRenderJobs.length;
  for (const job of activeRenderJobs.values()) job.kill();
  for (const entry of queuedRenderJobs.splice(0)) entry.job.kill();
  return count;
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
async function renderLectureFile(filePath, options = {}, job = createRenderJob()) {
  const inputPath = resolveInputPath(filePath);
  const basename = path.basename(inputPath);
  if (!isIndexHtmlName(basename) && !isResolvedHtmlName(basename)) {
    throw new Error('Render is only available for index*.html or resolved*.html files.');
  }

  const folderTitle = sanitizeTitle(lectureTitleForFolder(path.dirname(inputPath)));
  const sceneFiles = renderSceneSet(inputPath);
  if (sceneFiles.length > 1) {
    return await renderLectureBatch(inputPath, sceneFiles, options, job, folderTitle);
  }

  const outPath = defaultOutputPath(inputPath, folderTitle);
  const framesDir = path.join(rootDir, '.render', 'server-render', `job-${job.id}`, 'frames');
  const burnSubtitle = options.burnSubtitle === true;
  const renderOutputPath = burnSubtitle ? path.join(path.dirname(framesDir), 'unsubtitled.mp4') : outPath;

  const config = readAppConfig();
  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = resolveTtsProvider(options, voice);

  job.outPath = outPath;
  job.inputPath = inputPath;

  try {
    await ensureAgentApiAvailable();
    if (isResolvedHtmlName(basename)) {
      const sourcePath = sourceSiblingPathForLecture(inputPath);
      if (existsSync(sourcePath)) {
        console.log(`Checking resolved narration against ${voice} @ ${normalizeTtsSpeed(options.ttsSpeed)}x before render...`);
        await resolveViaAgentApi({
          input: sourcePath,
          out: inputPath,
          provider: provider,
          voice: voice,
          speed: parseFloat(normalizeTtsSpeed(options.ttsSpeed)),
          writeCaption: false
        }, {
          signal: job.abortController.signal
        });
      }
    }
    await renderViaAgentApi({
      html: inputPath,
      out: renderOutputPath,
      fps: normalizePositiveInteger(options.fps, config.render.fps, 1, 240),
      width: normalizePositiveInteger(options.width, config.render.baseWidth, 1),
      height: normalizePositiveInteger(options.height, config.render.baseHeight, 1),
      ttsProvider: provider,
      ttsVoice: voice,
      ttsSpeed: parseFloat(normalizeTtsSpeed(options.ttsSpeed)),
      framesDir: framesDir,
      autoBuildPlan: isIndexHtmlName(basename)
    }, {
      signal: job.abortController.signal
    });

    if (burnSubtitle) {
      const resolvedFile = isIndexHtmlName(basename) ? resolvedSiblingPathForIndex(inputPath) : inputPath;
      console.log(`Burning centered subtitles into ${path.basename(outPath)}...`);
      await burnRenderedSubtitles(renderOutputPath, outPath, [resolvedFile], options, job);
    }
    return toViewerPath(outPath);
  } catch (error) {
    if (existsSync(outPath)) {
      try {
        unlinkSync(outPath);
      } catch (err) {
        console.error(`Failed to delete partial render file: ${err.message}`);
      }
    }
    if (job.aborted) {
      throw new Error('Process stopped by user');
    }
    throw error;
  } finally {
    rmSync(path.dirname(framesDir), { recursive: true, force: true });
  }
}

// Resolve and render multiple scenes, then concatenate them into one final MP4.
async function renderLectureBatch(inputPath, sceneFiles, options = {}, job = createRenderJob(), folderTitle) {
  const batchId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempDir = path.resolve(rootDir, '.render', 'batch-render', batchId);
  const title = folderTitle !== undefined
    ? folderTitle
    : sanitizeTitle(lectureTitleForFolder(path.dirname(inputPath)));
  const outputPath = finalBatchOutputPath(inputPath, title);
  const concatListPath = path.join(tempDir, 'concat.txt');
  let firstSceneError = null;
  let renderSceneFiles = sceneFiles;

  const config = readAppConfig();
  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = resolveTtsProvider(options, voice);

  mkdirSync(tempDir, { recursive: true });
  job.outPath = outputPath;
  job.inputPath = inputPath;

  try {
    const sourceSceneFiles = isIndexHtmlName(path.basename(inputPath))
      ? sceneFiles
      : sceneFiles.map(scenePath => sourceSiblingPathForLecture(scenePath));
    const shouldResolveBeforeRender = isIndexHtmlName(path.basename(inputPath))
      || sourceSceneFiles.every(sourcePath => existsSync(sourcePath));
    if (shouldResolveBeforeRender) {
      console.log(`Checking ${sourceSceneFiles.length} scene(s) against ${voice} @ ${normalizeTtsSpeed(options.ttsSpeed)}x before batch render...`);
      const resolvedSceneFiles = [];
      for (let index = 0; index < sourceSceneFiles.length; index++) {
        const scenePath = sourceSceneFiles[index];
        const resolvedPath = resolvedSiblingPathForIndex(scenePath);
        console.log(`Resolving scene ${index + 1}/${sourceSceneFiles.length}: ${path.basename(scenePath)} -> ${path.basename(resolvedPath)}`);
        try {
          await ensureAgentApiAvailable();
          await resolveViaAgentApi({
            input: scenePath,
            out: resolvedPath,
            provider: provider,
            voice: voice,
            speed: parseFloat(normalizeTtsSpeed(options.ttsSpeed)),
            writeCaption: false,
            ...(options.forceAudio ? { forceAudio: true } : {})
          }, {
            signal: job.abortController.signal
          });
        } catch (error: any) {
          throw new Error(`Scene resolve failed for ${path.basename(scenePath)}:\n${error.message}`);
        }
        resolvedSceneFiles.push(resolvedPath);
      }
      renderSceneFiles = resolvedSceneFiles;
    }

    const captionsPath = writeLectureCaptionsVttIfMissing(path.dirname(inputPath));
    if (captionsPath) console.log(`Using lecture captions: ${path.basename(captionsPath)}`);

    if (job.aborted) {
      throw new Error('Process stopped by user');
    }

    const finalResolved = path.resolve(outputPath);
    const sceneOutputs = renderSceneFiles.map((scenePath, index) => {
      const sceneOut = defaultOutputPath(scenePath, title);
      if (path.resolve(sceneOut) !== finalResolved) return sceneOut;
      return path.join(path.dirname(sceneOut), `temp_${index}-${path.basename(sceneOut)}`);
    });
    console.log(`Batch rendering ${renderSceneFiles.length} scenes with up to 4 parallel processes...`);
    await runLimited(renderSceneFiles, 4, async (scenePath, index) => {
      const sceneOutput = sceneOutputs[index];
      const sceneTempDir = path.join(tempDir, `scene-${String(index + 1).padStart(3, '0')}`);
      const framesDir = path.join(sceneTempDir, 'frames');
      console.log(`Rendering scene ${index + 1}/${sceneFiles.length}: ${path.basename(scenePath)} -> ${path.basename(sceneOutput)}`);

      try {
        await ensureAgentApiAvailable();
        await renderViaAgentApi({
          html: scenePath,
          out: sceneOutput,
          fps: normalizePositiveInteger(options.fps, config.render.fps, 1, 240),
          width: normalizePositiveInteger(options.width, config.render.baseWidth, 1),
          height: normalizePositiveInteger(options.height, config.render.baseHeight, 1),
          ttsProvider: provider,
          ttsVoice: voice,
          ttsSpeed: parseFloat(normalizeTtsSpeed(options.ttsSpeed)),
          framesDir: framesDir,
          workers: 1,
          videoCodec: 'libx264',
          autoBuildPlan: false,
          writeCaption: false
        }, {
          signal: job.abortController.signal
        });
      } catch (error: any) {
        const sceneError = new Error(`Scene render failed for ${path.basename(scenePath)}:\n${error.message}`);
        if (!firstSceneError) {
          firstSceneError = sceneError;
        }
        if (existsSync(sceneOutput)) {
          try {
            unlinkSync(sceneOutput);
          } catch (err) {
            console.error(`Failed to delete partial scene render file: ${err.message}`);
          }
        }
        throw firstSceneError;
      }
    });

    if (job.aborted) {
      throw new Error('Process stopped by user');
    }

    const burnSubtitle = options.burnSubtitle === true;
    const concatenatedPath = burnSubtitle ? path.join(tempDir, 'unsubtitled.mp4') : outputPath;
    console.log(`Joining ${sceneOutputs.length} rendered scene files -> ${path.basename(concatenatedPath)}`);
    await concatRenderedScenes(sceneOutputs, concatenatedPath, concatListPath);
    deleteIntermediateSceneRenders(sceneOutputs, outputPath);
    if (burnSubtitle) {
      console.log(`Burning centered subtitles into ${path.basename(outputPath)}...`);
      await burnRenderedSubtitles(concatenatedPath, outputPath, renderSceneFiles, options, job);
    }
    return toViewerPath(outputPath);
  } catch (error) {
    if (existsSync(outputPath)) {
      try {
        unlinkSync(outputPath);
      } catch (err) {
        console.error(`Failed to delete partial render file: ${err.message}`);
      }
    }
    if (job.aborted) {
      throw new Error('Process stopped by user');
    }
    throw error;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
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
const maxParallelRenderJobs = envPositiveInteger('RENDER_MAX_PARALLEL', 1);
let nextRenderJobId = 1;
let runningRenderJobs = 0;
const queuedRenderJobs = [];
const activeRenderJobs = new Map();
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
  const connectionHost = args.host === '0.0.0.0' ? '127.0.0.1' : args.host;
  const url = new URL(`http://${connectionHost}:${args.port}/open-file`);
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
  const appConfig = readAppConfig();
  const requestUrl = new URL(request.url, 'http://localhost');

  // Serve the IDE shell. The actual lecture preview is loaded through iframes/assets.
  if (requestUrl.pathname === '/' || requestUrl.pathname === '/viewer') {
    const defaultWidth = args.widthOverride ? args.width : appConfig.render.baseWidth;
    const defaultHeight = args.heightOverride ? args.height : appConfig.render.baseHeight;
    const width = Number(requestUrl.searchParams.get('width')) || defaultWidth;
    const height = Number(requestUrl.searchParams.get('height')) || defaultHeight;
    const openPath = requestUrl.searchParams.get('file') || viewerState.path || args.openPath;
    sendText(
      response,
      200,
      createViewerHtml(openPath, width, height, {
        agent: appConfig.agent,
        tts: appConfig.tts,
        render: appConfig.render
      }),
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
  if (requestUrl.pathname === '/regenerate-narration-section') {
    try {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const payload = await readJsonBody(request);
      const requestedPath = String(payload.file || '').trim();
      const sectionId = String(payload.sectionId || '').trim();
      const text = String(payload.text || '').trim();
      const ttsText = String(payload.ttsText || '').trim();
      if (!requestedPath) throw new Error('Missing file path.');
      if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(sectionId)) {
        throw new Error('Invalid narration section id.');
      }
      if (!ttsText) throw new Error('Spoken text cannot be empty.');
      if (!text) throw new Error('Caption text cannot be empty.');
      if (ttsText.length > 10000) throw new Error('Spoken text is too long.');
      if (text.length > 10000) throw new Error('Caption text is too long.');

      const sourcePath = sourceSiblingPathForLecture(requestedPath);
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        throw new Error(`Source HTML does not exist: ${sourcePath}`);
      }

      saveTtsOverride(sourcePath, sectionId, text, ttsText);
      const resolvedPath = await resolveLectureFile(sourcePath, {
        ttsVoice: payload.ttsVoice,
        ttsSpeed: payload.ttsSpeed,
        currentOnly: true,
        forceAudioSection: sectionId
      });
      sendJson(response, 200, {
        ok: true,
        path: resolvedPath,
        sectionId,
        folder: listFolderFiles(resolvedPath)
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === '/visual-text-candidates') {
    try {
      const requestedPath = requestUrl.searchParams.get('file') || viewerState.path || args.openPath;
      if (!requestedPath) throw new Error('Missing file path.');
      const sourcePath = sourceSiblingPathForLecture(requestedPath);
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        throw new Error(`Source HTML does not exist: ${sourcePath}`);
      }
      const candidates = visibleTextCandidatesFromHtml(readFileSync(sourcePath, 'utf8'));
      sendJson(response, 200, { ok: true, candidates });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Apply an exact on-screen text correction without asking the coding agent
  // to reinterpret or regenerate the scene.
  if (requestUrl.pathname === '/edit-visual-text') {
    try {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const payload = await readJsonBody(request);
      const requestedPath = String(payload.file || '').trim();
      const oldText = String(payload.oldText || '').trim();
      const newText = String(payload.newText || '').trim();
      if (!requestedPath) throw new Error('Missing file path.');
      if (!oldText) throw new Error('Text to replace cannot be empty.');
      if (!newText) throw new Error('Replacement text cannot be empty.');
      if (oldText.length > 10000 || newText.length > 10000) {
        throw new Error('Visual text is too long.');
      }

      const openedPath = resolveInputPath(requestedPath);
      const sourcePath = sourceSiblingPathForLecture(openedPath);
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        throw new Error(`Source HTML does not exist: ${sourcePath}`);
      }

      const edits = saveVisualTextEdit(sourcePath, oldText, newText);
      const resultPath = isResolvedHtmlName(path.basename(openedPath)) && existsSync(edits.resolvedPath)
        ? edits.resolvedPath
        : sourcePath;

      viewerState.version++;
      viewerState.path = resultPath;
      sendJson(response, 200, {
        ok: true,
        path: resultPath,
        edits,
        folder: listFolderFiles(resultPath)
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // Run a fresh, isolated one-shot model edit against only the selected scene.
  if (requestUrl.pathname === '/regenerate-visual-scene') {
    try {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (activeJob) {
        sendJson(response, 409, { error: `A ${activeJob.type} job is already running.` });
        return;
      }

      const payload = await readJsonBody(request);
      const requestedPath = String(payload.file || '').trim();
      const instruction = String(payload.instruction || '').trim();
      if (!requestedPath) throw new Error('Missing file path.');
      if (!instruction) throw new Error('Describe the visual change to make.');
      if (instruction.length > 5000) throw new Error('Visual edit instruction is too long.');

      const openedPath = resolveInputPath(requestedPath);
      const sourcePath = sourceSiblingPathForLecture(openedPath);
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        throw new Error(`Source HTML does not exist: ${sourcePath}`);
      }

      const abortController = new AbortController();
      const visualJob = {
        type: 'visual edit',
        aborted: false,
        kill: () => {
          visualJob.aborted = true;
          abortController.abort();
        }
      };
      activeJob = visualJob;

      const edit = await runScopedVisualEdit(sourcePath, instruction, {
        model: payload.model,
        signal: abortController.signal
      });
      if (visualJob.aborted) throw new Error('Visual edit stopped.');

      const resolvedPath = resolvedSiblingPathForIndex(sourcePath);
      const previousResolved = existsSync(resolvedPath) ? readFileSync(resolvedPath, 'utf8') : null;
      writeFileSync(sourcePath, edit.modified, 'utf8');
      activeJob = null;

      try {
        syncResolvedVisualFromSource(sourcePath, edit.modified);
      } catch (error) {
        writeFileSync(sourcePath, edit.original, 'utf8');
        if (previousResolved !== null) writeFileSync(resolvedPath, previousResolved, 'utf8');
        throw error;
      }

      const resultPath = isResolvedHtmlName(path.basename(openedPath)) && existsSync(resolvedPath)
        ? resolvedPath
        : sourcePath;
      viewerState.version++;
      viewerState.path = resultPath;
      visualEditLog(
        `Saved ${path.basename(sourcePath)}${
          existsSync(resolvedPath) ? ` and synced ${path.basename(resolvedPath)}` : ''
        }`
      );
      sendJson(response, 200, {
        ok: true,
        path: resultPath,
        output: edit.output,
        folder: listFolderFiles(resultPath)
      });
    } catch (error) {
      visualEditLog(`Request failed: ${error.message}`);
      sendJson(response, 500, { error: error.message });
    } finally {
      if (activeJob?.type === 'visual edit') activeJob = null;
    }
    return;
  }

  // Resolve source index*.html files into resolved*.html timeline files.
  if (requestUrl.pathname === '/resolve-file') {
    try {
      const requestedPath = requestUrl.searchParams.get('file') || '';
      if (!requestedPath) throw new Error('Missing file path.');
      const resolvedPath = await resolveLectureFile(requestedPath, {
        ttsProvider: requestUrl.searchParams.get('ttsProvider'),
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
      const outputPath = await enqueueRenderJob((job) => renderLectureFile(requestedPath, {
        ttsProvider: requestUrl.searchParams.get('ttsProvider'),
        ttsVoice: requestUrl.searchParams.get('ttsVoice'),
        ttsSpeed: requestUrl.searchParams.get('ttsSpeed'),
        fps: requestUrl.searchParams.get('fps'),
        width: requestUrl.searchParams.get('width'),
        height: requestUrl.searchParams.get('height'),
        burnSubtitle: requestUrl.searchParams.has('burnSubtitle')
          ? requestUrl.searchParams.get('burnSubtitle') === '1'
          : appConfig.render.burnSubtitle,
        subtitleFont: requestUrl.searchParams.get('subtitleFont'),
        subtitleFontSize: requestUrl.searchParams.get('subtitleFontSize'),
        subtitleBottomPercent: requestUrl.searchParams.get('subtitleBottomPercent')
      }, job), requestedPath);

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
      if (hasRenderJobs()) {
        const count = killRenderJobs();
        sendJson(response, 200, { ok: true, stopped: true, type: 'render', count, message: `Stopped ${count} render job(s) successfully` });
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
      if (agentState.sessionId) {
        resetAgentApiSession(agentState.sessionId).catch(() => {});
      }
      agentState.log = '';
      agentState.currentWorkspace = '';
      agentState.sessionId = '';
      agentState.pendingNewSession = true;
      agentState.phase = 'generate';
      agentState.session = null;
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === '/agent-state') {
    const agentState = getAgentState(requestUrl.searchParams.get('agentClientId'));
    sendJson(response, 200, {
      ok: true,
      phase: agentState.phase,
      workspace: agentState.currentWorkspace || ''
    });
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
      const clientId = requestUrl.searchParams.get('agentClientId') || 'default';
      getAgentState(clientId);
      const files = await saveAgentUploads(request, clientId);
      sendJson(response, 200, { ok: true, files });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // Proxy compact generation choices from the lecture-agent API.
  if (requestUrl.pathname === '/agent-options') {
    try {
      await ensureAgentApiAvailable();
      const options = await getAgentOptions();
      const configuredTtsProvider = appConfig.tts.provider === '11labs'
        ? 'elevenlabs'
        : appConfig.tts.provider;
      const configuredTtsVoiceExists = options.tts.providers.some(provider =>
        provider.id === configuredTtsProvider
        && provider.voices.some(voice => voice.id === appConfig.tts.voice)
      );
      sendJson(response, 200, {
        ok: true,
        ...options,
        defaults: {
          ...options.defaults,
          themeId: appConfig.agent.defaultTheme || options.defaults.themeId,
          teachingStyleId: appConfig.agent.defaultTeachingStyle || options.defaults.teachingStyleId,
        },
        tts: {
          ...options.tts,
          defaults: configuredTtsVoiceExists
            ? { provider: configuredTtsProvider, voice: appConfig.tts.voice }
            : options.tts.defaults,
        },
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // The first request uses the deterministic LectureGen API. Once generation
  // succeeds, later requests use the tool-enabled agent in index-only editor mode.
  if (requestUrl.pathname === '/lecturegen/generate' || requestUrl.pathname === '/agent-chat') {
    try {
      const isGenerationRequest = requestUrl.pathname === '/lecturegen/generate';
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
            if (!agentState.currentWorkspace) {
              createNewSessionWorkspace(agentState.id);
            }
            agentState.pendingNewSession = false;
          }

          if (isGenerationRequest && agentState.phase !== 'generate') {
            sendJson(response, 409, { error: 'This chat already has a generated video. Start a New Chat to generate another one.' });
            return;
          }
          if (!isGenerationRequest && agentState.phase !== 'edit') {
            sendJson(response, 409, { error: 'Generate the video before sending edit requests.' });
            return;
          }

          let task = '';
          const agentWorkspace = agentWorkspaceRoot(agentState.id);
          if (currentFile) {
            const resolvedFile = resolveInputPath(currentFile);
            let displayPathForAgent = '';
            if (resolvedFile.startsWith(agentWorkspace)) {
              displayPathForAgent = path.relative(agentWorkspace, resolvedFile).replaceAll(path.sep, '/');
            } else {
              displayPathForAgent = path.relative(rootDir, resolvedFile).replaceAll(path.sep, '/');
            }
            task += `[Context: The user is currently viewing the file "${displayPathForAgent}" in the editor. Use this as the target file if they refer to "this file", "the script", "the code", or "the HTML".]\n\n`;
          }
          if (currentDir) {
            const resolvedDir = resolveInputPath(currentDir);
            let displayDirForAgent = '';
            if (resolvedDir.startsWith(agentWorkspace)) {
              displayDirForAgent = path.relative(agentWorkspace, resolvedDir).replaceAll(path.sep, '/') || '.';
            } else {
              displayDirForAgent = path.relative(rootDir, resolvedDir).replaceAll(path.sep, '/') || '.';
            }
            task += `[Context: The folder browser is currently in the directory "${displayDirForAgent}" of the repository.]\n\n`;
          }
          task += message;

          if (isGenerationRequest) {
            if (agentState.activeJob) {
              sendJson(response, 409, { error: 'A generation is already in progress for this session.' });
              return;
            }
            agentState.log = '';
            const abortController = new AbortController();
            let isAborted = false;
            const activeGenerationJob = {
              type: 'lecturegen',
              aborted: false,
              kill: () => {
                isAborted = true;
                activeGenerationJob.aborted = true;
                abortController.abort();
                if (agentState.activeJob === activeGenerationJob) agentState.activeJob = null;
                if (!response.writableEnded) {
                  sendJson(response, 200, {
                    ok: true,
                    stopped: true,
                    output: '',
                    mode: 'generate',
                    workspace: agentWorkspace
                  });
                }
              }
            };
            agentState.activeJob = activeGenerationJob;
            console.log(`Starting LectureGen via API in: ${agentWorkspace}`);

            (async () => {
              try {
                const parsed = parseIdeLectureGenRequest(task);
                const generationTtsVoice = normalizeTtsVoice(payload.ttsVoice);
                const generationTtsProvider = resolveTtsProvider(
                  { ttsProvider: payload.ttsProvider },
                  generationTtsVoice
                );
                await ensureAgentApiAvailable();
                const result = await generateLectureViaAgentApi({
                  request: parsed.request,
                  model: payload.model || process.env.AGENT_MODEL || 'gemini-3.5-flash',
                  scriptModel: payload.scriptModel || undefined,
                  animatorModel: payload.animatorModel || undefined,
                  ttsProvider: generationTtsProvider,
                  ttsVoice: generationTtsVoice,
                  ttsSpeed: parseFloat(normalizeTtsSpeed(payload.ttsSpeed)),
                  workspaceDir: agentWorkspace,
                  generationLength: parsed.generationLength,
                  aspectRatio: parsed.aspectRatio,
                  ...(payload.themeId ? { themeId: payload.themeId } : { theme: parsed.theme }),
                  ...(payload.teachingStyleId ? { teachingStyleId: payload.teachingStyleId } : { teachingStyle: parsed.teachingStyle }),
                  attachments: parsed.attachments,
                  outputs: {
                    video: parsed.includeVideo,
                    interactive: parsed.includeInteractive,
                    game: parsed.includeGame,
                  },
                  enableGetimg: parsed.enableGetimg,
                  tokenTrackerSessionId: agentState.sessionId || path.basename(agentWorkspace)
                }, {
                  signal: abortController.signal,
                  onLog: text => {
                    agentState.log += text;
                    process.stderr.write(text);
                  }
                });
                if (agentState.activeJob === activeGenerationJob) agentState.activeJob = null;
                if (isAborted) return;
                agentState.phase = 'edit';
                agentState.session = null;

                let workspaceDir = result.workspaceDir;
                let entryFile = result.entryFile;
                let htmlFiles = Array.isArray(result.htmlFiles) ? result.htmlFiles.slice() : result.htmlFiles;
                const renamed = renameSessionFolderAfterGeneration(agentState, result.workspaceDir);
                if (renamed) {
                  workspaceDir = renamed.newFolder;
                  entryFile = remapPathAfterFolderRename(entryFile, renamed.oldFolder, renamed.newFolder);
                  if (Array.isArray(htmlFiles)) {
                    htmlFiles = htmlFiles.map((filePath) => remapPathAfterFolderRename(filePath, renamed.oldFolder, renamed.newFolder));
                  }
                }

                viewerState.version++;
                viewerState.path = entryFile;
                if (!response.writableEnded) {
                  sendJson(response, 200, {
                    ok: true,
                    output: result.output.trim(),
                    mode: 'edit',
                    workspace: workspaceDir,
                    path: entryFile,
                    files: htmlFiles
                  });
                }
              } catch (err: any) {
                if (agentState.activeJob === activeGenerationJob) agentState.activeJob = null;
                if (isAborted) return;
                if (!response.writableEnded) {
                  sendJson(response, 500, { error: err.message || `LectureGen failed: ${err}` });
                }
              }
            })();
            return;
          }

          agentState.log = ''; // Reset log buffer for this turn

          let isAborted = false;
          const abortController = new AbortController();
          const activeAgentJob = {
            type: 'agent',
            aborted: false,
            kill: () => {
              isAborted = true;
              activeAgentJob.aborted = true;
              abortController.abort();
              if (agentState.activeJob === activeAgentJob) {
                agentState.activeJob = null;
              }
              if (!response.writableEnded) {
                sendJson(response, 200, {
                  ok: true,
                  stopped: true,
                  output: '',
                  workspace: agentWorkspaceRoot(agentState.id)
                });
              }
            }
          };
          agentState.activeJob = activeAgentJob;

          console.log(`Starting agent API edit in: ${agentWorkspaceRoot(agentState.id)}`);

          (async () => {
            try {
              await ensureAgentApiAvailable();
              const result = await editLectureViaAgentApi({
                request: task,
                workspaceDir: agentWorkspaceRoot(agentState.id),
                sessionId: agentState.sessionId || path.basename(agentWorkspaceRoot(agentState.id)),
                model: payload.model || process.env.AGENT_MODEL || "gemini-3.5-flash",
                tokenTrackerSessionId: agentState.sessionId || path.basename(agentWorkspaceRoot(agentState.id))
              }, {
                signal: abortController.signal,
                onLog: (text) => {
                  agentState.log += text;
                  process.stderr.write(text);
                }
              });
              if (agentState.activeJob === activeAgentJob) {
                agentState.activeJob = null;
              }
              if (isAborted) {
                return;
              }
              if (!response.writableEnded) {
                sendJson(response, 200, { ok: true, output: result.output.trim(), workspace: agentWorkspaceRoot(agentState.id) });
              }
            } catch (err: any) {
              if (agentState.activeJob === activeAgentJob) {
                agentState.activeJob = null;
              }
              if (isAborted) {
                return;
              }
              if (!response.writableEnded) {
                sendJson(response, 500, { error: err.message || `Agent execution failed: ${err}` });
              }
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

process.once('SIGINT', () => {
  stopManagedAgentApi();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stopManagedAgentApi();
  process.exit(143);
});

ensureAgentApiAvailable().then(() => {
  server.listen(args.port, args.host, () => {
    const encodedFile = args.openPath ? `?file=${encodeURIComponent(args.openPath)}` : '';
    const urls = getServerUrls(args.host, args.port);
    console.log(`IDE server running at:\n${urls.map((url) => `  ${url}`).join('\n')}`);
    if (args.host === '0.0.0.0') {
      console.warn('LAN access is enabled. Only use this on a trusted network; the IDE has no authentication.');
    }
    if (args.openBrowser) openBrowser(`${urls[0]}${encodedFile}`);
  });
}).catch(error => {
  console.error(error.message);
  stopManagedAgentApi();
  process.exit(1);
});
