const viewerVersion = '0.1';

export function createViewerHtml(openPath, initialWidth = 1080, initialHeight = 1920) {
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
<script type="module">
import { createLecturePlayer, lectureViewerVersion } from '/lecture-viewer/player/index.mjs';

const frameWrap = document.getElementById('frame-wrap');
const previewShell = document.getElementById('preview-shell');
const frame = document.getElementById('preview');
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
const VIEWER_VERSION = lectureViewerVersion;
let currentFilePath = '${escapeJsString(normalizedOpenPath)}';
let viewerCommandVersion = 0;
let videoMetadata = {};
let renderViewport = {
  width: ${safeInitialWidth},
  height: ${safeInitialHeight}
};
let userViewportOverride = false;
let controlsHideTimer = 0;
let lastPlayerState = null;

const player = createLecturePlayer({
  iframe: frame,
  subtitleElement: subtitleOverlay,
  resolveSrc: fileUrl,
  subtitlesEnabled: true,
  liveTtsEnabled: true,
  onStatus: setStatus
});

function playerState() {
  return lastPlayerState || player.snapshot();
}

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
    return;
  }

  const state = playerState();
  if (state.loaded) player.seek(state.time, { resume: state.playing });
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

  if (rows.length === 1) rows.push(['metadata', 'No video metadata found']);

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
    if (isFullscreenActive()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
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

function updateControls(state = playerState()) {
  lastPlayerState = state;
  scrubber.max = String(state.duration || 1);
  scrubber.value = String(state.time || 0);
  timeReadout.textContent = formatTime(state.time) + ' / ' + formatTime(state.duration);
  playButton.textContent = state.playing ? 'Pause' : 'Play';
  subtitlesToggle.classList.toggle('active', state.subtitlesEnabled);
  subtitlesToggle.setAttribute('aria-pressed', state.subtitlesEnabled ? 'true' : 'false');
  liveTtsToggle.classList.toggle('active', state.liveTtsEnabled);
  liveTtsToggle.setAttribute('aria-pressed', state.liveTtsEnabled ? 'true' : 'false');
  interactiveMarker.classList.toggle('visible', state.interactiveTimeline.length > 0);
  gameMarker.classList.toggle('visible', state.gameTimeline.length > 0);
}

function fileUrl(filePath) {
  const cleaned = filePath.trim().replaceAll('\\\\', '/').replace(/^\\/+/, '');
  return '/files/' + cleaned + '?export=1&viewer=1&t=' + Date.now();
}

function setCurrentFile(filePath) {
  const nextFilePath = String(filePath || '').replaceAll('\\\\', '/');
  if (nextFilePath !== currentFilePath) userViewportOverride = false;
  currentFilePath = nextFilePath;
  currentFileLabel.textContent = currentFilePath || 'No file selected';
  currentFileLabel.title = currentFilePath;
}

async function loadFile(filePath = currentFilePath) {
  if (!filePath) {
    setStatus('Select an HTML file first');
    return;
  }

  setCurrentFile(filePath);
  videoMetadata = {};
  lastPlayerState = null;
  updateControls(player.snapshot());
  setStatus('Loading...');

  try {
    await player.load(currentFilePath);
  } catch (error) {
    setStatus(error.message);
  }
}

async function pickAndLoadFile() {
  player.pause();
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
  const state = playerState();
  if (!state.loaded) return;
  const rect = scrubber.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  player.seek(ratio * state.duration);
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
    player.togglePlay();
  } else if (isTextInput) {
    return;
  } else if (isSpace) {
    event.preventDefault();
    event.stopPropagation();
  } else if (event.ctrlKey && event.key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    player.seekBy(5);
  } else if (event.ctrlKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    player.seekBy(-5);
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    event.stopPropagation();
    toggleFullscreen();
  }
}

player.on('ready', state => {
  frame.contentWindow.addEventListener('keydown', handleViewerShortcut, true);
  videoMetadata = state.metadata || {};
  if (!userViewportOverride && state.detectedViewport) {
    setPreviewViewport(state.detectedViewport.width, state.detectedViewport.height);
  }
  updateControls(state);
  setStatus(state.resolved ? 'Resolved timeline loaded' : 'Preview timeline estimated');
});
player.on('statechange', updateControls);
player.on('timeupdate', updateControls);
player.on('error', error => setStatus(error.message));

loadButton.addEventListener('click', pickAndLoadFile);
infoButton.addEventListener('click', openInfoDialog);
infoCloseButton.addEventListener('click', closeInfoDialog);
infoDialog.addEventListener('click', event => {
  if (event.target === infoDialog) closeInfoDialog();
});
reloadButton.addEventListener('click', () => loadFile());
playButton.addEventListener('click', () => player.togglePlay());
seekBackButton.addEventListener('click', () => player.seekBy(-5));
seekForwardButton.addEventListener('click', () => player.seekBy(5));
subtitlesToggle.addEventListener('click', () => {
  const state = playerState();
  player.setSubtitlesEnabled(!state.subtitlesEnabled);
});
liveTtsToggle.addEventListener('click', () => {
  const state = playerState();
  player.setLiveTtsEnabled(!state.liveTtsEnabled);
});
scrubber.addEventListener('input', event => {
  player.seek(Number(event.target.value));
});
scrubber.addEventListener('pointerdown', seekFromPointer);
scrubber.addEventListener('click', seekFromPointer);
interactiveMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  player.seekToInteractive();
});
interactiveMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  player.seekToInteractive();
});
gameMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  player.seekToGame();
});
gameMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  player.seekToGame();
});
speedSelect.addEventListener('change', () => {
  player.setSpeed(Number(speedSelect.value) || 1);
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
  if (event.clientY >= window.innerHeight - 92) showFullscreenControls();
  else hideFullscreenControls();
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
updateControls(player.snapshot());
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
