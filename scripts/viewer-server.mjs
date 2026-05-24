import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const defaultPort = 4307;
const viewerVersion = '0.1';

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

function viewerHtml(openPath, initialWidth = 1080, initialHeight = 1920) {
  const normalizedOpenPath = openPath ? openPath.replaceAll('\\', '/') : '';
  const safeInitialWidth = Number.isInteger(initialWidth) && initialWidth > 0 ? initialWidth : 1080;
  const safeInitialHeight = Number.isInteger(initialHeight) && initialHeight > 0 ? initialHeight : 1920;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Render HTML Viewer</title>
<style>
:root {
  --bg: #050505;
  --panel: #111111;
  --panel-raised: #181818;
  --control: #202020;
  --control-hover: #2a2a2a;
  --control-active: #333333;
  --line: #2d2d2d;
  --line-strong: #3a3a3a;
  --text: #f2f2f2;
  --muted: #a3a3a3;
  --muted-strong: #c7c7c7;
  --accent: #f5f5f5;
  --focus: rgba(255,255,255,0.34);
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
}
body {
  display: grid;
  grid-template-rows: 1fr auto;
}
body.fullscreen-active {
  grid-template-rows: 1fr;
}
#frame-wrap {
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  background: #3a3a3a;
}
body.fullscreen-active #frame-wrap {
  padding: 0;
}
#preview-shell {
  position: relative;
  border: 1px solid var(--line-strong);
  background: #000;
  overflow: hidden;
  container-type: size;
  box-shadow: 0 22px 70px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.025);
}
body.fullscreen-active #preview-shell {
  border: 0;
  box-shadow: none;
}
#preview {
  border: 0;
  background: #000;
  transform-origin: 0 0;
}
#subtitle-overlay {
  position: absolute;
  left: 16%;
  right: 16%;
  bottom: clamp(12px, 3.5cqh, 38px);
  z-index: 2;
  display: none;
  color: #bde7ff;
  font-family: "Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(10px, 1.25cqw, 16px);
  font-weight: 520;
  line-height: 1.32;
  text-align: center;
  text-wrap: balance;
  text-shadow:
    0 1px 2px rgba(0,0,0,0.95),
    0 0 4px rgba(0,0,0,0.9);
  pointer-events: none;
}
#subtitle-overlay.visible {
  display: block;
}
#controls {
  display: grid;
  grid-template-columns: auto auto auto 1fr auto auto auto auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 94%, #fff 6%);
  box-shadow: 0 -16px 50px rgba(0,0,0,0.34);
}
body.fullscreen-active #controls {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  transform: translateY(calc(100% - 10px));
  opacity: 0;
  transition: transform 160ms ease, opacity 160ms ease;
}
body.fullscreen-active.controls-visible #controls,
body.fullscreen-active #controls:hover {
  transform: translateY(0);
  opacity: 1;
}
#file-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 8px;
}
#current-file {
  min-width: 0;
  height: 38px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #0b0b0b;
  color: var(--muted-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 18px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
input, button, select {
  font: inherit;
  color: var(--text);
  background: var(--control);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  outline: none;
}
button {
  min-height: 38px;
  padding: 9px 13px;
  cursor: pointer;
  font-weight: 520;
  letter-spacing: 0;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
button:hover {
  background: var(--control-hover);
  border-color: #4a4a4a;
}
button:active {
  background: var(--control-active);
  transform: translateY(1px);
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  border-color: #6a6a6a;
  box-shadow: 0 0 0 3px var(--focus);
}
#play {
  min-width: 74px;
  background: #ededed;
  border-color: #ededed;
  color: #050505;
}
#play:hover {
  background: #ffffff;
  border-color: #ffffff;
}
#load,
#reload,
#info,
#subtitles-toggle,
#live-tts-toggle,
#fullscreen {
  background: var(--panel-raised);
}
#subtitles-toggle.active,
#live-tts-toggle.active {
  background: #ededed;
  border-color: #ededed;
  color: #050505;
}
input[type="text"] {
  width: 100%;
  height: 38px;
  padding: 9px 11px;
  background: #0c0c0c;
}
select {
  height: 38px;
  padding: 0 34px 0 10px;
  color: var(--muted-strong);
  cursor: pointer;
}
#scrub-wrap {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
input[type="range"] {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  height: 22px;
  accent-color: var(--accent);
  cursor: pointer;
}
input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: #3a3a3a;
}
input[type="range"]::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  background: #f4f4f4;
  border: 1px solid #ffffff;
  box-shadow: 0 1px 8px rgba(0,0,0,0.55);
}
input[type="range"]::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: #3a3a3a;
}
input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f4f4f4;
  border: 1px solid #ffffff;
  box-shadow: 0 1px 8px rgba(0,0,0,0.55);
}
#interactive-marker,
#game-marker {
  flex: 0 0 auto;
  position: relative;
  width: 14px;
  height: 14px;
  border: 1px solid rgba(255,255,255,0.75);
  display: none;
  pointer-events: auto;
  cursor: pointer;
}
#interactive-marker {
  border-radius: 50%;
  background: #d6d6d6;
  box-shadow: 0 0 0 4px rgba(255,255,255,0.12);
}
#game-marker {
  border-radius: 5px;
  background: #8d8d8d;
  box-shadow: 0 0 0 4px rgba(255,255,255,0.1);
  transform: rotate(45deg);
}
#interactive-marker.visible {
  display: block;
}
#game-marker.visible {
  display: block;
}
#time {
  min-width: 128px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--muted-strong);
}
#status {
  color: var(--muted);
  white-space: nowrap;
  display: none;
}
#viewport {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  display: none;
}
#info-dialog {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: none;
  place-items: center;
  padding: 18px;
  background: rgba(0,0,0,0.58);
}
#info-dialog.visible {
  display: grid;
}
#info-panel {
  width: min(560px, 100%);
  max-height: min(720px, calc(100vh - 36px));
  overflow: auto;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: #101010;
  box-shadow: 0 22px 70px rgba(0,0,0,0.62);
}
#info-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
#info-title {
  font-weight: 650;
  color: var(--text);
}
#info-close {
  min-height: 32px;
  padding: 5px 10px;
}
#info-content {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
  padding: 16px;
}
#info-content dt {
  color: var(--muted);
}
#info-content dd {
  min-width: 0;
  margin: 0;
  color: var(--muted-strong);
  overflow-wrap: anywhere;
}
#info-branding {
  padding: 12px 16px 14px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}
