import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createViewerHtml } from '../packages/lecture-viewer/src/index.mjs';

const rootDir = process.cwd();
const defaultPort = 4307;

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
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(rootDir, inputPath);
}

function normalizeOpenPath(inputPath) {
  const resolvedPath = resolveInputPath(inputPath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`File does not exist: ${inputPath}`);
  }
  return resolvedPath.replaceAll(path.sep, '/');
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
    "$dialog.Filter = 'HTML files (*.html)|*.html|All files (*.*)|*.*'",
    "$dialog.Title = 'Open render-friendly HTML'",
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
