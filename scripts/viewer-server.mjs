import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

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

function resolveWorkspacePath(urlPath) {
  const rawPath = decodeURIComponent(urlPath.replace(/^\/files\/?/, ''));
  const resolvedPath = path.resolve(rootDir, rawPath || '.');
  if (resolvedPath !== rootDir && !resolvedPath.startsWith(rootDir + path.sep)) {
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
  if (resolvedPath !== rootDir && !resolvedPath.startsWith(rootDir + path.sep)) {
    throw new Error('Selected file must be inside this repo workspace.');
  }
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error('Selected file does not exist.');
  }

  return path.relative(rootDir, resolvedPath).replaceAll(path.sep, '/');
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
* { box-sizing: border-box; }
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #101317;
  color: #e5e7eb;
  font-family: Arial, Helvetica, sans-serif;
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
  padding: 16px;
  background:
    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(0deg, rgba(255,255,255,0.04) 1px, transparent 1px),
    #101317;
  background-size: 32px 32px;
}
body.fullscreen-active #frame-wrap {
  padding: 0;
}
#preview-shell {
  border: 1px solid rgba(255,255,255,0.16);
  background: #000;
  overflow: hidden;
}
body.fullscreen-active #preview-shell {
  border: 0;
}
#preview {
  border: 0;
  background: #000;
  transform-origin: 0 0;
}
#controls {
  display: grid;
  grid-template-columns: auto auto auto 1fr auto auto auto auto auto auto auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.12);
  background: #181d24;
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
  grid-template-columns: 1fr auto auto;
  gap: 10px;
}
#current-file {
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  background: #111820;
  color: #cbd5e1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
input, button, select {
  font: inherit;
  color: #e5e7eb;
  background: #242b35;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 6px;
}
button {
  padding: 9px 13px;
  cursor: pointer;
}
button:hover { background: #2d3541; }
input[type="text"] {
  width: 100%;
  padding: 9px 11px;
}
#seek-time {
  width: 108px;
  padding: 9px 11px;
  font-variant-numeric: tabular-nums;
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
  cursor: pointer;
}
#interactive-marker,
#game-marker {
  flex: 0 0 auto;
  position: relative;
  width: 18px;
  height: 18px;
  border: 2px solid #04110d;
  display: none;
  pointer-events: auto;
  cursor: pointer;
}
#interactive-marker {
  border-radius: 50%;
  background: #facc15;
  box-shadow: 0 0 16px rgba(250,204,21,0.9);
}
#game-marker {
  border-radius: 5px;
  background: #22c55e;
  box-shadow: 0 0 16px rgba(34,197,94,0.9);
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
  color: #cbd5e1;
}
#status {
  color: #94a3b8;
  white-space: nowrap;
  display: none;
}
#viewport {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  display: none;
}
</style>
</head>
<body>
<main id="frame-wrap">
  <div id="preview-shell">
    <iframe id="preview" title="Render preview"></iframe>
  </div>
</main>
<section id="controls">
  <div id="file-row">
    <div id="current-file">${escapeHtml(normalizedOpenPath || 'No file selected')}</div>
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
  <input id="seek-time" type="text" placeholder="1:23.5">
  <button id="seek-go">Go</button>
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
<script>
const frameWrap = document.getElementById('frame-wrap');
const previewShell = document.getElementById('preview-shell');
const frame = document.getElementById('preview');
const controls = document.getElementById('controls');
const currentFileLabel = document.getElementById('current-file');
const loadButton = document.getElementById('load');
const reloadButton = document.getElementById('reload');
const playButton = document.getElementById('play');
const seekBackButton = document.getElementById('seek-back');
const seekForwardButton = document.getElementById('seek-forward');
const scrubber = document.getElementById('scrub');
const interactiveMarker = document.getElementById('interactive-marker');
const gameMarker = document.getElementById('game-marker');
const timeReadout = document.getElementById('time');
const seekTimeInput = document.getElementById('seek-time');
const seekGoButton = document.getElementById('seek-go');
const speedSelect = document.getElementById('speed');
const viewportPreset = document.getElementById('viewport-preset');
const fullscreenButton = document.getElementById('fullscreen');
const viewportText = document.getElementById('viewport');
const statusText = document.getElementById('status');
let currentFilePath = '${escapeJsString(normalizedOpenPath)}';
let renderViewport = {
  width: ${safeInitialWidth},
  height: ${safeInitialHeight}
};

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
  interactiveTimeline: [],
  gameTimeline: [],
  audio: null,
  audioCue: null,
  completed: false,
  interactiveActive: false,
  gameActive: false
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