#info-branding strong {
  color: var(--muted-strong);
  font-weight: 620;
}
</style>
</head>
<body>
<main id="frame-wrap">
  <div id="preview-shell">
    <iframe id="preview" title="Render preview"></iframe>
    <div id="subtitle-overlay" aria-live="polite"></div>
  </div>
</main>
<section id="controls">
  <div id="file-row">
    <div id="current-file">${escapeHtml(normalizedOpenPath || 'No file selected')}</div>
    <button id="info" type="button">Info</button>
    <button id="load">Load</button>
    <button id="reload">Reload</button>
  </div>
  <button id="play">Play</button>
  <button id="seek-back" title="Back 5 seconds">&#8592; 5s</button>
  <button id="seek-forward" title="Forward 5 seconds">5s &#8594;</button>
  <div id="scrub-wrap">
    <input id="scrub" type="range" min="0" max="1" step="0.001" value="0">
    <div id="interactive-marker" title="Interactive segment"></div>
    <div id="game-marker" title="Game segment"></div>
  </div>
  <div id="time">0.00 / 0.00</div>
  <button id="subtitles-toggle" type="button" aria-pressed="true">Subtitles</button>
  <button id="live-tts-toggle" type="button" aria-pressed="true">Live TTS</button>
  <select id="speed">
    <option value="0.5">0.5x</option>
    <option value="1" selected>1x</option>
    <option value="1.5">1.5x</option>
    <option value="2">2x</option>
  </select>
  <select id="viewport-preset" title="Preview viewport">
    <option value="1080x1920">9:16 1080x1920</option>
    <option value="1920x1080">16:9 1920x1080</option>
    <option value="custom">Custom</option>
  </select>
  <button id="fullscreen" type="button">Fullscreen</button>
  <div id="viewport">${safeInitialWidth}x${safeInitialHeight}</div>
  <div id="status">No file loaded</div>
</section>
<div id="info-dialog" role="dialog" aria-modal="true" aria-labelledby="info-title">
  <div id="info-panel">
    <div id="info-header">
      <div id="info-title">Video Info</div>
      <button id="info-close" type="button">Close</button>
    </div>
    <dl id="info-content"></dl>
    <div id="info-branding">
      Copyright 2026, <strong>mylecture.ai</strong>, Touhidul Islam.
    </div>
  </div>
</div>
<script>
const frameWrap = document.getElementById('frame-wrap');
const previewShell = document.getElementById('preview-shell');
const frame = document.getElementById('preview');
const controls = document.getElementById('controls');
const currentFileLabel = document.getElementById('current-file');
const infoButton = document.getElementById('info');
const infoDialog = document.getElementById('info-dialog');
const infoCloseButton = document.getElementById('info-close');
const infoContent = document.getElementById('info-content');
const loadButton = document.getElementById('load');
const reloadButton = document.getElementById('reload');
const playButton = document.getElementById('play');
const seekBackButton = document.getElementById('seek-back');
const seekForwardButton = document.getElementById('seek-forward');
const scrubber = document.getElementById('scrub');
const interactiveMarker = document.getElementById('interactive-marker');
const gameMarker = document.getElementById('game-marker');
const timeReadout = document.getElementById('time');
const subtitlesToggle = document.getElementById('subtitles-toggle');
const liveTtsToggle = document.getElementById('live-tts-toggle');
const subtitleOverlay = document.getElementById('subtitle-overlay');
const speedSelect = document.getElementById('speed');
const viewportPreset = document.getElementById('viewport-preset');
const fullscreenButton = document.getElementById('fullscreen');
const viewportText = document.getElementById('viewport');
const statusText = document.getElementById('status');
const VIEWER_VERSION = '${escapeJsString(viewerVersion)}';
let currentFilePath = '${escapeJsString(normalizedOpenPath)}';
let viewerCommandVersion = 0;
let videoMetadata = {};
let renderViewport = {
  width: ${safeInitialWidth},
  height: ${safeInitialHeight}
};
let userViewportOverride = false;

