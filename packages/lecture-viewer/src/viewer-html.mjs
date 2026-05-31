const viewerVersion = '0.2';

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
  grid-template-columns: 280px 1fr;
  grid-template-rows: 1fr auto;
}
body.fullscreen-active {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}
#folder-sidebar {
  grid-row: 1 / 3;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  border-right: 1px solid var(--line);
  background: #0d0d0d;
}
body.fullscreen-active #folder-sidebar {
  display: none;
}
#sidebar-header {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: start;
  padding: 13px 14px 10px;
  border-bottom: 1px solid var(--line);
}
#sidebar-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--muted-strong);
  text-transform: uppercase;
}
#folder-path {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
#copy-folder-path {
  background: transparent;
  border: 0;
  padding: 0;
  min-height: 0;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  color: var(--muted);
  transition: color 120ms ease, transform 100ms ease;
  margin-top: 6px;
}
#copy-folder-path:hover:not([disabled]) {
  color: var(--text) !important;
}
#copy-folder-path:active:not([disabled]) {
  transform: scale(0.9);
}
#copy-folder-path[disabled] {
  opacity: 0.35;
  cursor: default;
}
#open-folder {
  width: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
}
#open-folder[disabled] {
  opacity: 0.45;
  cursor: default;
}
#action-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--line);
}
#action-row button {
  width: 100%;
  min-width: 0;
}
#resolve-control,
#render-control {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 28px;
  min-width: 0;
}
#resolve-control[hidden],
#render-control[hidden] {
  display: none;
}
#resolve-control #sidebar-resolve,
#render-control #sidebar-render {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
#resolve-menu-toggle,
#render-menu-toggle {
  border-left: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0;
}
#resolve-menu-toggle::before,
#render-menu-toggle::before {
  content: "";
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  vertical-align: middle;
}
#resolve-options,
#render-options {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 30;
  display: none;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: #101010;
  box-shadow: 0 12px 34px rgba(0,0,0,0.46);
}
#resolve-options.visible,
#render-options.visible {
  display: grid;
}
.resolve-option,
.render-option {
  display: grid;
  gap: 4px;
}
.resolve-option label,
.render-option label {
  color: var(--muted);
  font-size: 11px;
}
.resolve-option select,
.render-option select {
  width: 100%;
}
#job-status {
  display: none;
  padding: 7px 8px;
  border-bottom: 1px solid var(--line);
  background: #090909;
  color: var(--muted-strong);
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#job-status.visible {
  display: flex;
}
#job-status.error {
  color: #ffb4b4;
}
#job-status.success {
  color: #b8f7c8;
}
#job-status-text {
  flex: 1;
  min-width: 0;
}
.stop-btn {
  min-height: 20px;
  height: 20px;
  padding: 0 8px;
  background: #2a1111;
  border: 1px solid #5a2222;
  border-radius: 4px;
  color: #ffb4b4;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  line-height: 18px;
  display: none;
  flex-shrink: 0;
  transition: background 120ms ease, border-color 120ms ease;
}
.stop-btn:hover:not([disabled]) {
  background: #4a1515;
  border-color: #8a3333;
}
.stop-btn:active:not([disabled]) {
  transform: translateY(1px);
}
.stop-btn[disabled] {
  opacity: 0.5;
  cursor: default;
}
.stop-btn.visible {
  display: inline-block;
}
#file-list {
  min-height: 0;
  overflow: auto;
  padding: 6px;
}
.file-item {
  width: 100%;
  min-height: 30px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--muted-strong);
  text-align: left;
}
.file-item:hover {
  background: var(--control);
  border-color: var(--line);
}
.file-item.active {
  background: #ededed;
  border-color: #ededed;
  color: #050505;
}
.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-kind {
  color: inherit;
  opacity: 0.62;
  font-size: 11px;
  text-transform: uppercase;
}
#sidebar-empty {
  padding: 12px 8px;
  color: var(--muted);
  font-size: 12px;
}
#frame-wrap {
  grid-column: 2;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  background: #3a3a3a;
}
body.fullscreen-active #frame-wrap {
  grid-column: 1;
  padding: 0;
}
body.fullscreen-active.file-kind-mp4 #frame-wrap {
  background: #000;
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
#document-preview {
  width: min(920px, calc(100% - 36px));
  height: calc(100% - 36px);
  display: none;
  overflow: auto;
  padding: 28px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: #101010;
  color: var(--text);
  line-height: 1.58;
}
#document-preview.visible {
  display: block;
}
#document-preview h1,
#document-preview h2,
#document-preview h3 {
  margin: 0 0 14px;
  line-height: 1.2;
}
#document-preview p,
#document-preview ul,
#document-preview ol,
#document-preview pre {
  margin: 0 0 14px;
}
#document-preview pre {
  overflow: auto;
  padding: 12px;
  background: #050505;
  border: 1px solid var(--line);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
