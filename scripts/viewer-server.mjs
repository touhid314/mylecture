import { createReadStream, existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createViewerHtml } from '../packages/lecture-viewer/src/index.mjs';

const rootDir = process.cwd();
const defaultPort = 4307;

function estimateTextDuration(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2.5, words / 2.65);
}

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

function parseArgs(argv) {
  const args = {
    port: defaultPort,
    openPath: '',
    openBrowser: false,
    width: 1080,
    height: 1920
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

function printHelp() {
  console.log(`Usage:
  node scripts/viewer-server.mjs [options]

Options:
  --port <number>   Local server port. Default: ${defaultPort}
  --file <path>     HTML file to preselect in the viewer
  --width <pixels>  Preview viewport width. Default: 1080
  --height <pixels> Preview viewport height. Default: 1920
  --open            Open the viewer in the default browser
`);
}

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

function sendText(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
}

function sendJson(response, status, payload) {
  sendText(response, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function resolveInputPath(inputPath) {
  let cleaned = String(inputPath || '').trim();

  if (process.platform === 'win32') {
    cleaned = cleaned.replace(/^[\/\\]+([a-zA-Z]:)/, '$1');
  }

  const isAbs = path.isAbsolute(cleaned) || (process.platform === 'win32' && /^[a-zA-Z]:/.test(cleaned));
  return isAbs ? path.resolve(cleaned) : path.resolve(rootDir, cleaned);
}

function normalizeOpenPath(inputPath) {
  const resolvedPath = resolveInputPath(inputPath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`File does not exist: ${inputPath}`);
  }
  return resolvedPath.replaceAll(path.sep, '/');
}

function toViewerPath(filePath) {
  return path.resolve(filePath).replaceAll(path.sep, '/');
}

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

function defaultBrowserFolder() {
  const outputsPath = path.resolve(rootDir, 'outputs');
  if (existsSync(outputsPath) && statSync(outputsPath).isDirectory()) return outputsPath;
  return rootDir;
}

function resolveDirectoryPath(inputPath = '') {
  const resolvedPath = inputPath ? resolveInputPath(inputPath) : defaultBrowserFolder();
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
    throw new Error(`Folder does not exist: ${inputPath || 'outputs'}`);
  }
  return resolvedPath;
}

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

function folderForFile(filePath) {
  const resolvedPath = resolveInputPath(filePath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  return path.dirname(resolvedPath);
}

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

function siblingPath(filePath, name) {
  return path.join(path.dirname(resolveInputPath(filePath)), name);
}

function defaultOutputPath(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/^(?:index|resolved)(.*)\.html$/i);
  return siblingPath(filePath, `rendered${match?.[1] || ''}.mp4`);
}

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

  for (const file of files) {
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
      await runCapture('node', [
        'scripts/build-plan.mjs',
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

async function renderLectureFile(filePath, options = {}) {
  const inputPath = resolveInputPath(filePath);
  const basename = path.basename(inputPath);
  if (!isIndexHtmlName(basename) && !isResolvedHtmlName(basename)) {
    throw new Error('Render is only available for index*.html or resolved*.html files.');
  }

  const voice = normalizeTtsVoice(options.ttsVoice);
  const provider = detectProvider(voice);
  const outPath = defaultOutputPath(inputPath);
  const renderArgs = [
    'scripts/render-video.mjs',
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

  let childProc = null;
  activeJob = {
    type: 'render',
    outPath,
    inputPath,
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
    await runCapture('node', renderArgs, {
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

function resolveWorkspacePath(urlPath) {
  const rawPath = decodeURIComponent(urlPath.replace(/^\/files\/?/, ''));
  if (!rawPath) return rootDir;
  return resolveInputPath(rawPath);
}

function resolveViewerPackagePath(urlPath) {
  const rawPath = decodeURIComponent(urlPath.replace(/^\/lecture-viewer\/?/, ''));
  if (!rawPath) return null;
  const packageRoot = path.resolve(rootDir, 'packages', 'lecture-viewer', 'src');
  const resolvedPath = path.resolve(packageRoot, rawPath);
  if (!resolvedPath.startsWith(packageRoot + path.sep) && resolvedPath !== packageRoot) {
    return null;
  }
  return resolvedPath;
}

function serveFile(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const resolvedPath = resolveWorkspacePath(requestUrl.pathname);

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
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

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

const args = parseArgs(process.argv.slice(2));
let activeJob = null;
const viewerState = {
  version: 0,
  path: args.openPath,
  width: args.width,
  height: args.height
};

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

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, 'http://localhost');

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

  if (requestUrl.pathname === '/browse-folder') {
    try {
      const requestedPath = requestUrl.searchParams.get('dir') || '';
      sendJson(response, 200, listDirectory(requestedPath));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

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

  if (requestUrl.pathname === '/resolve-file') {
    try {
      const requestedPath = requestUrl.searchParams.get('file') || '';
      if (!requestedPath) throw new Error('Missing file path.');
      const resolvedPath = await resolveLectureFile(requestedPath, {
        ttsVoice: requestUrl.searchParams.get('ttsVoice'),
        ttsSpeed: requestUrl.searchParams.get('ttsSpeed')
      });

      viewerState.version++;
      viewerState.path = resolvedPath;

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

  if (requestUrl.pathname === '/stop-job') {
    try {
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

  if (requestUrl.pathname === '/pick') {
    try {
      const pickedPath = await pickHtmlFile();
      sendText(response, 200, JSON.stringify({ path: pickedPath }), 'application/json; charset=utf-8');
    } catch (error) {
      sendText(response, 500, JSON.stringify({ error: error.message }), 'application/json; charset=utf-8');
    }
    return;
  }

  if (requestUrl.pathname.startsWith('/files/')) {
    serveFile(request, response);
    return;
  }

  if (requestUrl.pathname.startsWith('/lecture-viewer/')) {
    serveViewerPackageFile(request, response);
    return;
  }

  sendText(response, 404, 'Not found');
});

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

server.listen(args.port, '127.0.0.1', () => {
  const encodedFile = args.openPath ? `?file=${encodeURIComponent(args.openPath)}` : '';
  const url = `http://127.0.0.1:${args.port}/${encodedFile}`;
  console.log(`Render HTML viewer running at ${url}`);
  if (args.openBrowser) openBrowser(url);
});