let playback = {
  loaded: false,
  playing: false,
  duration: 0,
  time: 0,
  startedAt: 0,
  startTime: 0,
  raf: 0,
  timeline: [],
  audioTimeline: [],
  subtitleTimeline: [],
  interactiveTimeline: [],
  gameTimeline: [],
  audio: null,
  audioCue: null,
  audioFailures: new Set(),
  speechSegmentKey: '',
  completed: false,
  interactiveActive: false,
  gameActive: false,
  subtitlesEnabled: true,
  liveTtsEnabled: true
};
let controlsHideTimer = 0;

function resizePreview() {
  const wrapRect = frameWrap.getBoundingClientRect();
  const margin = isFullscreenActive() ? 0 : 32;
  const availableWidth = Math.max(1, wrapRect.width - margin);
  const availableHeight = Math.max(1, wrapRect.height - margin);
  const scale = Math.min(availableWidth / renderViewport.width, availableHeight / renderViewport.height);

  previewShell.style.width = Math.floor(renderViewport.width * scale) + 'px';
  previewShell.style.height = Math.floor(renderViewport.height * scale) + 'px';
  frame.width = renderViewport.width;
  frame.height = renderViewport.height;
  frame.style.width = renderViewport.width + 'px';
  frame.style.height = renderViewport.height + 'px';
  frame.style.transform = 'scale(' + scale + ')';
  viewportText.textContent = renderViewport.width + 'x' + renderViewport.height + ' @ ' + scale.toFixed(3) + 'x';
  syncViewportPreset();
}

function syncViewportPreset() {
  const value = renderViewport.width + 'x' + renderViewport.height;
  const hasPreset = Array.from(viewportPreset.options).some(option => option.value === value);
  viewportPreset.value = hasPreset ? value : 'custom';
}

function setPreviewViewport(width, height, reload = false) {
  const nextWidth = Number(width);
  const nextHeight = Number(height);
  if (!Number.isInteger(nextWidth) || nextWidth <= 0 || !Number.isInteger(nextHeight) || nextHeight <= 0) return;
  if (renderViewport.width === nextWidth && renderViewport.height === nextHeight) return;

  renderViewport = { width: nextWidth, height: nextHeight };
  resizePreview();

  if (reload && currentFilePath) {
    loadFile(currentFilePath);
  } else if (playback.loaded) {
    renderAt(playback.time);
  }
}

function detectDocumentViewport(win) {
  const doc = win.document;
  const candidates = [
    doc.getElementById('frame'),
    doc.querySelector('.video-frame'),
    doc.getElementById('video-frame'),
    doc.getElementById('player-container')
  ].filter(Boolean);

  for (const el of candidates) {
    const style = win.getComputedStyle(el);
    const cssWidth = parseFloat(style.width);
    const cssHeight = parseFloat(style.height);
    if (Number.isFinite(cssWidth) && Number.isFinite(cssHeight) && cssWidth >= 320 && cssHeight >= 240) {
      const rounded = { width: Math.round(cssWidth), height: Math.round(cssHeight) };
      const ratio = rounded.width / rounded.height;
      if (ratio > 1.2 || ratio < 0.85) return rounded;
    }
  }

  const canvas = doc.querySelector('canvas[width][height]');
  if (canvas) {
    const width = Number(canvas.getAttribute('width'));
    const height = Number(canvas.getAttribute('height'));
    if (Number.isFinite(width) && Number.isFinite(height) && width >= 320 && height >= 240) {
      return { width, height };
    }
  }

  return null;
}

function viewportFromAspectRatio(aspectRatio) {
  const normalized = String(aspectRatio || '').trim();
  const presets = {
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 }
  };
  if (presets[normalized]) return presets[normalized];

  const match = normalized.match(/^(\\d+(?:\\.\\d+)?):(\\d+(?:\\.\\d+)?)$/);
  if (!match) return null;

  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return null;
  }

  const longEdge = 1920;
  if (widthRatio >= heightRatio) {
    return {
      width: longEdge,
      height: Math.round(longEdge * heightRatio / widthRatio)
    };
  }

  return {
    width: Math.round(longEdge * widthRatio / heightRatio),
    height: longEdge
  };
}

function detectMetadataViewport(win) {
  return viewportFromAspectRatio(win.__VIDEO_METADATA__?.aspectRatio);
}

function setStatus(message) {
  statusText.textContent = message;
}