#document-preview code {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 13px;
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
  grid-column: 2;
  display: grid;
  grid-template-columns: auto auto auto 1fr auto auto auto auto auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 94%, #fff 6%);
  box-shadow: 0 -16px 50px rgba(0,0,0,0.34);
}
body.fullscreen-active #controls {
  grid-column: 1;
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
  gap: 6px;
}
#current-file {
  min-width: 0;
  height: 30px;
  padding: 6px 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #0b0b0b;
  color: var(--muted-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 16px;
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
  min-height: 30px;
  padding: 5px 9px;
  cursor: pointer;
  font-weight: 520;
  font-size: 12px;
  letter-spacing: 0;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
button * {
  pointer-events: none;
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
  min-width: 34px;
  width: 34px;
  padding: 0;
  display: grid;
  place-items: center;
  background: #ededed;
  border-color: #ededed;
  color: #050505;
}
#fullscreen {
  min-width: 34px;
  width: 34px;
  padding: 0;
  display: grid;
  place-items: center;
}
.control-icon {
  width: 15px;
  height: 15px;
  display: block;
  pointer-events: none;
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
  height: 30px;
  padding: 6px 9px;
  background: #0c0c0c;
}
select {
  height: 30px;
  width: auto;
  min-width: 0;
  padding: 0 22px 0 7px;
  font-size: 12px;
  color: var(--muted-strong);
  cursor: pointer;
}
#speed {
  width: 54px;
}
#viewport-preset {
  width: 66px;
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
<aside id="folder-sidebar">
  <div id="sidebar-header">
    <div>
      <div id="sidebar-title">Folder</div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <div id="folder-path">No file selected</div>
        <button id="copy-folder-path" type="button" aria-label="Copy folder path" title="Copy folder path" disabled>
          <svg class="control-icon" style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
      </div>
    </div>
    <button id="open-folder" type="button" aria-label="Open folder" title="Open folder" disabled>
      <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  <div id="action-row">
    <div id="resolve-control">
      <button id="sidebar-resolve" type="button">Resolve</button>
      <button id="resolve-menu-toggle" type="button" aria-label="Resolve options" title="Resolve options" aria-expanded="false"></button>
      <div id="resolve-options">
        <div class="resolve-option">
          <label for="resolve-tts-voice">TTS voice</label>
          <select id="resolve-tts-voice">
            <optgroup label="Kokoro TTS (Local)">
              <option value="am_puck" selected>am_puck</option>
              <option value="af_heart">af_heart</option>
              <option value="am_adam">am_adam</option>
              <option value="bf_emma">bf_emma</option>
            </optgroup>
            <optgroup label="Google TTS (Gemini)">
              <option value="Puck">Puck</option>
              <option value="Charon">Charon</option>
              <option value="Kore">Kore</option>
              <option value="Fenrir">Fenrir</option>
              <option value="Aoede">Aoede</option>
              <option value="Zephyr">Zephyr</option>
            </optgroup>
          </select>
        </div>
        <div class="resolve-option">
          <label for="resolve-tts-speed">Voice speed</label>
          <select id="resolve-tts-speed">
            <option value="1">1.0x</option>
            <option value="1.2">1.2x</option>
            <option value="1.3" selected>1.3x</option>
            <option value="1.5">1.5x</option>
          </select>
        </div>
      </div>
    </div>
    <div id="render-control">
      <button id="sidebar-render" type="button">Render</button>
      <button id="render-menu-toggle" type="button" aria-label="Render options" title="Render options" aria-expanded="false"></button>
      <div id="render-options">
        <div class="render-option">
          <label for="render-tts-voice">TTS voice</label>
          <select id="render-tts-voice">
            <optgroup label="Kokoro TTS (Local)">
              <option value="am_puck" selected>am_puck</option>
              <option value="af_heart">af_heart</option>
              <option value="am_adam">am_adam</option>
              <option value="bf_emma">bf_emma</option>
            </optgroup>
            <optgroup label="Google TTS (Gemini)">
              <option value="Puck">Puck</option>
              <option value="Charon">Charon</option>
              <option value="Kore">Kore</option>
              <option value="Fenrir">Fenrir</option>
              <option value="Aoede">Aoede</option>
              <option value="Zephyr">Zephyr</option>
            </optgroup>
          </select>
        </div>
        <div class="render-option">
          <label for="render-tts-speed">Voice speed</label>
          <select id="render-tts-speed">
            <option value="1">1.0x</option>
            <option value="1.2">1.2x</option>
            <option value="1.3" selected>1.3x</option>
            <option value="1.5">1.5x</option>
          </select>
        </div>
        <div class="render-option">
          <label for="render-fps">FPS</label>
          <select id="render-fps">
            <option value="24">24</option>
            <option value="30" selected>30</option>
            <option value="60">60</option>
          </select>
        </div>
        <div class="render-option">
          <label for="render-resolution">Resolution</label>
          <select id="render-resolution">
            <option value="1080x1920" selected>1080x1920</option>
            <option value="1920x1080">1920x1080</option>
            <option value="720x1280">720x1280</option>
          </select>
        </div>
      </div>
    </div>
  </div>
  <div id="job-status" role="status" aria-live="polite">
    <span id="job-status-text"></span>
    <button id="stop-job-btn" type="button" class="stop-btn">Stop</button>
  </div>
  <div id="file-list">
    <div id="sidebar-empty">Open an HTML file to scan its folder.</div>
  </div>