function setStatus(message) {
  statusText.textContent = message;
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
  if (document.activeElement !== seekTimeInput) {
    seekTimeInput.value = playback.loaded ? formatTime(playback.time) : '';
  }
  playButton.textContent = playback.playing ? 'Pause' : 'Play';
  interactiveMarker.classList.toggle('visible', playback.interactiveTimeline.length > 0);
  gameMarker.classList.toggle('visible', playback.gameTimeline.length > 0);
}

function parseTime(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;
  const parts = text.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function fileUrl(filePath) {
  const cleaned = filePath.trim().replaceAll('\\\\', '/').replace(/^\\/+/, '');
  return '/files/' + cleaned + '?export=1&viewer=1&t=' + Date.now();
}

function setCurrentFile(filePath) {
  currentFilePath = String(filePath || '').replaceAll('\\\\', '/');
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
    return win.__AUDIO_TIMELINE__;
  }

  if (Array.isArray(win.__RESOLVED_TIMELINE__?.audioTimeline) && win.__RESOLVED_TIMELINE__.audioTimeline.length) {
    return win.__RESOLVED_TIMELINE__.audioTimeline;
  }

  return videoTimeline
    .filter(cue => cue.item?.audio)
    .map(cue => ({
      start: cue.start,
      duration: cue.duration,
      src: cue.item.audio,
      sectionId: cue.item.id
    }));
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

function syncAudio() {
  if (!playback.playing) return;

  const cue = playback.audioTimeline.find(candidate =>
    playback.time >= candidate.start && playback.time < candidate.start + candidate.duration
  );

  if (!cue) {
    stopAudio();
    return;
  }

  const offset = playback.time - cue.start;
  if (playback.audioCue !== cue) {
    stopAudio();
    playback.audioCue = cue;
    playback.audio = new Audio(audioUrl(cue.src));
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
  updateControls();
}

function startInteractiveSection() {
  const win = frame.contentWindow;
  const interactive = playback.interactiveTimeline[0]?.item || null;
  if (playback.gameActive) stopGameSection();
  if (interactive && typeof win.__START_INTERACTIVE__ === 'function') {
    playback.interactiveActive = true;
    win.__START_INTERACTIVE__(interactive);
    setStatus('Interactive: ' + (interactive.title || interactive.id || 'ready'));
    return;
  }
  if (typeof win.__ON_VIEWER_COMPLETE__ === 'function') {
    playback.interactiveActive = true;
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
  if (!shouldResume) stopAudio();

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
  playback.timeline = [];
  playback.audioTimeline = [];
  playback.interactiveTimeline = [];
  playback.gameTimeline = [];
  stopAudio();
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

function seekToInput() {
  const target = parseTime(seekTimeInput.value);
  if (!Number.isFinite(target)) {
    setStatus('Enter time as seconds, mm:ss, or hh:mm:ss');
    return;
  }
  seekTo(target);
}

function seekFromPointer(event) {
  if (!playback.loaded) return;
  const rect = scrubber.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  seekTo(ratio * playback.duration);
}

frame.addEventListener('load', () => {
  try {
    const win = frame.contentWindow;
    const detectedViewport = detectDocumentViewport(win);
    if (detectedViewport) {
      setPreviewViewport(detectedViewport.width, detectedViewport.height);
    }

    playback.timeline = buildPreviewTimeline(win);
    playback.audioTimeline = buildAudioTimeline(win, playback.timeline);
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
reloadButton.addEventListener('click', () => loadFile());
playButton.addEventListener('click', togglePlay);
seekBackButton.addEventListener('click', () => seekBy(-5));
seekForwardButton.addEventListener('click', () => seekBy(5));
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
seekGoButton.addEventListener('click', seekToInput);
seekTimeInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') seekToInput();
});
viewportPreset.addEventListener('change', event => {
  const value = event.target.value;
  if (value === 'custom') return;
  const [width, height] = value.split('x').map(Number);
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
document.addEventListener('keydown', event => {
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  } else if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    toggleFullscreen();
  }
});
window.addEventListener('resize', resizePreview);

setCurrentFile(currentFilePath);
resizePreview();
if (currentFilePath) loadFile();
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
const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, 'http://localhost');

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/viewer') {
    const width = Number(requestUrl.searchParams.get('width')) || args.width;
    const height = Number(requestUrl.searchParams.get('height')) || args.height;
    sendText(
      response,
      200,
      viewerHtml(requestUrl.searchParams.get('file') || args.openPath, width, height),
      'text/html; charset=utf-8'
    );
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

server.listen(args.port, '127.0.0.1', () => {
  const encodedFile = args.openPath ? `?file=${encodeURIComponent(args.openPath)}` : '';
  const url = `http://127.0.0.1:${args.port}/${encodedFile}`;
  console.log(`Render HTML viewer running at ${url}`);
  if (args.openBrowser) openBrowser(url);
});