function formatMetadataKey(key) {
  if (key === 'viewerVersion') return 'Viewer version';
  if (key === 'lastResolved') return 'Last rendered';
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, char => char.toUpperCase());
}

function formatMetadataValue(key, value) {
  if (key === 'lastResolved' && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
    }
  }

  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (value === undefined || value === null || value === '') return 'Not set';
  return String(value);
}

function renderInfoDialog() {
  infoContent.textContent = '';
  const rows = [
    ['viewerVersion', VIEWER_VERSION],
    ...Object.entries(videoMetadata || {})
  ];

  if (rows.length === 1) {
    rows.push(['metadata', 'No video metadata found']);
  }

  for (const [key, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = formatMetadataKey(key);
    const detail = document.createElement('dd');
    detail.textContent = formatMetadataValue(key, value);
    infoContent.append(term, detail);
  }
}

function openInfoDialog() {
  renderInfoDialog();
  infoDialog.classList.add('visible');
  infoCloseButton.focus();
}

function closeInfoDialog() {
  infoDialog.classList.remove('visible');
  infoButton.focus();
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement);
}

function showFullscreenControls() {
  if (!isFullscreenActive()) return;
  document.body.classList.add('controls-visible');
  clearTimeout(controlsHideTimer);
  controlsHideTimer = setTimeout(() => {
    document.body.classList.remove('controls-visible');
  }, 1200);
}

function hideFullscreenControls() {
  if (!isFullscreenActive()) return;
  document.body.classList.remove('controls-visible');
}

function updateFullscreenState() {
  const active = isFullscreenActive();
  document.body.classList.toggle('fullscreen-active', active);
  document.body.classList.remove('controls-visible');
  clearTimeout(controlsHideTimer);
  if (active && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  fullscreenButton.textContent = active ? 'Exit Fullscreen' : 'Fullscreen';
  resizePreview();
}

async function toggleFullscreen() {
  try {
    if (isFullscreenActive()) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    setStatus(error.message || 'Fullscreen failed');
  }
}

function formatTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes + ':' + secs.toFixed(2).padStart(5, '0');
}

function updateControls() {
  scrubber.max = String(playback.duration || 1);
  scrubber.value = String(playback.time || 0);
  timeReadout.textContent = formatTime(playback.time) + ' / ' + formatTime(playback.duration);
  playButton.textContent = playback.playing ? 'Pause' : 'Play';
  subtitlesToggle.classList.toggle('active', playback.subtitlesEnabled);
  subtitlesToggle.setAttribute('aria-pressed', playback.subtitlesEnabled ? 'true' : 'false');
  liveTtsToggle.classList.toggle('active', playback.liveTtsEnabled);
  liveTtsToggle.setAttribute('aria-pressed', playback.liveTtsEnabled ? 'true' : 'false');
  interactiveMarker.classList.toggle('visible', playback.interactiveTimeline.length > 0);
  gameMarker.classList.toggle('visible', playback.gameTimeline.length > 0);
}

function fileUrl(filePath) {
  const cleaned = filePath.trim().replaceAll('\\\\', '/').replace(/^\\/+/, '');
  return '/files/' + cleaned + '?export=1&viewer=1&t=' + Date.now();
}

function setCurrentFile(filePath) {
  const nextFilePath = String(filePath || '').replaceAll('\\\\', '/');
  if (nextFilePath !== currentFilePath) {
    userViewportOverride = false;
  }
  currentFilePath = nextFilePath;
  currentFileLabel.textContent = currentFilePath || 'No file selected';
  currentFileLabel.title = currentFilePath;
}

function estimateTextDuration(text) {
  const words = String(text || '').trim().split(/\\s+/).filter(Boolean).length;
  return Math.max(2.5, words / 2.65);
}

function normalizeSectionKind(kind) {
  if (kind === 'visual-only' || kind === 'visual') return 'visual-only';
  if (kind === 'narration+visual' || kind === 'narration') return 'narration+visual';
  if (kind === 'interactive') return 'interactive';
  if (kind === 'game') return 'game';
  return kind;
}

function buildPreviewTimeline(win) {
  if (win.__RESOLVED_TIMELINE__?.videoTimeline?.length) {
    return win.__RESOLVED_TIMELINE__.videoTimeline.map(cue => ({
      start: cue.start,
      end: cue.end,
      duration: cue.duration,
      item: cue.item
    }));
  }

  if (Array.isArray(win.__VIDEO_TIMELINE__) && win.__VIDEO_TIMELINE__.length) {
    return win.__VIDEO_TIMELINE__.map(cue => ({
      start: cue.start,
      end: cue.end,
      duration: cue.duration,
      item: cue.item || cue
    }));
  }

  const plan = Array.isArray(win.__VIDEO_PLAN__) ? win.__VIDEO_PLAN__ : [];
  let cursor = 0;
  return plan.filter(item => !['interactive', 'game'].includes(normalizeSectionKind(item?.kind))).map(item => {
    const duration = Number(item.resolvedDuration) ||
      Number(item.duration) ||
      estimateTextDuration(item.text);
    const cue = {
      start: cursor,
      end: cursor + duration,
      duration,
      item
    };
    cursor += duration;
    return cue;
  });
}