</aside>
<main id="frame-wrap">
  <div id="preview-shell">
    <iframe id="preview" title="Render preview"></iframe>
    <div id="subtitle-overlay" aria-live="polite"></div>
  </div>
  <article id="document-preview"></article>
</main>
<section id="controls">
  <div id="file-row">
    <div id="current-file">${escapeHtml(normalizedOpenPath || 'No file selected')}</div>
    <button id="info" type="button">Info</button>
    <button id="load">Load</button>
    <button id="reload">Reload</button>
  </div>
  <button id="play" type="button" aria-label="Play" title="Play"></button>
  <button id="seek-back" title="Back 5 seconds">&#8592; 5s</button>
  <button id="seek-forward" title="Forward 5 seconds">5s &#8594;</button>
  <div id="scrub-wrap">
    <input id="scrub" type="range" min="0" max="1" step="0.001" value="0">
    <div id="interactive-marker" title="Interactive segment"></div>
    <div id="game-marker" title="Game segment"></div>
  </div>
  <div id="time">0.00 / 0.00</div>
  <button id="subtitles-toggle" type="button" aria-pressed="true" title="Closed captions">CC</button>
  <button id="live-tts-toggle" type="button" aria-pressed="true">Live TTS</button>
  <select id="speed">
    <option value="0.5">0.5x</option>
    <option value="1" selected>1x</option>
    <option value="1.5">1.5x</option>
    <option value="2">2x</option>
  </select>
  <select id="viewport-preset" title="Preview viewport">
    <option value="1080x1920">9:16</option>
    <option value="1920x1080">16:9</option>
    <option value="custom">Custom</option>
  </select>
  <div id="viewport">${safeInitialWidth}x${safeInitialHeight}</div>
  <div id="status">No file loaded</div>
  <button id="fullscreen" type="button" aria-label="Fullscreen" title="Fullscreen"></button>
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