function buildInteractiveTimeline(win) {
  if (Array.isArray(win.__INTERACTIVE_TIMELINE__) && win.__INTERACTIVE_TIMELINE__.length) {
    return win.__INTERACTIVE_TIMELINE__;
  }

  if (Array.isArray(win.__RESOLVED_TIMELINE__?.interactiveTimeline) && win.__RESOLVED_TIMELINE__.interactiveTimeline.length) {
    return win.__RESOLVED_TIMELINE__.interactiveTimeline;
  }

  const plan = Array.isArray(win.__VIDEO_PLAN__) ? win.__VIDEO_PLAN__ : [];
  return plan
    .filter(item => normalizeSectionKind(item?.kind) === 'interactive')
    .map(item => ({ sectionId: item.id, item: { ...item, kind: 'interactive' } }));
}

function buildGameTimeline(win) {
  if (Array.isArray(win.__GAME_TIMELINE__) && win.__GAME_TIMELINE__.length) {
    return win.__GAME_TIMELINE__;
  }

  if (Array.isArray(win.__RESOLVED_TIMELINE__?.gameTimeline) && win.__RESOLVED_TIMELINE__.gameTimeline.length) {
    return win.__RESOLVED_TIMELINE__.gameTimeline;
  }

  const plan = Array.isArray(win.__VIDEO_PLAN__) ? win.__VIDEO_PLAN__ : [];
  return plan
    .filter(item => normalizeSectionKind(item?.kind) === 'game')
    .map(item => ({ sectionId: item.id, item: { ...item, kind: 'game' } }));
}

function buildAudioTimeline(win, videoTimeline) {
  if (Array.isArray(win.__AUDIO_TIMELINE__) && win.__AUDIO_TIMELINE__.length) {
    return win.__AUDIO_TIMELINE__.map(cue => {
      const videoCue = videoTimeline.find(candidate => candidate.item?.id === cue.sectionId);
      return {
        ...cue,
        text: cue.text || videoCue?.item?.text || ''
      };
    });
  }

  if (Array.isArray(win.__RESOLVED_TIMELINE__?.audioTimeline) && win.__RESOLVED_TIMELINE__.audioTimeline.length) {
    return win.__RESOLVED_TIMELINE__.audioTimeline.map(cue => {
      const videoCue = videoTimeline.find(candidate => candidate.item?.id === cue.sectionId);
      return {
        ...cue,
        text: cue.text || videoCue?.item?.text || ''
      };
    });
  }

  return videoTimeline
    .filter(cue => cue.item?.audio)
    .map(cue => ({
      start: cue.start,
      duration: cue.duration,
      src: cue.item.audio,
      text: cue.item.text || '',
      sectionId: cue.item.id
    }));
}

function buildSubtitleTimeline(audioTimeline, videoTimeline) {
  const audioSubtitleCues = audioTimeline
    .filter(cue => String(cue.text || '').trim())
    .map(cue => ({
      start: Number(cue.start) || 0,
      end: (Number(cue.start) || 0) + (Number(cue.duration) || 0),
      text: String(cue.text || '').trim(),
      sectionId: cue.sectionId || ''
    }))
    .filter(cue => cue.end > cue.start);

  const audioSectionIds = new Set(audioSubtitleCues.map(cue => cue.sectionId).filter(Boolean));
  const videoSubtitleCues = videoTimeline
    .filter(cue => String(cue.item?.text || '').trim())
    .filter(cue => !audioSectionIds.has(cue.item?.id))
    .map(cue => ({
      start: Number(cue.start) || 0,
      end: Number(cue.end) || ((Number(cue.start) || 0) + (Number(cue.duration) || 0)),
      text: String(cue.item.text || '').trim(),
      sectionId: cue.item.id || ''
    }))
    .filter(cue => cue.end > cue.start);

  return [...audioSubtitleCues, ...videoSubtitleCues].sort((a, b) => a.start - b.start);
}

function updateSubtitleOverlay() {
  if (!playback.subtitlesEnabled || playback.interactiveActive || playback.gameActive) {
    subtitleOverlay.textContent = '';
    subtitleOverlay.classList.remove('visible');
    return;
  }

  const activeSubtitle = playback.subtitleTimeline.find(cue =>
    playback.time >= cue.start && playback.time < cue.end
  );
  const text = activeSubtitle?.text || '';
  subtitleOverlay.textContent = text;
  subtitleOverlay.classList.toggle('visible', Boolean(text));
}

function audioUrl(src) {
  return new URL(src, frame.contentWindow.location.href).href;
}

function stopAudio() {
  if (!playback.audio) return;
  playback.audio.pause();
  playback.audio = null;
  playback.audioCue = null;
}

function stopLiveTts() {
  playback.speechSegmentKey = '';
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function activeVideoCue() {
  let cue = null;
  for (const candidate of playback.timeline) {
    if (candidate.start <= playback.time && playback.time < candidate.end) cue = candidate;
    if (candidate.start > playback.time) break;
  }
  return cue;
}

function activeAudioCue() {
  return playback.audioTimeline.find(candidate =>
    playback.time >= candidate.start &&
    playback.time < candidate.start + candidate.duration &&
    !playback.audioFailures.has(audioCueKey(candidate))
  );
}

function audioCueKey(cue) {
  return cue?.sectionId || cue?.src || String(cue?.start || '');
}

function syncLiveTts() {
  if (!playback.playing || !playback.liveTtsEnabled || !('speechSynthesis' in window)) {
    stopLiveTts();
    return;
  }

  const cue = activeVideoCue();
  const text = String(cue?.item?.text || '').trim();
  if (!cue || !text || playback.interactiveActive || playback.gameActive) {
    stopLiveTts();
    return;
  }

  const key = cue.item?.id || String(cue.start);
  if (playback.speechSegmentKey === key) return;

  stopLiveTts();
  playback.speechSegmentKey = key;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = selectLiveTtsVoice();
  utterance.lang = 'en-GB';
  if (voice) utterance.voice = voice;
  utterance.rate = Math.max(0.5, Math.min(2, Number(speedSelect.value) || 1));
  utterance.onerror = () => {
    if (playback.speechSegmentKey === key) playback.speechSegmentKey = '';
    setStatus('Live TTS unavailable in this browser');
  };
  window.speechSynthesis.speak(utterance);
}

function selectLiveTtsVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const enGbVoices = voices.filter(voice => String(voice.lang || '').toLowerCase().startsWith('en-gb'));
  return enGbVoices.find(voice => /female|woman|zira|susan|serena|sonia|hazel|libby/i.test(voice.name)) ||
    enGbVoices[0] ||
    voices.find(voice => /female|woman|zira|susan|serena|sonia|hazel|libby/i.test(voice.name)) ||
    null;
}

function syncAudio() {
  if (!playback.playing) return;

  const cue = activeAudioCue();

  if (!cue) {
    stopAudio();
    syncLiveTts();
    return;
  }

  stopLiveTts();
  const offset = playback.time - cue.start;
  if (playback.audioCue !== cue) {
    stopAudio();
    playback.audioCue = cue;
    playback.audio = new Audio(audioUrl(cue.src));
    playback.audio.addEventListener('error', () => {
      playback.audioFailures.add(audioCueKey(cue));
      stopAudio();
      syncLiveTts();
    }, { once: true });
    playback.audio.playbackRate = Number(speedSelect.value) || 1;
    playback.audio.currentTime = Math.max(0, offset);
    playback.audio.play().catch(() => setStatus('Audio blocked until play is clicked again'));
    return;
  }

  playback.audio.playbackRate = Number(speedSelect.value) || 1;
  if (Math.abs(playback.audio.currentTime - offset) > 0.22) {
    playback.audio.currentTime = Math.max(0, offset);
  }
  if (playback.audio.paused) {
    playback.audio.play().catch(() => setStatus('Audio blocked until play is clicked again'));
  }
}

function renderAt(time) {
  if (!playback.loaded) return;
  const win = frame.contentWindow;
  const activeTime = Math.max(0, Math.min(Number(time) || 0, playback.duration));
  playback.time = activeTime;
  if (activeTime < playback.duration) {
    if (playback.interactiveActive) stopInteractiveSection();
    if (playback.gameActive) stopGameSection();
  }

  if (typeof win.renderAt === 'function') {
    win.renderAt(activeTime);
  } else {
    let cue = playback.timeline[0];
    for (const candidate of playback.timeline) {
      if (candidate.start <= activeTime) cue = candidate;
      if (candidate.start > activeTime) break;
    }
    const renderSection = win.__RENDER_SECTION__ || win.__HTML_RENDER_SECTION__ || win.__AI_RENDER_SECTION__;
    if (cue && typeof renderSection === 'function') {
      renderSection(cue.item, activeTime - cue.start, activeTime);
    }
  }

  updateControls();
  updateSubtitleOverlay();
  syncAudio();
}

function stopInteractiveSection() {
  const win = frame.contentWindow;
  playback.interactiveActive = false;
  if (typeof win.__STOP_INTERACTIVE__ === 'function') {
    win.__STOP_INTERACTIVE__();
  } else if (typeof win.__RENDER_SECTION__ === 'function' && playback.timeline[0]) {
    win.__RENDER_SECTION__(playback.timeline[0].item, 0, 0);
  }
}

function stopGameSection() {
  const win = frame.contentWindow;
  playback.gameActive = false;
  if (typeof win.__STOP_GAME__ === 'function') {
    win.__STOP_GAME__();
  } else if (typeof win.__RENDER_SECTION__ === 'function' && playback.timeline[0]) {
    win.__RENDER_SECTION__(playback.timeline[0].item, 0, 0);
  }
}