const folderPathLabel = document.getElementById('folder-path');
const copyFolderPathButton = document.getElementById('copy-folder-path');
const openFolderButton = document.getElementById('open-folder');
const fileList = document.getElementById('file-list');
const jobStatus = document.getElementById('job-status');
const resolveControl = document.getElementById('resolve-control');
const sidebarResolveButton = document.getElementById('sidebar-resolve');
const resolveMenuToggle = document.getElementById('resolve-menu-toggle');
const resolveOptions = document.getElementById('resolve-options');
const resolveTtsVoice = document.getElementById('resolve-tts-voice');
const resolveTtsSpeed = document.getElementById('resolve-tts-speed');
const renderControl = document.getElementById('render-control');
const sidebarRenderButton = document.getElementById('sidebar-render');
const renderMenuToggle = document.getElementById('render-menu-toggle');
const renderOptions = document.getElementById('render-options');
const renderTtsVoice = document.getElementById('render-tts-voice');
const renderTtsSpeed = document.getElementById('render-tts-speed');
const renderFps = document.getElementById('render-fps');
const renderResolution = document.getElementById('render-resolution');
const frameWrap = document.getElementById('frame-wrap');
const previewShell = document.getElementById('preview-shell');
const frame = document.getElementById('preview');
const documentPreview = document.getElementById('document-preview');
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
let activeJobTimer = 0;
let activeJobStartedAt = 0;
let activeJobLabel = '';
let currentBrowserFolder = '';

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

function formatElapsed(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes + ':' + String(remainder).padStart(2, '0');
}

function setJobStatus(message, state = '') {
  const textSpan = document.getElementById('job-status-text');
  const stopBtn = document.getElementById('stop-job-btn');
  if (textSpan) textSpan.textContent = message || '';
  jobStatus.classList.toggle('visible', Boolean(message));
  jobStatus.classList.toggle('error', state === 'error');
  jobStatus.classList.toggle('success', state === 'success');

  if (stopBtn) {
    const isRunning = Boolean(message) && state !== 'error' && state !== 'success';
    stopBtn.classList.toggle('visible', isRunning);
  }
}

function setResolveOptionsVisible(visible) {
  resolveOptions.classList.toggle('visible', visible);
  resolveMenuToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
}

function setRenderOptionsVisible(visible) {
  renderOptions.classList.toggle('visible', visible);
  renderMenuToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
}

function resolveQuery() {
  const params = new URLSearchParams();
  params.set('file', currentFilePath);
  params.set('ttsVoice', resolveTtsVoice.value || 'am_puck');
  params.set('ttsSpeed', resolveTtsSpeed.value || '1.3');
  return params.toString();
}

function renderQuery() {
  const params = new URLSearchParams();
  const [width, height] = String(renderResolution.value || '1080x1920').split('x');
  params.set('file', currentFilePath);
  params.set('ttsVoice', renderTtsVoice.value || 'am_puck');
  params.set('ttsSpeed', renderTtsSpeed.value || '1.3');
  params.set('fps', renderFps.value || '30');
  params.set('width', width || '1080');
  params.set('height', height || '1920');
  return params.toString();
}

function startJobStatus(label) {
  activeJobLabel = label;
  activeJobStartedAt = Date.now();
  clearInterval(activeJobTimer);

  const update = () => {
    const elapsed = (Date.now() - activeJobStartedAt) / 1000;
    setJobStatus(activeJobLabel + '... ' + formatElapsed(elapsed));
  };

  update();
  activeJobTimer = setInterval(update, 1000);
}

function finishJobStatus(message, state = 'success') {
  clearInterval(activeJobTimer);
  activeJobTimer = 0;
  activeJobLabel = '';
  setJobStatus(message, state);
}

const controlIcons = {
  play: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  fullscreen: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fullscreenExit: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v4H5M19 9h-4V5M15 19v-4h4M5 15h4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};

function setIconButton(button, icon, label) {
  button.innerHTML = controlIcons[icon] || '';
  button.setAttribute('aria-label', label);
  button.title = label;
}

function fileBaseName(filePath) {
  return String(filePath || '').replaceAll('\\\\', '/').split('/').filter(Boolean).at(-1) || '';
}

function fileExtension(filePath) {
  const name = fileBaseName(filePath);
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index + 1).toLowerCase() : '';
}

function folderPathFromFile(filePath) {
  const normalized = String(filePath || '').replaceAll('\\\\', '/');
  const index = normalized.lastIndexOf('/');
  return index > -1 ? normalized.slice(0, index) : '';
}

function isDocumentPreviewFile(filePath) {
  return ['txt', 'md'].includes(fileExtension(filePath));
}