function tick(now) {
  if (!playback.playing) return;
  const speed = Number(speedSelect.value) || 1;
  const nextTime = playback.startTime + ((now - playback.startedAt) / 1000) * speed;
  renderAt(nextTime);

  if (playback.time >= playback.duration) {
    playback.playing = false;
    playback.completed = true;
    startInteractiveSection();
    updateControls();
    return;
  }

  playback.raf = requestAnimationFrame(tick);
}

function play() {
  if (!playback.loaded) return;
  if (playback.time >= playback.duration) {
    playback.completed = false;
    renderAt(0);
  }
  playback.playing = true;
  playback.startedAt = performance.now();
  playback.startTime = playback.time;
  updateControls();
  syncAudio();
  playback.raf = requestAnimationFrame(tick);
}

function pause() {
  playback.playing = false;
  cancelAnimationFrame(playback.raf);
  stopAudio();
  stopLiveTts();
  updateControls();
}

function startInteractiveSection() {
  const win = frame.contentWindow;
  const interactive = playback.interactiveTimeline[0]?.item || null;
  if (playback.gameActive) stopGameSection();
  if (interactive && typeof win.__START_INTERACTIVE__ === 'function') {
    playback.interactiveActive = true;
    stopLiveTts();
    updateSubtitleOverlay();
    win.__START_INTERACTIVE__(interactive);
    setStatus('Interactive: ' + (interactive.title || interactive.id || 'ready'));
    return;
  }
  if (typeof win.__ON_VIEWER_COMPLETE__ === 'function') {
    playback.interactiveActive = true;
    stopLiveTts();
    updateSubtitleOverlay();
    win.__ON_VIEWER_COMPLETE__(interactive);
    setStatus('Interactive ready');
  }
}

function startGameSection() {
  const win = frame.contentWindow;
  const game = playback.gameTimeline[0]?.item || null;
  if (playback.interactiveActive) stopInteractiveSection();
  if (game && typeof win.__START_GAME__ === 'function') {
    playback.gameActive = true;
    stopLiveTts();
    updateSubtitleOverlay();
    win.__START_GAME__(game);
    setStatus('Game: ' + (game.title || game.id || 'ready'));
  }
}

function togglePlay() {
  if (playback.playing) pause();
  else play();
}

function seekTo(time, resume = playback.playing) {
  const shouldResume = Boolean(resume && playback.loaded);
  playback.playing = false;
  cancelAnimationFrame(playback.raf);
  stopAudio();
  stopLiveTts();

  renderAt(time);
  playback.completed = playback.time >= playback.duration;

  if (shouldResume) {
    playback.playing = true;
    playback.startedAt = performance.now();
    playback.startTime = playback.time;
    updateControls();
    syncAudio();
    playback.raf = requestAnimationFrame(tick);
  }
}

function seekBy(deltaSeconds) {
  if (!playback.loaded) return;
  seekTo(playback.time + deltaSeconds);
}

function seekToInteractive() {
  if (!playback.loaded || playback.interactiveTimeline.length === 0) return;
  pause();
  renderAt(playback.duration);
  playback.completed = true;
  startInteractiveSection();
  updateControls();
}

function seekToGame() {
  if (!playback.loaded || playback.gameTimeline.length === 0) return;
  pause();
  renderAt(playback.duration);
  playback.completed = true;
  startGameSection();
  updateControls();
}

async function loadFile(filePath = currentFilePath) {
  if (!filePath) {
    setStatus('Select an HTML file first');
    return;
  }
  pause();
  setCurrentFile(filePath);
  playback.loaded = false;
  playback.completed = false;
  playback.interactiveActive = false;
  playback.gameActive = false;
  playback.duration = 0;
  playback.time = 0;
  videoMetadata = {};
  playback.timeline = [];
  playback.audioTimeline = [];
  playback.audioFailures = new Set();
  playback.subtitleTimeline = [];
  playback.interactiveTimeline = [];
  playback.gameTimeline = [];
  stopAudio();
  stopLiveTts();
  updateSubtitleOverlay();
  updateControls();
  setStatus('Loading...');

  frame.src = fileUrl(currentFilePath);
}

async function pickAndLoadFile() {
  pause();
  setStatus('Opening file picker...');
  try {
    const response = await fetch('/pick');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'File picker failed');
    if (!payload.path) {
      setStatus('File picker cancelled');
      return;
    }
    await loadFile(payload.path);
  } catch (error) {
    setStatus(error.message);
  }
}