function currentFileKind() {
  return fileBaseName(currentFilePath).toLowerCase();
}

function setPreviewMode(mode) {
  const documentMode = mode === 'document';
  previewShell.style.display = documentMode ? 'none' : '';
  documentPreview.classList.toggle('visible', documentMode);
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').split(/\\r?\\n/);
  const html = [];
  let paragraph = [];
  let listOpen = false;
  let codeOpen = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push('<p>' + paragraph.map(escapeText).join(' ') + '</p>');
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    html.push('</ul>');
    listOpen = false;
  };

  for (const line of lines) {
    if (line.trim().startsWith(String.fromCharCode(96, 96, 96))) {
      flushParagraph();
      closeList();
      html.push(codeOpen ? '</code></pre>' : '<pre><code>');
      codeOpen = !codeOpen;
      continue;
    }
    if (codeOpen) {
      html.push(escapeText(line) + '\\n');
      continue;
    }

    const heading = line.match(/^(#{1,3})\\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push('<h' + level + '>' + escapeText(heading[2]) + '</h' + level + '>');
      continue;
    }

    const listItem = line.match(/^\\s*[-*]\\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push('<li>' + escapeText(listItem[1]) + '</li>');
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (codeOpen) html.push('</code></pre>');
  return html.join('');
}

async function loadDocumentFile(filePath) {
  player.pause();
  setPreviewMode('document');
  setCurrentFile(filePath);
  videoMetadata = {};
  lastPlayerState = null;
  updateControls(player.snapshot());
  documentPreview.textContent = 'Loading...';
  setStatus('Loading document...');

  try {
    const response = await fetch(fileUrl(currentFilePath), { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) throw new Error(text || 'Document load failed');

    if (fileExtension(currentFilePath) === 'md') {
      documentPreview.innerHTML = renderMarkdown(text);
    } else {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = text;
      pre.append(code);
      documentPreview.textContent = '';
      documentPreview.append(pre);
    }

    setStatus('Document loaded');
    refreshFolderFiles();
  } catch (error) {
    documentPreview.textContent = error.message;
    setStatus(error.message);
    refreshFolderFiles();
  }
}

function syncIdeActions() {
  const kind = currentFileKind();
  const canResolve = kind === 'index.html';
  const canRender = kind === 'index.html' || kind === 'resolved.html';
  resolveControl.hidden = !canResolve;
  if (!canResolve) {
    setResolveOptionsVisible(false);
  }
  sidebarResolveButton.disabled = !canResolve;
  resolveMenuToggle.disabled = !canResolve;
  renderControl.hidden = !canRender;
  if (!canRender) {
    setRenderOptionsVisible(false);
  }
  sidebarRenderButton.disabled = !canRender;
  renderMenuToggle.disabled = !canRender;
}

function setActionBusy(isBusy, message, action = '') {
  for (const button of [sidebarResolveButton, resolveMenuToggle, sidebarRenderButton, renderMenuToggle]) {
    button.disabled = isBusy;
  }
  sidebarResolveButton.textContent = isBusy && action === 'resolve' ? 'Resolving...' : 'Resolve';
  sidebarRenderButton.textContent = isBusy && action === 'render' ? 'Rendering...' : 'Render';
  if (message) setStatus(message);
}

function renderFolderFiles(payload) {
  folderPathLabel.textContent = payload?.folder || 'No file selected';
  folderPathLabel.title = payload?.folder || '';
  currentBrowserFolder = payload?.folder || '';
  openFolderButton.disabled = !currentBrowserFolder;
  copyFolderPathButton.disabled = !currentBrowserFolder;
  fileList.textContent = '';

  const entries = Array.isArray(payload?.entries)
    ? payload.entries
    : (Array.isArray(payload?.files) ? payload.files.map(file => ({ ...file, type: 'file' })) : []);

  if (payload?.parent) {
    const parentButton = document.createElement('button');
    parentButton.type = 'button';
    parentButton.className = 'file-item';
    parentButton.title = payload.parent;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = '..';

    const kind = document.createElement('span');
    kind.className = 'file-kind';
    kind.textContent = 'UP';

    parentButton.append(name, kind);
    parentButton.addEventListener('click', () => browseFolder(payload.parent));
    fileList.append(parentButton);
  }

  if (!entries.length && !payload?.parent) {
    const empty = document.createElement('div');
    empty.id = 'sidebar-empty';
    empty.textContent = 'No files found in this folder.';
    fileList.append(empty);
    return;
  }

  for (const file of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.classList.toggle('active', file.path === currentFilePath);
    button.title = file.path;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;

    const kind = document.createElement('span');
    kind.className = 'file-kind';
    kind.textContent = file.type === 'directory' ? 'DIR' : (fileExtension(file.name) || 'file');

    button.append(name, kind);
    button.addEventListener('click', () => {
      if (file.type === 'directory') browseFolder(file.path);
      else loadFile(file.path);
    });
    fileList.append(button);
  }
}

async function browseFolder(folderPath = '') {
  try {
    const query = folderPath ? '?dir=' + encodeURIComponent(folderPath) : '';
    const response = await fetch('/browse-folder' + query, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Folder browse failed');
    renderFolderFiles(payload);
  } catch (error) {
    folderPathLabel.textContent = error.message;
    folderPathLabel.title = '';
    currentBrowserFolder = '';
    openFolderButton.disabled = true;
    copyFolderPathButton.disabled = true;
    fileList.textContent = '';
  } finally {
    syncIdeActions();
  }
}

async function refreshFolderFiles() {
  if (!currentFilePath) {
    await browseFolder(currentBrowserFolder);
    return;
  }

  try {
    const response = await fetch('/browse-folder?dir=' + encodeURIComponent(folderPathFromFile(currentFilePath)), { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Folder scan failed');
    renderFolderFiles(payload);
  } catch (error) {
    folderPathLabel.textContent = error.message;
    fileList.textContent = '';
  } finally {
    syncIdeActions();
  }
}

function playNotificationSound(success = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (success) {
      // Pleasant dual tone chime: low to high
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.40);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.40);
    } else {
      // Duller warning tone for errors/aborts
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (err) {
    console.error('Failed to play notification sound:', err);
  }
}

async function runResolve() {
  if (currentFileKind() !== 'index.html') return;
  const sourceName = fileBaseName(currentFilePath);
  setActionBusy(true, 'Resolving...', 'resolve');
  setResolveOptionsVisible(false);
  startJobStatus('Resolving ' + sourceName + ' with ' + resolveTtsVoice.value + ' @ ' + resolveTtsSpeed.value + 'x');
  try {
    const response = await fetch('/resolve-file?' + resolveQuery(), { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Resolve failed');
    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    setStatus('Resolved: ' + payload.path);
    finishJobStatus('Done: ' + fileBaseName(payload.path));
    playNotificationSound(true);
  } catch (error) {
    setStatus(error.message);
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    setActionBusy(false);
    syncIdeActions();
  }
}

async function runRender() {
  if (!['index.html', 'resolved.html'].includes(currentFileKind())) return;
  const sourceName = fileBaseName(currentFilePath);
  setActionBusy(true, 'Rendering...', 'render');
  setRenderOptionsVisible(false);
  startJobStatus(
    'Rendering ' + sourceName +
    ' at ' + renderFps.value + ' FPS, ' +
    renderResolution.value +
    ', ' + renderTtsVoice.value + ' @ ' + renderTtsSpeed.value + 'x'
  );
  try {
    const response = await fetch('/render-file?' + renderQuery(), { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Render failed');
    renderFolderFiles(payload.folder);
    setStatus('Rendered: ' + payload.output);
    finishJobStatus('Done: ' + fileBaseName(payload.output));
    playNotificationSound(true);
  } catch (error) {
    setStatus(error.message);
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    setActionBusy(false);
    syncIdeActions();
  }
}

async function runStopJob() {
  const stopBtn = document.getElementById('stop-job-btn');
  if (stopBtn) stopBtn.disabled = true;
  setStatus('Stopping process...');
  try {
    const response = await fetch('/stop-job', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to stop');
    setStatus('Process stopped successfully');
  } catch (error) {
    setStatus(error.message);
  } finally {
    if (stopBtn) stopBtn.disabled = false;
  }
}

function formatMetadataKey(key) {
  if (key === 'viewerVersion') return 'IDE version';
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
  setIconButton(fullscreenButton, active ? 'fullscreenExit' : 'fullscreen', active ? 'Exit fullscreen' : 'Fullscreen');
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
  setIconButton(playButton, state.playing ? 'pause' : 'play', state.playing ? 'Pause' : 'Play');
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
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  document.body.classList.toggle('file-kind-mp4', isMp4);
  syncIdeActions();
}

async function openCurrentFolder() {
  if (!currentBrowserFolder) return;
  try {
    const response = await fetch('/open-folder?dir=' + encodeURIComponent(currentBrowserFolder), { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Open folder failed');
    setStatus('Opened folder: ' + payload.folder);
  } catch (error) {
    setStatus(error.message);
  }
}

async function loadFile(filePath = currentFilePath) {
  if (!filePath) {
    setStatus('Select a file first');
    return;
  }

  if (isDocumentPreviewFile(filePath)) {
    await loadDocumentFile(filePath);
    return;
  }

  setPreviewMode('html');
  setCurrentFile(filePath);
  videoMetadata = {};
  lastPlayerState = null;
  updateControls(player.snapshot());
  setStatus('Loading...');

  try {
    await player.load(currentFilePath);
    refreshFolderFiles();
  } catch (error) {
    setStatus(error.message);
    refreshFolderFiles();
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

  if (state.detectedViewport) {
    const val = state.detectedViewport.width + 'x' + state.detectedViewport.height;
    let exists = Array.from(renderResolution.options).some(opt => opt.value === val);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val + ' (Auto)';
      opt.id = 'render-resolution-auto';
      
      const prev = document.getElementById('render-resolution-auto');
      if (prev) prev.remove();
      
      renderResolution.prepend(opt);
    }
    renderResolution.value = val;
  }

  updateControls(state);
  setStatus(state.resolved ? 'Resolved timeline loaded' : 'Preview timeline estimated');
});
player.on('statechange', updateControls);
player.on('timeupdate', updateControls);
player.on('error', error => setStatus(error.message));

loadButton.addEventListener('click', pickAndLoadFile);
openFolderButton.addEventListener('click', openCurrentFolder);
copyFolderPathButton.addEventListener('click', async () => {
  if (!currentBrowserFolder) return;
  try {
    await navigator.clipboard.writeText(currentBrowserFolder);
    const originalTitle = copyFolderPathButton.title;
    copyFolderPathButton.title = 'Copied!';
    setStatus('Folder path copied to clipboard');
    
    copyFolderPathButton.innerHTML = '<svg class="control-icon" style="width: 14px; height: 14px; color: #b8f7c8;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    
    setTimeout(() => {
      copyFolderPathButton.title = originalTitle;
      copyFolderPathButton.innerHTML = '<svg class="control-icon" style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    }, 1500);
  } catch (err) {
    setStatus('Failed to copy: ' + err.message);
  }
});
infoButton.addEventListener('click', openInfoDialog);
infoCloseButton.addEventListener('click', closeInfoDialog);
infoDialog.addEventListener('click', event => {
  if (event.target === infoDialog) closeInfoDialog();
});
reloadButton.addEventListener('click', () => loadFile());
resolveMenuToggle.addEventListener('click', event => {
  event.stopPropagation();
  setResolveOptionsVisible(!resolveOptions.classList.contains('visible'));
  setRenderOptionsVisible(false);
});
resolveOptions.addEventListener('click', event => {
  event.stopPropagation();
});
renderMenuToggle.addEventListener('click', event => {
  event.stopPropagation();
  setRenderOptionsVisible(!renderOptions.classList.contains('visible'));
  setResolveOptionsVisible(false);
});
renderOptions.addEventListener('click', event => {
  event.stopPropagation();
});
document.addEventListener('click', () => {
  setResolveOptionsVisible(false);
  setRenderOptionsVisible(false);
});
sidebarResolveButton.addEventListener('click', runResolve);
sidebarRenderButton.addEventListener('click', runRender);
const stopJobBtn = document.getElementById('stop-job-btn');
if (stopJobBtn) {
  stopJobBtn.addEventListener('click', runStopJob);
}
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
setIconButton(fullscreenButton, 'fullscreen', 'Fullscreen');
refreshFolderFiles();
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