async function pollViewerCommands() {
  try {
    const response = await fetch('/viewer-state?since=' + viewerCommandVersion, { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.changed) return;

    viewerCommandVersion = Number(payload.version) || viewerCommandVersion;
    if (Number.isInteger(payload.width) && Number.isInteger(payload.height)) {
      setPreviewViewport(payload.width, payload.height);
    }
    if (payload.path && payload.path !== currentFilePath) {
      await loadFile(payload.path);
    }
  } catch {
    // The viewer can keep running even if a transient poll fails.
  }
}

function seekFromPointer(event) {
  if (!playback.loaded) return;
  const rect = scrubber.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  seekTo(ratio * playback.duration);
}

function handleViewerShortcut(event) {
  const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
  const target = event.target;
  const isTextInput = target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;

  if (event.ctrlKey && isSpace) {
    event.preventDefault();
    event.stopPropagation();
    togglePlay();
  } else if (isTextInput) {
    return;
  } else if (isSpace) {
    event.preventDefault();
    event.stopPropagation();
  } else if (event.ctrlKey && event.key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    seekBy(5);
  } else if (event.ctrlKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    seekBy(-5);
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    event.stopPropagation();
    toggleFullscreen();
  }
}

frame.addEventListener('load', () => {
  try {
    const win = frame.contentWindow;
    win.addEventListener('keydown', handleViewerShortcut, true);
    videoMetadata = win.__VIDEO_METADATA__ && typeof win.__VIDEO_METADATA__ === 'object'
      ? { ...win.__VIDEO_METADATA__ }
      : {};
    const detectedViewport = userViewportOverride
      ? null
      : (detectMetadataViewport(win) || detectDocumentViewport(win));
    if (detectedViewport) {
      setPreviewViewport(detectedViewport.width, detectedViewport.height);
    }

    playback.timeline = buildPreviewTimeline(win);
    playback.audioTimeline = buildAudioTimeline(win, playback.timeline);
    playback.subtitleTimeline = buildSubtitleTimeline(playback.audioTimeline, playback.timeline);
    playback.interactiveTimeline = buildInteractiveTimeline(win);
    playback.gameTimeline = buildGameTimeline(win);
    playback.duration = Number(win.__VIDEO_DURATION__) ||
      Number(win.__RESOLVED_TIMELINE__?.duration) ||
      (playback.timeline.at(-1)?.end || 0);

    if (!playback.timeline.length || !Number.isFinite(playback.duration) || playback.duration <= 0) {
      setStatus('No render timeline found');
      return;
    }

    playback.loaded = true;
    renderAt(0);
    setStatus(win.renderAt ? 'Resolved timeline loaded' : 'Preview timeline estimated');
  } catch (error) {
    setStatus(error.message);
  }
});

loadButton.addEventListener('click', pickAndLoadFile);
infoButton.addEventListener('click', openInfoDialog);
infoCloseButton.addEventListener('click', closeInfoDialog);
infoDialog.addEventListener('click', event => {
  if (event.target === infoDialog) closeInfoDialog();
});
reloadButton.addEventListener('click', () => loadFile());
playButton.addEventListener('click', togglePlay);
seekBackButton.addEventListener('click', () => seekBy(-5));
seekForwardButton.addEventListener('click', () => seekBy(5));
subtitlesToggle.addEventListener('click', () => {
  playback.subtitlesEnabled = !playback.subtitlesEnabled;
  updateControls();
  updateSubtitleOverlay();
});
liveTtsToggle.addEventListener('click', () => {
  playback.liveTtsEnabled = !playback.liveTtsEnabled;
  if (!playback.liveTtsEnabled) {
    stopLiveTts();
  } else if (!('speechSynthesis' in window)) {
    playback.liveTtsEnabled = false;
    setStatus('Live TTS unavailable in this browser');
  } else {
    syncAudio();
  }
  updateControls();
});
scrubber.addEventListener('input', event => {
  seekTo(Number(event.target.value));
});
scrubber.addEventListener('pointerdown', seekFromPointer);
scrubber.addEventListener('click', seekFromPointer);
interactiveMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  seekToInteractive();
});
interactiveMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  seekToInteractive();
});
gameMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  seekToGame();
});
gameMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  seekToGame();
});
speedSelect.addEventListener('change', () => {
  if (playback.speechSegmentKey) {
    const currentTime = playback.time;
    stopLiveTts();
    if (playback.playing) {
      renderAt(currentTime);
    }
  }
});
viewportPreset.addEventListener('change', event => {
  const value = event.target.value;
  if (value === 'custom') return;
  const [width, height] = value.split('x').map(Number);
  userViewportOverride = true;
  setPreviewViewport(width, height, true);
});
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenState);
document.addEventListener('mousemove', event => {
  if (!isFullscreenActive()) return;
  if (event.clientY >= window.innerHeight - 92) {
    showFullscreenControls();
  } else {
    hideFullscreenControls();
  }
});
document.addEventListener('keydown', handleViewerShortcut, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && infoDialog.classList.contains('visible')) {
    event.preventDefault();
    closeInfoDialog();
  }
});
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
}
window.addEventListener('resize', resizePreview);

setCurrentFile(currentFilePath);
resizePreview();
if (currentFilePath) loadFile();
setInterval(pollViewerCommands, 750);
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeJsString(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n');
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
      viewerHtml(openPath, width, height),
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
