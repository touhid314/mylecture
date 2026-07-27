// @ts-nocheck
/**
 * Builds the browser IDE shell used by the local ide-server.
 *
 * The returned HTML contains the complete three-panel interface: folder browser,
 * preview/player surface, timeline controls, publish dialog, and agent sidebar.
 */
const viewerVersion = '0.2';

function viewportFromConfigAspectRatio(aspectRatio, baseWidth, baseHeight) {
  const match = String(aspectRatio || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  const longEdge = Math.max(Number(baseWidth) || 1920, Number(baseHeight) || 1080);
  if (!match) return { width: Number(baseWidth) || 1920, height: Number(baseHeight) || 1080 };

  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return { width: Number(baseWidth) || 1920, height: Number(baseHeight) || 1080 };
  }

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

function generationSecondsToInitialSlider(seconds) {
  const minSeconds = 5;
  const maxSeconds = 900;
  const sliderMax = 1000;
  const raw = Number(seconds);
  const clamped = Math.max(minSeconds, Math.min(maxSeconds, Number.isFinite(raw) ? raw : 60));
  const progress = Math.log(clamped / minSeconds) / Math.log(maxSeconds / minSeconds);
  return Math.round(Math.max(0, Math.min(1, progress)) * sliderMax);
}

function formatInitialGenerationLength(seconds) {
  const total = Math.round(Number(seconds) || 60);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return remainder ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes}:00`;
}

function selectedAttr(value, selected) {
  return String(value) === String(selected) ? ' selected' : '';
}

export function createViewerHtml(openPath, initialWidth = 1920, initialHeight = 1080, options = {}) {
  // Normalize values before interpolation so the generated page can be served
  // directly without another runtime configuration step.
  const agentConfig = options.agent || {};
  const ttsConfig = options.tts || {};
  const renderConfig = options.render || {};
  const normalizedOpenPath = openPath ? openPath.replaceAll('\\', '/') : '';
  const safeInitialWidth = Number.isInteger(initialWidth) && initialWidth > 0 ? initialWidth : 1920;
  const safeInitialHeight = Number.isInteger(initialHeight) && initialHeight > 0 ? initialHeight : 1080;
  const defaultTtsVoice = String(ttsConfig.voice || 'af_heart');
  const defaultTtsSpeed = String(ttsConfig.speed || 1);
  const defaultFps = String(renderConfig.fps || 60);
  const defaultBurnSubtitle = renderConfig.burnSubtitle === true;
  const defaultSubtitleFont = String(renderConfig.subtitleFont || 'Arial');
  const defaultSubtitleFontSize = Number(renderConfig.subtitleFontSize) || 48;
  const defaultSubtitleBottomPercent = Number.isFinite(Number(renderConfig.subtitleBottomPercent))
    ? Number(renderConfig.subtitleBottomPercent)
    : 8;
  const subtitleFontOptions = [...new Set([
    defaultSubtitleFont,
    'Arial',
    'Inter',
    'Verdana',
    'Georgia',
    'Times New Roman'
  ])].map(font => `<option value="${escapeHtml(font)}"${selectedAttr(font, defaultSubtitleFont)}>${escapeHtml(font)}</option>`).join('');
  const burnSubtitleChecked = defaultBurnSubtitle ? ' checked' : '';
  const subtitleOptionsVisible = defaultBurnSubtitle ? ' class="visible"' : '';
  const defaultAspectRatio = String(agentConfig.defaultAspectRatio || '16:9');
  const defaultLengthSeconds = Number(agentConfig.defaultLengthSeconds) || 60;
  const defaultLengthSliderValue = generationSecondsToInitialSlider(defaultLengthSeconds);
  const defaultLengthLabel = formatInitialGenerationLength(defaultLengthSeconds);
  const defaultRenderViewport = viewportFromConfigAspectRatio(
    defaultAspectRatio,
    renderConfig.baseWidth || 1920,
    renderConfig.baseHeight || 1080
  );
  const defaultRenderResolution = `${defaultRenderViewport.width}x${defaultRenderViewport.height}`;
  const getimgChecked = agentConfig.enableGetimgTool ? ' checked' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Render HTML Viewer</title>
<style>
/* Local IDE shell styling. The generated page has no external CSS dependency. */
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
  --sec-width: 15px;
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
  grid-template-columns: 280px 1fr var(--agent-bar-width, 320px);
  grid-template-rows: 1fr auto auto;
  transition: grid-template-columns 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
body.agent-collapsed {
  --agent-bar-width: 0px;
}
body.fullscreen-active {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}
body.pseudo-fullscreen {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100% !important;
  height: 100dvh !important;
  z-index: 99999 !important;
  overflow: hidden !important;
}
#folder-sidebar {
  grid-column: 1;
  grid-row: 1 / 4;
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
#open-folder,
#refresh-folder {
  width: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
}
#open-folder[disabled],
#refresh-folder[disabled] {
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
.render-option select,
.render-option input[type="number"] {
  width: 100%;
}
#render-subtitle-options {
  display: none;
  gap: 7px;
  padding-top: 7px;
  border-top: 1px solid var(--line);
}
#render-subtitle-options.visible {
  display: grid;
}
.render-subtitle-toggle label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  cursor: pointer;
}
.render-subtitle-toggle input {
  width: auto;
  margin: 0;
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
  grid-row: 1;
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
#preview, #preview-preload {
  position: absolute;
  top: 0;
  left: 0;
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
#document-preview.avsl-preview {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 13px;
  line-height: 1.62;
}
#document-preview .avsl-line {
  min-height: 1.62em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
#document-preview .avsl-visual {
  display: inline;
  padding: 1px 5px;
  border: 1px solid rgba(111, 194, 255, 0.42);
  border-radius: 4px;
  background: rgba(28, 93, 140, 0.32);
  color: #bde7ff;
  font-weight: 600;
}
#document-preview .avsl-narration {
  color: #eeeeee;
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
  grid-row: 2;
  display: grid;
  grid-template-columns: auto auto auto 1fr auto auto auto auto auto auto;
  gap: 6px;
  align-items: center;
  padding: 6px 10px 8px;
  border-top: 1px solid var(--line);
  background: #0d0d0d;
  box-shadow: 0 -10px 30px rgba(0,0,0,0.5);
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
  grid-template-columns: 1fr auto auto auto auto;
  gap: 6px;
}
#current-file {
  min-width: 0;
  height: 28px;
  padding: 5px 9px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: #0b0b0b;
  color: var(--muted-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 16px;
  font-size: 11px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
input, button, select {
  font: inherit;
  color: var(--text);
  background: var(--control);
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  outline: none;
}
button {
  min-height: 28px;
  height: 28px;
  padding: 0 8px;
  cursor: pointer;
  font-weight: 500;
  font-size: 11px;
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
  min-width: 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--line-strong);
  color: var(--text);
}
#fullscreen,
#volume-toggle,
#seek-back,
#seek-forward {
  min-width: 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
}
.control-icon {
  width: 14px;
  height: 14px;
  display: block;
  pointer-events: none;
}
#play:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--accent);
  color: var(--accent);
}
#play.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent);
  color: var(--accent);
}
#load,
#reload,
#publish,
#info,
#volume-toggle,
#subtitles-toggle,
#live-tts-toggle,
#narration-edit,
#visual-text-edit,
#fullscreen,
#seek-back,
#seek-forward {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line-strong);
  color: var(--muted-strong);
}
#load:hover,
#reload:hover,
#publish:hover,
#info:hover,
#volume-control:hover #volume-toggle,
#volume-toggle:hover,
#subtitles-toggle:hover,
#live-tts-toggle:hover,
#narration-edit:hover,
#visual-text-edit:hover,
#fullscreen:hover,
#seek-back:hover,
#seek-forward:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: #555;
  color: var(--text);
}
#subtitles-toggle.active,
#live-tts-toggle.active,
#volume-toggle.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent);
  color: var(--accent);
}
#subtitles-toggle.active:hover,
#live-tts-toggle.active:hover,
#volume-control:hover #volume-toggle.active,
#volume-toggle.active:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: #fff;
  color: #fff;
}
#volume-control {
  display: grid;
  grid-template-columns: 28px 96px;
  align-items: center;
  gap: 6px;
  width: 130px;
  height: 28px;
}
#volume-popover {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 28px;
}
#volume-slider {
  height: 18px;
}
input[type="text"] {
  width: 100%;
  height: 28px;
  padding: 5px 8px;
  background: #0c0c0c;
}
select {
  height: 28px;
  width: auto;
  min-width: 0;
  padding: 0 20px 0 6px;
  font-size: 11px;
  color: var(--muted-strong);
  cursor: pointer;
}
#speed {
  width: 50px;
}
#viewport-preset {
  width: 62px;
}
#scrub-wrap {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  height: 20px;
  cursor: pointer;
}
input[type="range"]:focus {
  outline: none;
}
input[type="range"]::-webkit-slider-runnable-track {
  width: 100%;
  height: 3px;
  cursor: pointer;
  background: #2d2d2d;
  border-radius: 999px;
  border: none;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 10px;
  width: 10px;
  border-radius: 50%;
  background: var(--accent);
  border: 0;
  margin-top: -3.5px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.55);
  transition: transform 100ms ease;
}
input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
input[type="range"]::-moz-range-track {
  width: 100%;
  height: 3px;
  cursor: pointer;
  background: #2d2d2d;
  border-radius: 999px;
  border: none;
}
input[type="range"]::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  border: 0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.55);
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
  min-width: 110px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--muted-strong);
  font-size: 11px;
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
#narration-edit,
#visual-text-edit {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
}
.take-wave {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 12px;
}
.take-wave i {
  width: 2px;
  height: 5px;
  border-radius: 2px;
  background: currentColor;
}
.take-wave i:nth-child(2) { height: 11px; }
.take-wave i:nth-child(3) { height: 8px; }
.take-wave i:nth-child(4) { height: 12px; }
.take-wave i:nth-child(5) { height: 6px; }
#narration-dialog {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: none;
  place-items: center;
  padding: 18px;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(5px);
}
#narration-dialog.visible {
  display: grid;
}
#narration-panel {
  width: min(680px, 100%);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  overflow: hidden;
  background: #101010;
  box-shadow: 0 28px 90px rgba(0,0,0,0.76);
}
#narration-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}
#narration-title {
  margin: 0;
  color: var(--text);
  font-size: 16px;
  font-weight: 680;
}
#narration-subtitle {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
}
#narration-close {
  min-height: 30px;
  padding: 4px 9px;
}
#narration-form {
  display: grid;
  gap: 14px;
  padding: 18px;
}
.narration-field {
  display: grid;
  gap: 6px;
}
.narration-field label {
  color: var(--muted-strong);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
#narration-section-select,
#narration-caption,
#narration-spoken-text {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel-raised);
  font: inherit;
  line-height: 1.5;
}
#narration-section-select {
  min-height: 36px;
  padding: 7px 9px;
}
#narration-caption {
  min-height: 86px;
  resize: vertical;
  padding: 10px 11px;
}
#narration-spoken-text {
  min-height: 110px;
  resize: vertical;
  padding: 11px 12px;
}
#narration-caption:focus,
#narration-spoken-text:focus,
#narration-section-select:focus {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
  border-color: var(--accent);
}
#narration-status {
  min-height: 18px;
  color: var(--muted);
  font-size: 12px;
}
#narration-status.error { color: #ff8278; }
#narration-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}
#narration-reset {
  color: var(--muted-strong);
  background: transparent;
}
#narration-regenerate {
  border-color: var(--accent);
  color: #111;
  background: var(--accent);
  font-weight: 700;
}
#narration-regenerate:hover:not(:disabled) {
  background: #fff;
}
#visual-text-dialog {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: none;
  place-items: center;
  padding: 18px;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(5px);
}
#visual-text-dialog.visible {
  display: grid;
}
#visual-text-panel {
  width: min(680px, 100%);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  overflow: hidden;
  background: #101010;
  box-shadow: 0 28px 90px rgba(0,0,0,0.76);
}
#visual-text-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}
#visual-text-title {
  margin: 0;
  color: var(--text);
  font-size: 16px;
  font-weight: 680;
}
#visual-text-subtitle {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
}
#visual-text-close {
  min-height: 30px;
  padding: 4px 9px;
}
#visual-text-form {
  display: grid;
  gap: 14px;
  padding: 18px;
}
.visual-editor-tabs {
  display: inline-flex;
  width: fit-content;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #080808;
}
.visual-editor-tab {
  min-height: 28px;
  padding: 4px 10px;
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}
.visual-editor-tab.active {
  border-color: var(--line-strong);
  background: rgba(255,255,255,0.09);
  color: var(--text);
}
.visual-editor-section {
  display: grid;
  gap: 14px;
}
.visual-editor-section[hidden] {
  display: none;
}
.visual-text-field {
  display: grid;
  gap: 6px;
}
.visual-text-field label {
  color: var(--muted-strong);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
#visual-text-select,
#visual-text-find,
#visual-text-replacement,
#visual-prompt {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel-raised);
  font: inherit;
  line-height: 1.5;
}
#visual-text-select,
#visual-text-find {
  min-height: 36px;
  padding: 7px 9px;
}
#visual-text-replacement,
#visual-prompt {
  min-height: 86px;
  resize: vertical;
  padding: 10px 11px;
}
#visual-prompt {
  min-height: 130px;
}
#visual-text-select:focus,
#visual-text-find:focus,
#visual-text-replacement:focus,
#visual-prompt:focus {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
  border-color: var(--accent);
}
#visual-text-help,
#visual-prompt-help {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.45;
}
#visual-text-status {
  min-height: 18px;
  color: var(--muted);
  font-size: 12px;
}
#visual-text-status.error { color: #ff8278; }
#visual-text-actions {
  display: flex;
  justify-content: flex-end;
}
#visual-text-apply,
#visual-prompt-apply {
  border-color: var(--accent);
  color: #111;
  background: var(--accent);
  font-weight: 700;
}
#visual-text-apply:hover:not(:disabled),
#visual-prompt-apply:hover:not(:disabled) {
  background: #fff;
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

#publish-dialog {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: none;
  place-items: center;
  padding: 18px;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(4px);
}
#publish-dialog.visible {
  display: grid;
}
#publish-panel {
  width: min(520px, 100%);
  max-height: min(850px, calc(100vh - 36px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: #101010;
  box-shadow: 0 22px 70px rgba(0,0,0,0.7);
}
#publish-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
#publish-title {
  font-weight: 650;
  color: var(--text);
  font-size: 15px;
}
#publish-close {
  background: transparent;
  border: 0;
  color: var(--muted);
  cursor: pointer;
  padding: 4px;
}
#publish-close:hover {
  color: var(--text);
}
#publish-form {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0;
}
#publish-form-content {
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 220px);
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.form-group label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-strong);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.form-group input[type="text"],
.form-group input[type="number"],
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 6px 10px;
  background: #090909;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  color: var(--text);
  outline: none;
  font-size: 13px;
}
.form-group textarea {
  min-height: 60px;
  resize: vertical;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  border-color: #6a6a6a;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.checkbox-group {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.checkbox-group label {
  text-transform: none;
  font-weight: normal;
  letter-spacing: 0;
  font-size: 13px;
  cursor: pointer;
}
.checkbox-group input {
  cursor: pointer;
}
#publish-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: #0b0b0b;
}
#publish-submit {
  background: #ededed;
  color: #050505;
  border: 1px solid #ededed;
}
#publish-submit:hover {
  background: #fff;
  border-color: #fff;
}
#publish-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
#publish-status-box {
  margin: 0 16px 12px;
  border-radius: 4px;
  border: 1px solid #331c1c;
}
#publish-status-box.success {
  border-color: #1c3322;
  color: #b8f7c8;
}
#publish-status-box.error {
  border-color: #552222;
  color: #ffb4b4;
}

/* Scene Panel styles */
#scene-panel {
  grid-column: 2;
  grid-row: 3;
  background: #0d0d0d;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 140px;
  min-width: 0;
}
body.fullscreen-active #scene-panel {
  display: none;
}
.scene-panel-header {
  padding: 6px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #090909;
  border-bottom: 1px solid var(--line);
}
.scene-panel-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--muted-strong);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.scenes-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}
.scenes-tab-btn {
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  height: 22px;
  min-height: 22px;
  cursor: pointer;
  transition: all 150ms ease;
  line-height: 14px;
}
.scenes-tab-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}
.scenes-tab-btn.active {
  color: #050505;
  background: var(--accent);
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.timeline-container {
  position: relative;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  background: #090909;
}
.timeline-container::-webkit-scrollbar {
  height: 8px;
}
.timeline-container::-webkit-scrollbar-track {
  background: #090909;
}
.timeline-container::-webkit-scrollbar-thumb {
  background: #202020;
  border-radius: 4px;
}
.timeline-container::-webkit-scrollbar-thumb:hover {
  background: #2d2d2d;
}
.timeline-content {
  position: relative;
  min-height: 110px;
}
.timeline-ruler {
  position: relative;
  height: 28px;
  background: #121212;
  border-bottom: 1px solid var(--line);
  user-select: none;
  cursor: ew-resize;
}
.ruler-tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 5px;
  background: var(--line-strong);
}
.ruler-tick.major {
  height: 8px;
  background: var(--muted);
}
.ruler-label {
  position: absolute;
  bottom: 11px;
  left: 0;
  transform: translateX(-50%);
  font-size: 9px;
  color: var(--muted);
  font-family: monospace;
  pointer-events: none;
}
.timeline-scenes {
  position: relative;
  display: flex;
  background: #090909;
  padding: 12px 0;
  min-height: 82px;
  box-sizing: border-box;
}
.scene-empty-state {
  color: var(--muted);
  font-size: 12px;
  padding: 8px 16px;
  white-space: nowrap;
  min-width: max-content;
}
.scene-card {
  position: relative;
  box-sizing: border-box;
  flex: 0 0 calc(var(--scene-duration, 15) * var(--sec-width, 15px));
  width: calc(var(--scene-duration, 15) * var(--sec-width, 15px));
  background: #181818;
  border: 1px solid var(--line);
  border-right: 0;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 58px;
  text-align: left;
  overflow: hidden;
  border-radius: 4px;
  margin-right: 2px;
}
.scene-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #0a84ff;
}
.scene-card.non-time-element {
  flex: 0 0 120px;
  width: 120px;
  background: #151515;
}
.scene-card.non-time-element::before {
  background: #30d158;
}
.scene-card.non-time-element.game-card::before {
  background: #ffd60a;
}
.scene-card:hover {
  background: var(--control-hover);
}
.scene-card.active {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.scene-card.active::before {
  background: var(--accent);
}
.scene-card-name {
  font-size: 10px;
  font-weight: 500;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 4px;
}
.scene-card.active .scene-card-name {
  color: var(--text);
}
.scene-card-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.timeline-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ff453a;
  z-index: 100;
  pointer-events: none;
  display: none;
  box-shadow: 0 0 4px rgba(255, 69, 58, 0.4);
}
.timeline-playhead.visible {
  display: block;
}
.timeline-playhead-handle {
  position: absolute;
  top: 0;
  left: -7px;
  width: 14px;
  height: 14px;
  background: #ff453a;
  border-radius: 3px 3px 0 0;
  clip-path: polygon(0% 0%, 100% 0%, 100% 60%, 50% 100%, 0% 60%);
  cursor: ew-resize;
  box-shadow: 0 2px 4px rgba(0,0,0,0.4);
}

/* Agent Bar styles */
#agent-bar {
  grid-column: 3;
  grid-row: 1 / 4;
  border-left: 1px solid var(--line);
  background: #0d0d0d;
  display: flex;
  flex-direction: row;
  overflow: visible; /* Changed from hidden to let toggle button float outside */
  width: var(--agent-bar-width, 320px);
  position: relative;
  transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1), border-left-color 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
body.agent-collapsed #agent-bar {
  border-left-color: transparent;
}
body.fullscreen-active #agent-bar {
  display: none;
}
.agent-toggle-btn {
  position: absolute;
  top: 12px;
  left: -24px; /* Float on left edge */
  width: 24px;
  height: 32px;
  background: #111111;
  border: 1px solid var(--line);
  border-right: none;
  border-radius: 6px 0 0 6px;
  color: var(--muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  z-index: 100;
  transition: color 120ms ease, background 120ms ease;
  box-shadow: -2px 0 8px rgba(0,0,0,0.15);
}
.agent-toggle-btn:hover {
  color: var(--text);
  background: var(--control-hover);
}
.agent-content-col {
  width: 320px; /* Fixed width to prevent content squeezing during collapse transition */
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  background: #0d0d0d;
  overflow: hidden;
}
.agent-header {
  padding: 13px 14px 10px;
  border-bottom: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.agent-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--muted-strong);
  text-transform: uppercase;
}
.agent-status-tag {
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted);
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: bold;
  letter-spacing: 0.5px;
}
.agent-new-chat-btn {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 120ms ease;
  line-height: 1;
}
.agent-new-chat-btn:hover {
  color: var(--text);
  border-color: var(--line-strong);
  background: rgba(255, 255, 255, 0.03);
}
.agent-new-chat-btn:active {
  transform: scale(0.95);
}
.agent-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
  overflow-y: auto;
}
.agent-placeholder-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-placeholder-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.agent-placeholder-desc {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.agent-input-area {
  padding: 12px;
  border-top: 1px solid var(--line);
  background: #111;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-input-area.drag-active {
  background: #151515;
  box-shadow: inset 0 0 0 1px var(--accent);
}
.agent-attachment-list {
  display: none;
  flex-wrap: wrap;
  gap: 6px;
}
.agent-attachment-list.has-files {
  display: flex;
}
.agent-attachment-chip {
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #080808;
  color: var(--muted-strong);
  font-size: 11px;
  line-height: 1.2;
}
.agent-attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 210px;
}
.agent-attachment-remove {
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 16px;
  padding: 0;
}
.agent-attachment-remove:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}
.agent-composer-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.agent-generation-controls {
  display: grid;
  grid-template-columns: minmax(0, 120px) minmax(0, 1fr);
  gap: 6px 8px;
  align-items: center;
}
.agent-length-field {
  grid-column: 1 / -1;
}
.agent-field {
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.agent-field-label,
.agent-check-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  white-space: nowrap;
}
.agent-select {
  height: 28px;
  width: 100%;
  padding: 0 6px;
  background: #080808;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.agent-range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.agent-range {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.agent-range-value {
  width: 8ch;
  min-width: 7.5ch;
  max-width: 11ch;
  height: 24px;
  padding: 0 5px;
  text-align: center;
  background: #080808;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--muted-strong);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  box-sizing: border-box;
}
.agent-subtitle-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  justify-self: end;
}
.agent-generation-toggle-group {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}
.agent-output-row {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 28px;
  flex-wrap: wrap;
}
.agent-output-option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted-strong);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.agent-theme-field {
  grid-column: 1 / -1;
}
.agent-teaching-style-field {
  grid-column: 1 / -1;
}
.agent-checkbox {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
}
.agent-input {
  flex: 1;
  height: 32px;
  min-height: 32px;
  max-height: 180px;
  padding: 6px 10px;
  font-size: 12px;
  background: #080808;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  resize: none;
  font-family: inherit;
  overflow-y: auto;
  box-sizing: border-box;
}
.agent-upload-btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  background: #080808;
  color: var(--muted-strong);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.agent-upload-btn:hover {
  color: var(--text);
  border-color: var(--line-strong);
  background: rgba(255, 255, 255, 0.03);
}
.agent-upload-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.agent-send-btn {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  background: var(--accent);
  color: #050505;
  border: 0;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
}
.agent-stop-btn {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  background: #ff453a;
  color: #ffffff;
  border: 0;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
}
.agent-stop-btn:hover {
  background: #ff5b52;
}
.agent-stop-btn:active {
  transform: scale(0.95);
}
.chat-message {
  display: flex;
  flex-direction: column;
  max-width: 85%;
  padding: 10px 12px;
  border-radius: 8px;
  line-height: 1.45;
  font-size: 13px;
  word-break: break-word;
}
.chat-message.user {
  align-self: flex-end;
  background: #202020;
  color: #f5f5f5;
  border: 1px solid var(--line-strong);
  border-bottom-right-radius: 2px;
}
.chat-message.agent {
  align-self: flex-start;
  background: #151515;
  color: #eeeeee;
  border: 1px solid var(--line);
  border-bottom-left-radius: 2px;
}
.chat-message.error {
  align-self: flex-start;
  background: #2b1515;
  color: #ffb4b4;
  border: 1px solid #5a2222;
  border-bottom-left-radius: 2px;
}
.chat-message p {
  margin: 0 0 8px 0;
}
.chat-message p:last-child {
  margin-bottom: 0;
}
.chat-message pre {
  margin: 6px 0;
  padding: 8px;
  background: #050505;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow-x: auto;
}
.chat-message code {
  font-family: monospace;
  background: #050505;
  padding: 2px 4px;
  border-radius: 3px;
}
.chat-message ul, .chat-message ol {
  margin: 6px 0;
  padding-left: 20px;
}
.chat-message li {
  margin-bottom: 4px;
}
.thinking-bubble {
  align-self: flex-start;
  background: #111111;
  border: 1px solid var(--line);
  border-radius: 8px;
  border-bottom-left-radius: 2px;
  padding: 10px 12px;
  color: var(--muted);
  font-style: italic;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot-flashing {
  position: relative;
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background-color: var(--muted);
  color: var(--muted);
  animation: dot-flashing 1s infinite linear;
}
@keyframes dot-flashing {
  0% { background-color: var(--muted); }
  50%, 100% { background-color: rgba(255,255,255,0.15); }
}
.agent-log-panel {
  border-top: 1px solid var(--line);
  background: #090909;
  display: flex;
  flex-direction: column;
}
.agent-log-toggle {
  width: 100%;
  height: 28px;
  padding: 0 10px;
  background: #111111;
  border: none;
  border-bottom: 1px solid var(--line);
  color: var(--muted-strong);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}
.agent-log-toggle:hover {
  background: var(--control-hover);
  color: var(--text);
}
.agent-log-toggle .chevron {
  width: 10px;
  height: 10px;
  transition: transform 150ms ease;
  color: var(--muted);
}
.agent-log-panel.expanded .chevron {
  transform: rotate(180deg);
}
.agent-log-content {
  height: 0;
  overflow: hidden;
  transition: height 180ms ease;
  background: #050505;
}
.agent-log-panel.expanded .agent-log-content {
  height: 160px; /* fixed height for expanded log drawer */
  overflow-y: auto;
}
#agent-log-text {
  margin: 0;
  padding: 8px 10px;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.45;
  color: #8c8c8c;
  white-space: pre-wrap;
  word-break: break-all;
}
button[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}
body.file-kind-mp4 .timeline-ruler {
  cursor: not-allowed;
  opacity: 0.5;
}
#publish {
  background: var(--accent);
  color: #050505;
  border: none;
  font-weight: bold;
}
#publish:hover {
  background: #ffffff;
  color: #000000;
  border-color: #ffffff;
}
#publish-dialog {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: none;
  place-items: center;
  padding: 18px;
  background: rgba(0,0,0,0.65);
}
#publish-dialog.visible {
  display: grid;
}
#publish-panel {
  width: min(540px, 100%);
  max-height: min(720px, calc(100vh - 36px));
  overflow-y: auto;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: #101010;
  box-shadow: 0 22px 70px rgba(0,0,0,0.62);
  display: flex;
  flex-direction: column;
}
#publish-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
#publish-title {
  font-weight: 650;
  color: var(--text);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
#publish-close {
  min-height: 28px;
  height: 28px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line-strong);
  color: var(--muted-strong);
}
#publish-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
#publish-form {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.form-group label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-strong);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.form-group input[type="text"],
.form-group input[type="number"],
.form-group select,
.form-group textarea {
  padding: 8px 10px;
  background: #080808;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  box-sizing: border-box;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  border-color: var(--accent);
}
#new-course-fields {
  display: none;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(255,255,255,0.015);
  margin-top: 2px;
}
#publish-status {
  font-size: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  display: none;
  line-height: 1.4;
  white-space: pre-wrap;
}
#publish-status.info {
  background: rgba(10, 132, 255, 0.1);
  border: 1px solid rgba(10, 132, 255, 0.25);
  color: #0a84ff;
}
#publish-status.success {
  background: rgba(48, 209, 88, 0.1);
  border: 1px solid rgba(48, 209, 88, 0.25);
  color: #30d158;
}
#publish-status.error {
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff453a;
}
</style>
</head>
<body>
<!-- Left panel: local folder browser plus resolve/render/publish actions. -->
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
    <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
      <button id="refresh-folder" type="button" aria-label="Refresh folder" title="Refresh folder" disabled>
        <svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
      <button id="open-folder" type="button" aria-label="Open folder" title="Open folder" disabled>
        <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
  <div id="action-row">
    <div id="resolve-control">
      <button id="sidebar-resolve" type="button">Resolve</button>
      <button id="resolve-menu-toggle" type="button" aria-label="Resolve options" title="Resolve options" aria-expanded="false"></button>
      <div id="resolve-options">
        <div class="resolve-option">
          <label for="resolve-tts-voice">TTS voice</label>
          <select id="resolve-tts-voice">
            <optgroup label="OmniVoice TTS (Local)">
              <option value="mike"${selectedAttr('mike', defaultTtsVoice)}>mike (En)</option>
              <option value="american-male-1"${selectedAttr('american-male-1', defaultTtsVoice)}>american-male-1 (En)</option>
              <option value="american-male-2"${selectedAttr('american-male-2', defaultTtsVoice)}>american-male-2 (En)</option>
              <option value="american-male-3"${selectedAttr('american-male-3', defaultTtsVoice)}>american-male-3 (En)</option>
              <option value="johnny-harris"${selectedAttr('johnny-harris', defaultTtsVoice)}>johnny-harris (En)</option>
              <option value="maruf"${selectedAttr('maruf', defaultTtsVoice)}>maruf (En)</option>
            </optgroup>
            <optgroup label="Kokoro TTS (Local)">
              <option value="am_puck">am_puck</option>
              <option value="af_heart"${selectedAttr('af_heart', defaultTtsVoice)}>af_heart</option>
              <option value="am_adam">am_adam</option>
              <option value="bf_emma">bf_emma</option>
            </optgroup>
          </select>
        </div>
        <div class="resolve-option">
          <label for="resolve-tts-speed">Voice speed</label>
          <select id="resolve-tts-speed">
            <option value="1"${selectedAttr('1', defaultTtsSpeed)}>1.0x</option>
            <option value="1.2"${selectedAttr('1.2', defaultTtsSpeed)}>1.2x</option>
            <option value="1.3"${selectedAttr('1.3', defaultTtsSpeed)}>1.3x</option>
            <option value="1.5"${selectedAttr('1.5', defaultTtsSpeed)}>1.5x</option>
          </select>
        </div>
        <div class="resolve-option" style="display: flex; align-items: center; gap: 6px; padding-top: 4px; border-top: 1px solid var(--line);">
          <input type="checkbox" id="resolve-current-only" style="width: auto; height: auto; margin: 0; cursor: pointer;">
          <label for="resolve-current-only" style="cursor: pointer; user-select: none; font-size: 11px;">Resolve current scene only</label>
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
            <optgroup label="OmniVoice TTS (Local)">
              <option value="mike"${selectedAttr('mike', defaultTtsVoice)}>mike (En)</option>
              <option value="american-male-1"${selectedAttr('american-male-1', defaultTtsVoice)}>american-male-1 (En)</option>
              <option value="american-male-2"${selectedAttr('american-male-2', defaultTtsVoice)}>american-male-2 (En)</option>
              <option value="american-male-3"${selectedAttr('american-male-3', defaultTtsVoice)}>american-male-3 (En)</option>
              <option value="johnny-harris"${selectedAttr('johnny-harris', defaultTtsVoice)}>johnny-harris (En)</option>
              <option value="maruf"${selectedAttr('maruf', defaultTtsVoice)}>maruf (En)</option>
            </optgroup>
            <optgroup label="Kokoro TTS (Local)">
              <option value="am_puck">am_puck</option>
              <option value="af_heart"${selectedAttr('af_heart', defaultTtsVoice)}>af_heart</option>
              <option value="am_adam">am_adam</option>
              <option value="bf_emma">bf_emma</option>
            </optgroup>
          </select>
        </div>
        <div class="render-option">
          <label for="render-tts-speed">Voice speed</label>
          <select id="render-tts-speed">
            <option value="1"${selectedAttr('1', defaultTtsSpeed)}>1.0x</option>
            <option value="1.2"${selectedAttr('1.2', defaultTtsSpeed)}>1.2x</option>
            <option value="1.3"${selectedAttr('1.3', defaultTtsSpeed)}>1.3x</option>
            <option value="1.5"${selectedAttr('1.5', defaultTtsSpeed)}>1.5x</option>
          </select>
        </div>
        <div class="render-option">
          <label for="render-fps">FPS</label>
          <select id="render-fps">
            <option value="10"${selectedAttr('10', defaultFps)}>10</option>
            <option value="15"${selectedAttr('15', defaultFps)}>15</option>
            <option value="24"${selectedAttr('24', defaultFps)}>24</option>
            <option value="30"${selectedAttr('30', defaultFps)}>30</option>
            <option value="60"${selectedAttr('60', defaultFps)}>60</option>
          </select>
        </div>
        <div class="render-option">
          <label for="render-resolution">Resolution</label>
          <select id="render-resolution">
            <option value="${escapeHtml(defaultRenderResolution)}" selected>${escapeHtml(defaultRenderResolution)}</option>
            <option value="1920x1080">1920x1080</option>
            <option value="1080x1920">1080x1920</option>
            <option value="720x1280">720x1280</option>
          </select>
        </div>
        <div class="render-option render-subtitle-toggle">
          <label for="render-burn-subtitle">
            <input id="render-burn-subtitle" type="checkbox"${burnSubtitleChecked}>
            <span>Burn subtitle</span>
          </label>
        </div>
        <div id="render-subtitle-options"${subtitleOptionsVisible}>
          <div class="render-option">
            <label for="render-subtitle-font">Subtitle font</label>
            <select id="render-subtitle-font">
              ${subtitleFontOptions}
            </select>
          </div>
          <div class="render-option">
            <label for="render-subtitle-font-size">Font size</label>
            <input id="render-subtitle-font-size" type="number" min="12" max="200" step="1" value="${escapeHtml(String(defaultSubtitleFontSize))}">
          </div>
          <div class="render-option">
            <label for="render-subtitle-bottom-percent">Distance from bottom (%)</label>
            <input id="render-subtitle-bottom-percent" type="number" min="0" max="50" step="0.5" value="${escapeHtml(String(defaultSubtitleBottomPercent))}">
          </div>
        </div>
      </div>
    </div>
    <button id="publish" type="button" style="grid-column: 1 / -1; width: 100%;">Publish</button>
  </div>
  <div id="job-status" role="status" aria-live="polite">
    <span id="job-status-text"></span>
    <button id="stop-job-btn" type="button" class="stop-btn">Stop</button>
  </div>
  <div id="file-list">
    <div id="sidebar-empty">Open an HTML file to scan its folder.</div>
  </div>
</aside>
<!-- Center preview: HTML/MP4 iframe playback or markdown/AVSL document preview. -->
<main id="frame-wrap">
  <div id="preview-shell">
    <iframe id="preview" title="Render preview"></iframe>
    <iframe id="preview-preload" title="Preload preview" style="display: none;"></iframe>
    <div id="subtitle-overlay" aria-live="polite"></div>
  </div>
  <article id="document-preview"></article>
</main>
<!-- Bottom controls: file actions, playback controls, viewport, and timeline scenes. -->
<section id="controls">
  <div id="file-row">
    <div id="current-file">${escapeHtml(normalizedOpenPath || 'No file selected')}</div>
    <div id="volume-control">
      <button id="volume-toggle" type="button" aria-label="Mute" title="Mute"></button>
      <div id="volume-popover">
        <input id="volume-slider" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
      </div>
    </div>
    <button id="info" type="button">Info</button>
    <button id="load">Load</button>
    <button id="reload">Reload</button>
  </div>
  <button id="play" type="button" aria-label="Play" title="Play"></button>
  <button id="seek-back" title="Back 5 seconds">&#8592;</button>
  <button id="seek-forward" title="Forward 5 seconds">&#8594;</button>
  <div id="scrub-wrap">
    <input id="scrub" type="range" min="0" max="1" step="0.001" value="0">
    <div id="interactive-marker" title="Interactive segment"></div>
    <div id="game-marker" title="Game segment"></div>
  </div>
  <div id="time">0.00 / 0.00</div>
  <button id="subtitles-toggle" type="button" aria-pressed="true" title="Closed captions">CC</button>
  <button id="live-tts-toggle" type="button" aria-pressed="true">Live TTS</button>
  <button id="narration-edit" type="button" title="Edit and regenerate one narration clip">
    <span class="take-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
    <span>Edit take</span>
  </button>
  <button id="visual-text-edit" type="button" title="Edit this scene's visual or on-screen text">Edit visual</button>
  <select id="speed">
    <option value="0.5">0.5x</option>
    <option value="1" selected>1x</option>
    <option value="1.5">1.5x</option>
    <option value="2">2x</option>
  </select>
  <select id="viewport-preset" title="Preview viewport">
    <option value="1920x1080">16:9</option>
    <option value="1080x1920">9:16</option>
    <option value="custom">Custom</option>
  </select>
  <div id="viewport">${safeInitialWidth}x${safeInitialHeight}</div>
  <div id="status">No file loaded</div>
  <button id="fullscreen" type="button" aria-label="Fullscreen" title="Fullscreen"></button>
</section>
<section id="scene-panel">
  <div class="scene-panel-header">
    <div class="scene-panel-title">Scenes</div>
    <div class="scenes-tabs" id="scenes-tabs">
      <button class="scenes-tab-btn active" data-tab="raw" type="button">Raw</button>
      <button class="scenes-tab-btn" data-tab="resolved" type="button">Resolved</button>
      <button class="scenes-tab-btn" data-tab="rendered" type="button">Rendered</button>
    </div>
  </div>
  <div id="timeline-container" class="timeline-container">
    <div id="timeline-content" class="timeline-content">
      <div id="timeline-ruler" class="timeline-ruler"></div>
      <div id="scene-list" class="timeline-scenes">
        <div style="color: var(--muted); font-size: 12px; padding: 8px 16px;">No scenes detected.</div>
      </div>
      <div id="timeline-playhead" class="timeline-playhead">
        <div class="timeline-playhead-handle"></div>
      </div>
    </div>
  </div>
</section>
<!-- Right panel: agent chat UI backed by ide-server HTTP endpoints. -->
<aside id="agent-bar">
  <button id="agent-toggle-btn" class="agent-toggle-btn" type="button" aria-label="Toggle Agent Panel" title="Toggle Agent Panel">
    <svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
  </button>
  <div class="agent-content-col">
    <div class="agent-header">
      <div class="agent-title">Lecture Agent</div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="agent-new-chat" class="agent-new-chat-btn" type="button" title="New Lecture">New Lecture</button>
        <span class="agent-status-tag">Standby</span>
      </div>
    </div>
    <div class="agent-body"></div>

    <div class="agent-input-area">
      <div id="agent-attachment-list" class="agent-attachment-list"></div>
      <div id="agent-generation-controls" class="agent-generation-controls">
        <div class="agent-field agent-length-field">
          <label class="agent-field-label" for="agent-generation-length">Len</label>
          <div class="agent-range-row">
            <input id="agent-generation-length" class="agent-range" type="range" min="0" max="1000" step="1" value="${defaultLengthSliderValue}">
            <input id="agent-generation-length-value" class="agent-range-value" type="text" value="${escapeHtml(defaultLengthLabel)}" aria-label="Generation length">
          </div>
        </div>
        <label class="agent-field" for="agent-aspect-ratio">
          <span class="agent-field-label">AR</span>
          <select id="agent-aspect-ratio" class="agent-select">
            <option value="1:1"${selectedAttr('1:1', defaultAspectRatio)}>1:1</option>
            <option value="4:3"${selectedAttr('4:3', defaultAspectRatio)}>4:3</option>
            <option value="3:4"${selectedAttr('3:4', defaultAspectRatio)}>3:4</option>
            <option value="16:9"${selectedAttr('16:9', defaultAspectRatio)}>16:9</option>
            <option value="9:16"${selectedAttr('9:16', defaultAspectRatio)}>9:16</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <div class="agent-generation-toggle-group">
          <label class="agent-subtitle-row">
            <input id="agent-enable-getimg" class="agent-checkbox" type="checkbox"${getimgChecked}>
            <span class="agent-check-label">Image download</span>
          </label>
        </div>
        <label class="agent-field agent-theme-field" for="agent-theme">
          <span class="agent-field-label">Theme</span>
          <select id="agent-theme" class="agent-select">
            <option value="default">default</option>
          </select>
        </label>
        <label class="agent-field agent-teaching-style-field" for="agent-teaching-style">
          <span class="agent-field-label">Teaching Style</span>
          <select id="agent-teaching-style" class="agent-select">
            <option value="default">default</option>
          </select>
        </label>
        <div class="agent-output-row" aria-label="Generation outputs">
          <label class="agent-output-option">
            <input id="agent-output-video" class="agent-checkbox" type="checkbox" checked>
            <span>Video</span>
          </label>
          <label class="agent-output-option">
            <input id="agent-output-interactive" class="agent-checkbox" type="checkbox">
            <span>Interactive</span>
          </label>
          <label class="agent-output-option">
            <input id="agent-output-game" class="agent-checkbox" type="checkbox">
            <span>Practice game</span>
          </label>
        </div>
      </div>
      <div class="agent-composer-row">
        <input id="agent-file-input" type="file" multiple hidden accept=".png,.jpg,.jpeg,.webp,.bmp,.pdf,.mp4,.mpeg,.mpg,.mov,.avi,.webm,.wmv,.3gp,.3gpp,.flv">
        <button id="agent-upload-btn" class="agent-upload-btn" type="button" aria-label="Attach files" title="Attach image, PDF, or video files">
          <svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05 12 20.49a6 6 0 0 1-8.49-8.49l9.9-9.9a4 4 0 0 1 5.66 5.66l-9.9 9.9a2 2 0 1 1-2.83-2.83l8.49-8.49"></path>
          </svg>
        </button>
        <textarea id="agent-chat-input" class="agent-input" placeholder="Make a video on..."></textarea>
        <button id="agent-chat-send" class="agent-send-btn" type="button">Send</button>
        <button id="agent-chat-stop" class="agent-stop-btn" type="button" style="display: none;">Stop</button>
      </div>
    </div>
  </div>
</aside>
<!-- Focused narration editor: one timeline cue, one spoken-text override, one regenerated WAV. -->
<div id="narration-dialog" role="dialog" aria-modal="true" aria-labelledby="narration-title">
  <div id="narration-panel">
    <div id="narration-header">
      <div>
        <h2 id="narration-title">Edit narration take</h2>
        <div id="narration-subtitle">Edit the caption and spoken text, then regenerate only that clip.</div>
      </div>
      <button id="narration-close" type="button" aria-label="Close narration editor">Close</button>
    </div>
    <form id="narration-form">
      <div class="narration-field">
        <label for="narration-section-select">Narration cue</label>
        <select id="narration-section-select"></select>
      </div>
      <div class="narration-field">
        <label for="narration-caption">Caption text</label>
        <textarea id="narration-caption" spellcheck="true"></textarea>
      </div>
      <div class="narration-field">
        <label for="narration-spoken-text">Spoken text</label>
        <textarea id="narration-spoken-text" spellcheck="true"></textarea>
      </div>
      <div id="narration-status" role="status" aria-live="polite"></div>
      <div id="narration-actions">
        <button id="narration-reset" type="button">Use caption text</button>
        <button id="narration-regenerate" type="submit">Regenerate this clip</button>
      </div>
    </form>
  </div>
</div>
<!-- Focused visual editor: deterministic copy fixes or isolated one-scene model edits. -->
<div id="visual-text-dialog" role="dialog" aria-modal="true" aria-labelledby="visual-text-title">
  <div id="visual-text-panel">
    <div id="visual-text-header">
      <div>
        <h2 id="visual-text-title">Edit visual</h2>
        <div id="visual-text-subtitle">Describe one focused visual change for this scene.</div>
      </div>
      <button id="visual-text-close" type="button" aria-label="Close visual editor">Close</button>
    </div>
    <form id="visual-text-form">
      <div class="visual-editor-tabs" role="tablist" aria-label="Visual edit method">
        <button id="visual-prompt-tab" class="visual-editor-tab active" type="button" role="tab" aria-selected="true">Prompt model</button>
        <button id="visual-exact-tab" class="visual-editor-tab" type="button" role="tab" aria-selected="false">Exact text</button>
      </div>
      <div id="visual-prompt-section" class="visual-editor-section">
        <div class="visual-text-field">
          <label for="visual-prompt">Change request</label>
          <textarea id="visual-prompt" spellcheck="true" placeholder="For example: Center the three-node timeline horizontally in the frame. Keep its size, content, and animation unchanged."></textarea>
        </div>
        <div id="visual-prompt-help">A fresh editor sees only this scene and this request. Narration, audio, timing, and other scenes are protected.</div>
      </div>
      <div id="visual-exact-section" class="visual-editor-section" hidden>
        <div class="visual-text-field">
          <label for="visual-text-select">Visible text</label>
          <select id="visual-text-select">
            <option value="">Choose text from this scene</option>
          </select>
        </div>
        <div class="visual-text-field">
          <label for="visual-text-find">Text to replace</label>
          <input id="visual-text-find" type="text" spellcheck="true" placeholder="Exact current wording">
        </div>
        <div class="visual-text-field">
          <label for="visual-text-replacement">Replacement</label>
          <textarea id="visual-text-replacement" spellcheck="true" placeholder="Correct wording"></textarea>
        </div>
        <div id="visual-text-help">The exact match is changed in this scene and in script.md when present. No model is used.</div>
      </div>
      <div id="visual-text-status" role="status" aria-live="polite"></div>
      <div id="visual-text-actions">
        <button id="visual-prompt-apply" type="submit">Regenerate this scene</button>
        <button id="visual-text-apply" type="submit" hidden>Apply text change</button>
      </div>
    </form>
  </div>
</div>
<!-- Metadata modal for the currently loaded lecture or rendered video. -->
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
<!-- Publish modal for copying the current lecture into the website course structure. -->
<div id="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
  <div id="publish-panel">
    <div id="publish-header">
      <div id="publish-title">Publish to course website</div>
      <button id="publish-close" type="button">Close</button>
    </div>
    <form id="publish-form">
      <div id="publish-form-content">
        <div class="form-group">
          <label for="publish-course-select">Course</label>
          <select id="publish-course-select" required>
            <option value="">-- Select Course --</option>
            <option value="__new__">[Create New Course]</option>
          </select>
        </div>
        
        <div id="new-course-fields" style="display: none; border-left: 2px solid var(--line-strong); padding-left: 12px; margin-bottom: 8px;">
          <div class="form-group">
            <label for="publish-new-course-slug">New Course Slug</label>
            <input type="text" id="publish-new-course-slug" placeholder="e.g. system-design">
          </div>
          <div class="form-group">
            <label for="publish-new-course-title">New Course Title</label>
            <input type="text" id="publish-new-course-title" placeholder="e.g. System Design Foundation">
          </div>
          <div class="form-group">
            <label for="publish-new-course-desc">New Course Description</label>
            <textarea id="publish-new-course-desc" placeholder="Course description..."></textarea>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="publish-new-course-published" checked>
            <label for="publish-new-course-published">Publish Course catalog</label>
          </div>
        </div>

        <div class="form-group">
          <label for="publish-module">Module Name</label>
          <input type="text" id="publish-module" placeholder="e.g. Module 1: Introduction">
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label for="publish-lecture-slug">Lecture Slug</label>
            <input type="text" id="publish-lecture-slug" required placeholder="e.g. intro-to-databases">
          </div>
          <div class="form-group">
            <label for="publish-lecture-order">Lecture Number / Order</label>
            <input type="number" id="publish-lecture-order" min="1" placeholder="e.g. 1">
          </div>
        </div>

        <div class="form-group">
          <label for="publish-lecture-title">Lecture Title</label>
          <input type="text" id="publish-lecture-title" required placeholder="e.g. Introduction to Databases">
        </div>

        <div class="form-group">
          <label for="publish-lecture-desc">Lecture Description</label>
          <textarea id="publish-lecture-desc" placeholder="Lecture description..."></textarea>
        </div>

        <div class="form-group checkbox-group">
          <input type="checkbox" id="publish-lecture-published" checked>
          <label for="publish-lecture-published">Make visible to students (Publish)</label>
        </div>
      </div>
      
      <div id="publish-status-box" style="display: none; border-top: 1px solid var(--line); padding: 12px 16px; background: #080808; font-family: monospace; font-size: 11px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; margin: 0 16px 12px; border-radius: 4px; border: 1px solid #331c1c;"></div>

      <div id="publish-footer">
        <button id="publish-cancel" type="button">Cancel</button>
        <button id="publish-submit" type="submit">Publish!</button>
      </div>
    </form>
  </div>
</div>
<script type="module">
import { createLecturePlayer, lectureViewerVersion } from '/lecture-viewer/player/index.mjs';

function createAgentClientId() {
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
}

function getAgentClientId() {
  return createAgentClientId();
}

const agentClientId = getAgentClientId();

// DOM handles are grouped here because this generated page is intentionally
// framework-free; each feature below mutates these nodes directly.
const folderPathLabel = document.getElementById('folder-path');
const copyFolderPathButton = document.getElementById('copy-folder-path');
const openFolderButton = document.getElementById('open-folder');
const refreshFolderButton = document.getElementById('refresh-folder');
const fileList = document.getElementById('file-list');
const jobStatus = document.getElementById('job-status');
const resolveControl = document.getElementById('resolve-control');
const sidebarResolveButton = document.getElementById('sidebar-resolve');
const resolveMenuToggle = document.getElementById('resolve-menu-toggle');
const agentChatInput = document.getElementById('agent-chat-input');
const agentChatSend = document.getElementById('agent-chat-send');
const agentChatStop = document.getElementById('agent-chat-stop');
const agentNewChat = document.getElementById('agent-new-chat');
const agentBody = document.querySelector('.agent-body');
const agentStatusTag = document.querySelector('.agent-status-tag');
const agentInputArea = document.querySelector('.agent-input-area');
const agentUploadButton = document.getElementById('agent-upload-btn');
const agentFileInput = document.getElementById('agent-file-input');
const agentAttachmentList = document.getElementById('agent-attachment-list');
const agentGenerationControls = document.getElementById('agent-generation-controls');
const agentAspectRatio = document.getElementById('agent-aspect-ratio');
const agentGenerationLength = document.getElementById('agent-generation-length');
const agentGenerationLengthValue = document.getElementById('agent-generation-length-value');
const agentEnableGetimg = document.getElementById('agent-enable-getimg');
const agentOutputVideo = document.getElementById('agent-output-video');
const agentOutputInteractive = document.getElementById('agent-output-interactive');
const agentOutputGame = document.getElementById('agent-output-game');
const agentTheme = document.getElementById('agent-theme');
const agentTeachingStyle = document.getElementById('agent-teaching-style');
let agentPhase = 'generate';

function setAgentPhase(phase) {
  agentPhase = phase === 'edit' ? 'edit' : 'generate';
  if (agentChatInput) {
    agentChatInput.placeholder = agentPhase === 'edit' ? 'Edit the video...' : 'Make a video on...';
  }
  if (agentGenerationControls) {
    agentGenerationControls.style.display = agentPhase === 'edit' ? 'none' : '';
  }
}

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
const renderBurnSubtitle = document.getElementById('render-burn-subtitle');
const renderSubtitleOptions = document.getElementById('render-subtitle-options');
const renderSubtitleFont = document.getElementById('render-subtitle-font');
const renderSubtitleFontSize = document.getElementById('render-subtitle-font-size');
const renderSubtitleBottomPercent = document.getElementById('render-subtitle-bottom-percent');
const frameWrap = document.getElementById('frame-wrap');
const previewShell = document.getElementById('preview-shell');
let frame = document.getElementById('preview');
let framePreload = document.getElementById('preview-preload');
const documentPreview = document.getElementById('document-preview');
const currentFileLabel = document.getElementById('current-file');
const infoButton = document.getElementById('info');
const infoDialog = document.getElementById('info-dialog');
const infoCloseButton = document.getElementById('info-close');
const infoContent = document.getElementById('info-content');
const loadButton = document.getElementById('load');
const reloadButton = document.getElementById('reload');
const publishButton = document.getElementById('publish');
const publishDialog = document.getElementById('publish-dialog');
const publishCloseButton = document.getElementById('publish-close');
const publishCancelButton = document.getElementById('publish-cancel');
const publishForm = document.getElementById('publish-form');
const publishCourseSelect = document.getElementById('publish-course-select');
const newCourseFields = document.getElementById('new-course-fields');
const publishNewCourseSlug = document.getElementById('publish-new-course-slug');
const publishNewCourseTitle = document.getElementById('publish-new-course-title');
const publishNewCourseDesc = document.getElementById('publish-new-course-desc');
const publishNewCoursePublished = document.getElementById('publish-new-course-published');
const publishModule = document.getElementById('publish-module');
const publishLectureSlug = document.getElementById('publish-lecture-slug');
const publishLectureTitle = document.getElementById('publish-lecture-title');
const publishLectureDesc = document.getElementById('publish-lecture-desc');
const publishLectureOrder = document.getElementById('publish-lecture-order');
const publishLecturePublished = document.getElementById('publish-lecture-published');
const publishStatusBox = document.getElementById('publish-status-box');
const publishSubmitButton = document.getElementById('publish-submit');
const playButton = document.getElementById('play');
const seekBackButton = document.getElementById('seek-back');
const seekForwardButton = document.getElementById('seek-forward');
const scrubber = document.getElementById('scrub');
const interactiveMarker = document.getElementById('interactive-marker');
const gameMarker = document.getElementById('game-marker');
const timeReadout = document.getElementById('time');
const subtitlesToggle = document.getElementById('subtitles-toggle');
const liveTtsToggle = document.getElementById('live-tts-toggle');
const narrationEditButton = document.getElementById('narration-edit');
const narrationDialog = document.getElementById('narration-dialog');
const narrationCloseButton = document.getElementById('narration-close');
const narrationForm = document.getElementById('narration-form');
const narrationSectionSelect = document.getElementById('narration-section-select');
const narrationCaption = document.getElementById('narration-caption');
const narrationSpokenText = document.getElementById('narration-spoken-text');
const narrationResetButton = document.getElementById('narration-reset');
const narrationRegenerateButton = document.getElementById('narration-regenerate');
const narrationStatus = document.getElementById('narration-status');
const visualTextEditButton = document.getElementById('visual-text-edit');
const visualTextDialog = document.getElementById('visual-text-dialog');
const visualTextSubtitle = document.getElementById('visual-text-subtitle');
const visualTextCloseButton = document.getElementById('visual-text-close');
const visualTextForm = document.getElementById('visual-text-form');
const visualTextSelect = document.getElementById('visual-text-select');
const visualTextFind = document.getElementById('visual-text-find');
const visualTextReplacement = document.getElementById('visual-text-replacement');
const visualTextApplyButton = document.getElementById('visual-text-apply');
const visualTextStatus = document.getElementById('visual-text-status');
const visualPromptTab = document.getElementById('visual-prompt-tab');
const visualExactTab = document.getElementById('visual-exact-tab');
const visualPromptSection = document.getElementById('visual-prompt-section');
const visualExactSection = document.getElementById('visual-exact-section');
const visualPrompt = document.getElementById('visual-prompt');
const visualPromptApplyButton = document.getElementById('visual-prompt-apply');
const subtitleOverlay = document.getElementById('subtitle-overlay');
const volumeToggle = document.getElementById('volume-toggle');
const volumeSlider = document.getElementById('volume-slider');
const speedSelect = document.getElementById('speed');
const viewportPreset = document.getElementById('viewport-preset');
const fullscreenButton = document.getElementById('fullscreen');
const viewportText = document.getElementById('viewport');
const statusText = document.getElementById('status');
const VIEWER_VERSION = lectureViewerVersion;

// Page-level state mirrors the current file, viewport, folder contents, scene
// list, and active server job. The player keeps its own playback state.
let currentFilePath = '${escapeJsString(normalizedOpenPath)}';
let viewerCommandVersion = 0;
let videoMetadata = {};
let renderViewport = {
  width: ${safeInitialWidth},
  height: ${safeInitialHeight}
};
const configuredDefaults = ${JSON.stringify({
    ttsVoice: defaultTtsVoice,
    ttsSpeed: defaultTtsSpeed,
    fps: defaultFps,
    renderResolution: defaultRenderResolution,
    renderWidth: defaultRenderViewport.width,
    renderHeight: defaultRenderViewport.height,
    aspectRatio: defaultAspectRatio,
    generationLength: defaultLengthLabel,
    defaultTheme: agentConfig.defaultTheme || 'default',
    defaultTeachingStyle: agentConfig.defaultTeachingStyle || 'default'
  })};
let userViewportOverride = false;
let controlsHideTimer = 0;
let lastPlayerState = null;
let activeJobTimer = 0;
let activeJobStartedAt = 0;
let activeJobLabel = '';
let currentBrowserFolder = '';
let currentScenesList = [];
let currentSecWidth = 15;

let currentSceneTab = 'raw';
let globalEntries = [];
let narrationSections = [];
let visualEditorMode = 'prompt';
let visualTextCandidatesLoaded = false;

function isRenderedKind(name) {
  return /^rendered.*\.mp4$/i.test(name) || (name.toLowerCase().endsWith('.mp4') && !name.toLowerCase().startsWith('temp_'));
}

function getSceneTabForFile(filePath) {
  const name = fileBaseName(filePath).toLowerCase();
  if (isResolvedHtmlKind(name)) return 'resolved';
  if (isIndexHtmlKind(name)) return 'raw';
  if (isRenderedKind(name)) return 'rendered';
  return null;
}

function updateTabUI() {
  const tabsContainer = document.getElementById('scenes-tabs');
  if (!tabsContainer) return;
  const buttons = tabsContainer.querySelectorAll('.scenes-tab-btn');
  buttons.forEach(btn => {
    const tabName = btn.getAttribute('data-tab');
    btn.classList.toggle('active', tabName === currentSceneTab);
  });
}

async function switchSceneTab(tab) {
  if (currentSceneTab === tab) return;
  const oldTab = currentSceneTab;
  
  // Find current scene index
  let currentIndex = -1;
  const currentList = getFilesForTab(oldTab);
  if (currentList) {
    currentIndex = currentList.findIndex(f => f.path === currentFilePath);
  }
  
  currentSceneTab = tab;
  updateTabUI();
  
  // Get target files
  const targetList = getFilesForTab(tab);
  if (targetList && targetList.length > 0) {
    let targetFile = null;
    if (currentIndex >= 0 && currentIndex < targetList.length) {
      targetFile = targetList[currentIndex];
    } else {
      targetFile = targetList[0];
    }
    if (targetFile) {
      await loadFile(targetFile.path);
    }
  } else {
    // If no files in target tab, just update scenes panel
    updateScenePanel(globalEntries);
  }
}

function getFilesForTab(tab) {
  const filesOnly = globalEntries.filter(file => file.type === 'file');
  if (tab === 'raw') {
    const raw = filesOnly.filter(file => isIndexHtmlKind(file.name));
    raw.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return raw;
  }
  if (tab === 'resolved') {
    const resolved = filesOnly.filter(file => isResolvedHtmlKind(file.name));
    resolved.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return resolved;
  }
  if (tab === 'rendered') {
    const rendered = filesOnly.filter(file => isRenderedKind(file.name));
    rendered.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return rendered;
  }
  return [];
}

const sceneListContainer = document.getElementById('scene-list');
const agentToggleBtn = document.getElementById('agent-toggle-btn');
const timelineRuler = document.getElementById('timeline-ruler');

// The reusable player owns iframe playback; this shell owns files, controls,
// viewport sizing, timeline visualization, and server commands.
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

function narrationCuesFromPlayer() {
  const state = playerState();
  return (Array.isArray(state.timeline) ? state.timeline : [])
    .filter(cue => cue?.item?.kind === 'narration+visual' && cue.item.id && cue.item.text)
    .map(cue => ({
      id: String(cue.item.id),
      start: Number(cue.start) || 0,
      end: Number(cue.end) || 0,
      caption: String(cue.item.text),
      spokenText: String(cue.item.ttsText || cue.item.text)
    }));
}

function selectedNarrationSection() {
  return narrationSections.find(section => section.id === narrationSectionSelect.value) || null;
}

function renderNarrationSelection() {
  const section = selectedNarrationSection();
  if (!section) return;
  narrationCaption.value = section.caption;
  narrationSpokenText.value = section.spokenText;
  narrationStatus.textContent = '';
  narrationStatus.className = '';
}

function openNarrationDialog() {
  narrationSections = narrationCuesFromPlayer();
  if (!narrationSections.length) {
    setStatus('No narration cues are available in this file');
    return;
  }

  const currentTime = Number(playerState().time) || 0;
  const active = narrationSections.find(section => currentTime >= section.start && currentTime < section.end) ||
    narrationSections.reduce((nearest, section) =>
      Math.abs(section.start - currentTime) < Math.abs(nearest.start - currentTime) ? section : nearest
    );

  narrationSectionSelect.textContent = '';
  for (const section of narrationSections) {
    const option = document.createElement('option');
    option.value = section.id;
    const excerpt = section.caption.length > 58 ? section.caption.slice(0, 55) + '...' : section.caption;
    option.textContent = section.id + '  ·  ' + formatTimecode(section.start) + '  ·  ' + excerpt;
    narrationSectionSelect.appendChild(option);
  }
  narrationSectionSelect.value = active.id;
  renderNarrationSelection();
  narrationDialog.classList.add('visible');
  narrationSpokenText.focus();
  narrationSpokenText.select();
}

function closeNarrationDialog() {
  narrationDialog.classList.remove('visible');
  narrationStatus.textContent = '';
  narrationStatus.className = '';
}

async function regenerateNarrationSection(event) {
  event.preventDefault();
  const section = selectedNarrationSection();
  const captionText = narrationCaption.value.trim();
  const spokenText = narrationSpokenText.value.trim();
  if (!section || !captionText || !spokenText) {
    narrationStatus.textContent = 'Caption and spoken text cannot be empty.';
    narrationStatus.className = 'error';
    return;
  }

  narrationRegenerateButton.disabled = true;
  narrationCloseButton.disabled = true;
  narrationStatus.textContent = 'Regenerating ' + section.id + ' with ' + resolveTtsVoice.value + '...';
  narrationStatus.className = '';
  startJobStatus('Regenerating narration cue ' + section.id);
  try {
    const response = await fetch('/regenerate-narration-section', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: currentFilePath,
        sectionId: section.id,
        text: captionText,
        ttsText: spokenText,
        ttsVoice: resolveTtsVoice.value,
        ttsSpeed: resolveTtsSpeed.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Narration regeneration failed');

    section.caption = captionText;
    section.spokenText = spokenText;
    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    player.seek(section.start);
    closeNarrationDialog();
    setStatus('Regenerated narration cue ' + section.id);
    finishJobStatus('Done: ' + section.id);
    playNotificationSound(true);
  } catch (error) {
    narrationStatus.textContent = error.message;
    narrationStatus.className = 'error';
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    narrationRegenerateButton.disabled = false;
    narrationCloseButton.disabled = false;
  }
}

function visibleTextFromCurrentFrame() {
  let doc;
  try {
    doc = frame.contentDocument;
  } catch {
    return [];
  }
  if (!doc?.body) return [];

  const isVisible = element => {
    let current = element;
    while (current && current !== doc.documentElement) {
      const style = frame.contentWindow.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      current = current.parentElement;
    }
    return element.getClientRects().length > 0;
  };

  const found = new Set();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName) || !isVisible(parent)) continue;
    const text = node.textContent.replace(/\\s+/g, ' ').trim();
    if (text && text.length <= 500) found.add(text);
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function setVisualEditorMode(mode) {
  visualEditorMode = mode === 'exact' ? 'exact' : 'prompt';
  const isPrompt = visualEditorMode === 'prompt';
  visualPromptTab.classList.toggle('active', isPrompt);
  visualExactTab.classList.toggle('active', !isPrompt);
  visualPromptTab.setAttribute('aria-selected', String(isPrompt));
  visualExactTab.setAttribute('aria-selected', String(!isPrompt));
  visualPromptSection.hidden = !isPrompt;
  visualExactSection.hidden = isPrompt;
  visualPromptApplyButton.hidden = !isPrompt;
  visualTextApplyButton.hidden = isPrompt;
  visualTextSubtitle.textContent = isPrompt
    ? 'Describe one focused visual change for this scene.'
    : 'Correct exact on-screen wording without using the model.';
}

async function loadVisualTextCandidates() {
  if (visualTextCandidatesLoaded) return;
  visualTextStatus.textContent = 'Reading text from this scene...';
  visualTextStatus.className = '';
  let candidates = visibleTextFromCurrentFrame();
  try {
    const response = await fetch('/visual-text-candidates?file=' + encodeURIComponent(currentFilePath));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not read scene text');
    candidates = [...new Set([...candidates, ...(Array.isArray(payload.candidates) ? payload.candidates : [])])]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  } catch (error) {
    visualTextStatus.textContent = error.message;
    visualTextStatus.className = 'error';
  }
  visualTextSelect.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = candidates.length ? 'Choose text from the current frame' : 'No visible text detected — enter it below';
  visualTextSelect.appendChild(placeholder);
  for (const text of candidates) {
    const option = document.createElement('option');
    option.value = text;
    option.textContent = text.length > 92 ? text.slice(0, 89) + '...' : text;
    visualTextSelect.appendChild(option);
  }
  visualTextFind.value = '';
  visualTextReplacement.value = '';
  if (candidates.length) {
    visualTextStatus.textContent = '';
    visualTextStatus.className = '';
  }
  visualTextCandidatesLoaded = true;
  if (candidates.length) visualTextSelect.focus();
  else visualTextFind.focus();
}

function openVisualTextDialog() {
  visualTextDialog.classList.add('visible');
  visualTextCandidatesLoaded = false;
  visualPrompt.value = '';
  visualTextFind.value = '';
  visualTextReplacement.value = '';
  visualTextStatus.textContent = '';
  visualTextStatus.className = '';
  setVisualEditorMode('prompt');
  visualPrompt.focus();
}

function closeVisualTextDialog() {
  visualTextDialog.classList.remove('visible');
  visualTextStatus.textContent = '';
  visualTextStatus.className = '';
}

async function applyVisualTextEdit(event) {
  event?.preventDefault();
  const oldText = visualTextFind.value.trim();
  const newText = visualTextReplacement.value.trim();
  if (!oldText || !newText) {
    visualTextStatus.textContent = 'Choose or enter the current text and its replacement.';
    visualTextStatus.className = 'error';
    return;
  }
  if (oldText === newText) {
    visualTextStatus.textContent = 'The replacement is unchanged.';
    visualTextStatus.className = 'error';
    return;
  }

  setVisualEditorBusy(true);
  visualTextStatus.textContent = 'Applying exact text change...';
  visualTextStatus.className = '';
  try {
    const currentTime = Number(playerState().time) || 0;
    const response = await fetch('/edit-visual-text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: currentFilePath,
        oldText,
        newText,
        ttsVoice: resolveTtsVoice.value,
        ttsSpeed: resolveTtsSpeed.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Visual text edit failed');

    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    player.seek(currentTime);
    closeVisualTextDialog();
    const count = Number(payload.edits?.htmlReplacements) || 1;
    setStatus('Updated ' + count + ' visual text match' + (count === 1 ? '' : 'es'));
  } catch (error) {
    visualTextStatus.textContent = error.message;
    visualTextStatus.className = 'error';
  } finally {
    setVisualEditorBusy(false);
  }
}

function setVisualEditorBusy(isBusy) {
  visualTextApplyButton.disabled = isBusy;
  visualPromptApplyButton.disabled = isBusy;
  visualTextCloseButton.disabled = isBusy;
  visualPromptTab.disabled = isBusy;
  visualExactTab.disabled = isBusy;
}

async function regenerateVisualScene(event) {
  event?.preventDefault();
  const instruction = visualPrompt.value.trim();
  if (!instruction) {
    visualTextStatus.textContent = 'Describe the visual change to make.';
    visualTextStatus.className = 'error';
    return;
  }

  setVisualEditorBusy(true);
  visualTextStatus.textContent = 'Editing only this scene...';
  visualTextStatus.className = '';
  startJobStatus('Editing visual in ' + fileBaseName(currentFilePath));
  try {
    const currentTime = Number(playerState().time) || 0;
    const response = await fetch('/regenerate-visual-scene', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: currentFilePath,
        instruction,
        ttsVoice: resolveTtsVoice.value,
        ttsSpeed: resolveTtsSpeed.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Visual scene edit failed');

    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    player.seek(currentTime);
    closeVisualTextDialog();
    setStatus('Updated visual in ' + fileBaseName(payload.path));
    finishJobStatus('Visual edit complete');
    playNotificationSound(true);
  } catch (error) {
    visualTextStatus.textContent = error.message;
    visualTextStatus.className = 'error';
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    setVisualEditorBusy(false);
  }
}

function submitVisualEditor(event) {
  if (visualEditorMode === 'exact') {
    applyVisualTextEdit(event);
  } else {
    regenerateVisualScene(event);
  }
}

function resizePreview() {
  const wrapRect = frameWrap.getBoundingClientRect();
  const margin = isFullscreenActive() ? 0 : 32;
  const availableWidth = Math.max(1, wrapRect.width - margin);
  const availableHeight = Math.max(1, wrapRect.height - margin);
  const scale = Math.min(availableWidth / renderViewport.width, availableHeight / renderViewport.height);

  previewShell.style.width = Math.floor(renderViewport.width * scale) + 'px';
  previewShell.style.height = Math.floor(renderViewport.height * scale) + 'px';
  
  [frame, framePreload].forEach(f => {
    if (!f) return;
    f.width = renderViewport.width;
    f.height = renderViewport.height;
    f.style.width = renderViewport.width + 'px';
    f.style.height = renderViewport.height + 'px';
    f.style.transform = 'scale(' + scale + ')';
  });
  
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

// Status helpers keep labels, busy state, and long-running job timers aligned.
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
  params.set('ttsVoice', resolveTtsVoice.value || configuredDefaults.ttsVoice);
  params.set('ttsSpeed', resolveTtsSpeed.value || configuredDefaults.ttsSpeed);
  const currentOnlyCheckbox = document.getElementById('resolve-current-only');
  if (currentOnlyCheckbox && currentOnlyCheckbox.checked) {
    params.set('currentOnly', '1');
  }
  return params.toString();
}

function renderQuery() {
  const params = new URLSearchParams();
  const [width, height] = String(renderResolution.value || configuredDefaults.renderResolution).split('x');
  params.set('file', currentFilePath);
  params.set('ttsVoice', renderTtsVoice.value || configuredDefaults.ttsVoice);
  params.set('ttsSpeed', renderTtsSpeed.value || configuredDefaults.ttsSpeed);
  params.set('fps', renderFps.value || configuredDefaults.fps);
  params.set('width', width || String(configuredDefaults.renderWidth));
  params.set('height', height || String(configuredDefaults.renderHeight));
  params.set('burnSubtitle', renderBurnSubtitle.checked ? '1' : '0');
  if (renderBurnSubtitle.checked) {
    params.set('subtitleFont', renderSubtitleFont.value);
    params.set('subtitleFontSize', renderSubtitleFontSize.value);
    params.set('subtitleBottomPercent', renderSubtitleBottomPercent.value);
  }
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

// Inline SVG icons avoid extra assets in this self-contained generated page.
const controlIcons = {
  play: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  volume: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  volumeMuted: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M18 9l4 4m0-4l-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fullscreen: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fullscreenExit: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v4H5M19 9h-4V5M15 19v-4h4M5 15h4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};

// Icon buttons share accessible labels so compact controls remain inspectable.
function setIconButton(button, icon, label) {
  button.innerHTML = controlIcons[icon] || '';
  button.setAttribute('aria-label', label);
  button.title = label;
}

// File-kind helpers centralize which UI actions are valid for the selected path.
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
  return ['txt', 'md', 'avsl'].includes(fileExtension(filePath));
}

function currentFileKind() {
  return fileBaseName(currentFilePath).toLowerCase();
}

function isIndexHtmlKind(kind) {
  return /^index.*\\.html$/i.test(kind);
}

function isResolvedHtmlKind(kind) {
  return /^resolved.*\\.html$/i.test(kind);
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

// Lightweight markdown is enough for local docs; avoiding a parser keeps this
// generated IDE page dependency-free.
function renderMarkdown(markdown) {
  const lines = String(markdown || '').split(/\\r?\\n/);
  const html = [];
  let paragraph = [];
  let listOpen = false;
  let codeOpen = false;

  const parseInline = (text) => {
    let res = String(text);
    res = res.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
    res = res.replace(/__(.*?)__/g, '<strong>$1</strong>');
    res = res.replace(/\\*(.*?)\\*/g, '<em>$1</em>');
    res = res.replace(/_(.*?)_/g, '<em>$1</em>');
    res = res.replace(new RegExp(String.fromCharCode(96) + '(.*?)' + String.fromCharCode(96), 'g'), '<code>$1</code>');
    res = res.replace(/\\\[(.*?)\\\]\\\((.*?)\\\)/g, '<a href="$2" target="_blank" style="color: #6fc2ff; text-decoration: underline;">$1</a>');
    return res;
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push('<p>' + parseInline(paragraph.map(escapeText).join(' ')) + '</p>');
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
      html.push('<h' + level + '>' + parseInline(escapeText(heading[2])) + '</h' + level + '>');
      continue;
    }

    const listItem = line.match(/^\\s*[-*]\\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push('<li>' + parseInline(escapeText(listItem[1])) + '</li>');
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

// AVSL preview highlights {visual: ...} blocks while preserving narration text.
function findAvslVisualEnd(text, startIndex) {
  let quote = '';
  let escaped = false;

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === '\\\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '}') {
      return index + 1;
    }
  }

  return text.length;
}

function appendAvslSpan(parent, className, text) {
  if (!text) return;
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  parent.append(span);
}

function renderAvsl(avsl) {
  const fragment = document.createDocumentFragment();
  const lines = String(avsl || '').split(/\\r?\\n/);

  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'avsl-line';
    let cursor = 0;

    while (cursor < line.length) {
      const start = line.indexOf('{visual:', cursor);
      if (start === -1) {
        appendAvslSpan(row, 'avsl-narration', line.slice(cursor));
        break;
      }

      appendAvslSpan(row, 'avsl-narration', line.slice(cursor, start));
      const end = findAvslVisualEnd(line, start + 8);
      appendAvslSpan(row, 'avsl-visual', line.slice(start, end));
      cursor = end;
    }

    fragment.append(row);
  }

  return fragment;
}

// Document files are displayed in the center panel instead of loaded into the
// lecture player iframe.
async function loadDocumentFile(filePath) {
  player.pause();
  setPreviewMode('document');
  setCurrentFile(filePath);
  videoMetadata = {};
  lastPlayerState = null;
  updateControls(player.snapshot());
  const extension = fileExtension(currentFilePath);
  documentPreview.classList.toggle('avsl-preview', extension === 'avsl');
  documentPreview.textContent = 'Loading...';
  setStatus('Loading document...');

  try {
    const response = await fetch(fileUrl(currentFilePath), { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) throw new Error(text || 'Document load failed');

    if (extension === 'md') {
      documentPreview.innerHTML = renderMarkdown(text);
    } else if (extension === 'avsl') {
      documentPreview.textContent = '';
      documentPreview.append(renderAvsl(text));
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
  const canResolve = isIndexHtmlKind(kind);
  const canRender = isIndexHtmlKind(kind) || isResolvedHtmlKind(kind);
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
  narrationEditButton.disabled = !canRender;
  visualTextEditButton.disabled = !canRender;
}

function setActionBusy(isBusy, message, action = '') {
  for (const button of [sidebarResolveButton, resolveMenuToggle, sidebarRenderButton, renderMenuToggle, narrationEditButton, visualTextEditButton]) {
    button.disabled = isBusy;
  }
  sidebarResolveButton.textContent = isBusy && action === 'resolve' ? 'Resolving...' : 'Resolve';
  sidebarRenderButton.textContent = isBusy && action === 'render' ? 'Rendering...' : 'Render';
  if (message) setStatus(message);
}

// Render the server-provided folder listing into the sidebar, then refresh the
// scene timeline from the same entries.
function renderFolderFiles(payload) {
  folderPathLabel.textContent = payload?.folder || 'No file selected';
  folderPathLabel.title = payload?.folder || '';
  currentBrowserFolder = payload?.folder || '';
  openFolderButton.disabled = !currentBrowserFolder;
  refreshFolderButton.disabled = !currentBrowserFolder;
  copyFolderPathButton.disabled = !currentBrowserFolder;
  fileList.textContent = '';

  const entries = Array.isArray(payload?.entries)
    ? payload.entries
    : (Array.isArray(payload?.files) ? payload.files.map(file => ({ ...file, type: 'file' })) : []);

  globalEntries = entries;

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

  updateScenePanel(entries);
}

// Build the bottom scene strip for raw, resolved, or rendered files. Durations
// come from server metadata when available and fall back to a preview estimate.
function updateScenePanel(entries) {
  let filesOnly = entries;
  if (entries.length > 0 && (entries[0].type === 'directory' || !('timelineStart' in entries[0]))) {
    filesOnly = entries.filter(file => file.type === 'file');
  }

  const rawFiles = filesOnly.filter(file => isIndexHtmlKind(file.name));
  rawFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const resolvedFiles = filesOnly.filter(file => isResolvedHtmlKind(file.name));
  resolvedFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const renderedFiles = filesOnly.filter(file => isRenderedKind(file.name));
  renderedFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const getFileSuffix = (name) => {
    const match = name.match(/^(?:index|resolved|rendered)(.*)\.(?:html|mp4)$/i);
    return match ? match[1] : '';
  };

  renderedFiles.forEach(rf => {
    if (!rf.duration) {
      const suffix = getFileSuffix(rf.name);
      const matchingResolved = resolvedFiles.find(f => getFileSuffix(f.name) === suffix);
      if (matchingResolved && matchingResolved.duration) {
        rf.duration = matchingResolved.duration;
      } else {
        const matchingRaw = rawFiles.find(f => getFileSuffix(f.name) === suffix);
        if (matchingRaw && matchingRaw.duration) {
          rf.duration = matchingRaw.duration;
        }
      }
    }
  });

  let activeFiles = [];
  if (currentSceneTab === 'raw') {
    activeFiles = [...rawFiles];
  } else if (currentSceneTab === 'resolved') {
    activeFiles = [...resolvedFiles];
  } else if (currentSceneTab === 'rendered') {
    activeFiles = [...renderedFiles];
  }

  if (currentSceneTab === 'raw' || currentSceneTab === 'resolved') {
    const interactiveFile = filesOnly.find(file => file.name.toLowerCase() === 'interactive.html');
    if (interactiveFile) {
      activeFiles.push({
        ...interactiveFile,
        isNonTime: true,
        duration: 0
      });
    }
    const gameFile = filesOnly.find(file => file.name.toLowerCase() === 'game.html');
    if (gameFile) {
      activeFiles.push({
        ...gameFile,
        isNonTime: true,
        duration: 0
      });
    }
  }

  let accumulatedTime = 0;
  activeFiles.forEach(file => {
    if (file.isNonTime) {
      file.duration = 0;
      file.timelineStart = accumulatedTime;
    } else {
      const dur = Number(file.duration);
      file.duration = (Number.isFinite(dur) && dur > 0) ? dur : 15;
      file.timelineStart = accumulatedTime;
      accumulatedTime += file.duration;
    }
  });
  
  currentScenesList = activeFiles;
  
  const timelineContent = document.getElementById('timeline-content');
  const container = document.getElementById('timeline-container');
  if (!timelineContent || !container) return;
  
  const totalDuration = accumulatedTime;
  const containerWidth = container.clientWidth;
  if (containerWidth > 0 && totalDuration > 0) {
    currentSecWidth = Math.max(3, (containerWidth - 24) / totalDuration);
  } else {
    currentSecWidth = 15;
  }
  
  timelineContent.style.setProperty('--sec-width', currentSecWidth + 'px');
  
  const totalWidth = totalDuration * currentSecWidth;
  timelineContent.style.width = totalWidth + 'px';
  
  const ruler = document.getElementById('timeline-ruler');
  if (ruler) {
    ruler.innerHTML = '';
    let interval = 5;
    if (totalDuration > 120) interval = 10;
    if (totalDuration > 300) interval = 30;
    if (totalDuration > 900) interval = 60;
    
    for (let sec = 0; sec <= totalDuration; sec += interval) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = (sec * currentSecWidth) + 'px';
      
      tick.classList.add('major');
      const label = document.createElement('span');
      label.className = 'ruler-label';
      label.textContent = formatTimeShort(sec);
      tick.appendChild(label);
      ruler.appendChild(tick);
    }
  }
  
  if (!sceneListContainer) return;
  sceneListContainer.innerHTML = '';
  
  if (activeFiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scene-empty-state';
    empty.textContent = 'No ' + currentSceneTab + ' files found.';
    sceneListContainer.appendChild(empty);
    return;
  }
  
  activeFiles.forEach((file, index) => {
    const isCurrent = file.path === currentFilePath;
    const card = document.createElement('div');
    card.className = 'scene-card' + (isCurrent ? ' active' : '');
    if (file.isNonTime) {
      card.classList.add('non-time-element');
      const isGame = file.name.toLowerCase() === 'game.html';
      if (isGame) {
        card.classList.add('game-card');
      }
    } else {
      card.style.setProperty('--scene-duration', file.duration);
    }
    
    const label = document.createElement('div');
    label.className = 'scene-card-label';
    if (file.isNonTime) {
      label.textContent = file.name.toLowerCase() === 'game.html' ? 'Game' : 'Interactive';
    } else {
      label.textContent = 'Scene ' + (index + 1);
    }
    
    const name = document.createElement('div');
    name.className = 'scene-card-name';
    if (file.isNonTime) {
      name.textContent = file.name;
    } else {
      name.textContent = file.name + ' (' + file.duration.toFixed(1) + 's)';
    }
    
    card.appendChild(label);
    card.appendChild(name);
    
    card.addEventListener('click', () => {
      if (file.path !== currentFilePath) {
        loadFile(file.path);
      }
    });
    
    sceneListContainer.appendChild(card);
  });
  
  updatePlayheadPosition();
}

function formatTimeShort(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return minutes + ':' + String(secs).padStart(2, '0');
}

function formatTimecode(seconds) {
  seconds = Math.max(0, seconds);
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  return minutes + ':' + String(secs).padStart(2, '0') + '.' + String(hundredths).padStart(2, '0');
}

let isDraggingTimeline = false;
let isLoadFilePending = false;

// Timeline dragging maps a global lecture time back to the correct scene file.
function handleTimelinePointerDown(event) {
  if (event.button !== 0) return;
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  if (isMp4) return;
  isDraggingTimeline = true;
  if (timelineRuler) {
    timelineRuler.setPointerCapture(event.pointerId);
  }
  seekFromTimelineEvent(event);
}

function handleTimelinePointerMove(event) {
  if (!isDraggingTimeline) return;
  seekFromTimelineEvent(event);
}

function handleTimelinePointerUp(event) {
  if (!isDraggingTimeline) return;
  isDraggingTimeline = false;
  if (timelineRuler) {
    try {
      timelineRuler.releasePointerCapture(event.pointerId);
    } catch (e) {}
  }
}

async function seekFromTimelineEvent(event) {
  if (!timelineRuler || currentScenesList.length === 0) return;
  const rect = timelineRuler.getBoundingClientRect();
  const clickedX = event.clientX - rect.left;
  const clickedTime = Math.max(0, clickedX / currentSecWidth);
  await seekToGlobalTime(clickedTime);
}

// Convert one global lecture time into a scene file plus local time inside that
// scene. If the target scene is already preloaded, swap iframes instead of
// waiting for a fresh load.
async function seekToGlobalTime(globalTime) {
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  if (isMp4) return;
  
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  if (activeScene && activeScene.isNonTime) return;
  
  if (currentScenesList.length === 0) {
    player.seek(globalTime);
    return;
  }
  
  let targetScene = currentScenesList.find(file => globalTime >= file.timelineStart && globalTime < file.timelineStart + file.duration);
  if (!targetScene) {
    targetScene = currentScenesList[currentScenesList.length - 1];
  }
  if (!targetScene) return;
  
  const localTime = Math.max(0, Math.min(targetScene.duration, globalTime - targetScene.timelineStart));
  const wasPlaying = playerState().playing;
  
  if (targetScene.path !== currentFilePath) {
    if (preloadedFilePath === targetScene.path && !isPreloading) {
      await swapToPreloadedScene(targetScene.path, wasPlaying);
      player.seek(localTime);
    } else {
      if (isLoadFilePending) return;
      isLoadFilePending = true;
      const success = await loadFile(targetScene.path);
      isLoadFilePending = false;
      if (success) {
        player.seek(localTime);
        if (wasPlaying) player.play();
        else player.pause();
      }
    }
  } else {
    player.seek(localTime);
  }
}

async function seekGlobalBy(seconds) {
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  if (isMp4) return;

  const state = playerState();
  if (!state.loaded) return;
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  const globalTime = activeScene ? (activeScene.timelineStart + state.time) : state.time;
  const totalDuration = currentScenesList.length > 0
    ? currentScenesList.reduce((acc, file) => acc + file.duration, 0)
    : state.duration;
  const targetTime = Math.max(0, Math.min(totalDuration, globalTime + seconds));
  await seekToGlobalTime(targetTime);
}

// Keep the visual playhead aligned with the active scene and update scene
// duration metadata once the player knows the true duration.
function updatePlayheadPosition(state = playerState()) {
  const playhead = document.getElementById('timeline-playhead');
  const container = document.getElementById('timeline-container');
  if (!playhead || !container) return;
  
  if (!state.loaded || currentScenesList.length === 0 || state.interactiveActive || state.gameActive) {
    playhead.classList.remove('visible');
    return;
  }
  
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  if (!activeScene || activeScene.isNonTime) {
    playhead.classList.remove('visible');
    return;
  }
  
  if (state.duration > 0 && Math.abs(activeScene.duration - state.duration) > 0.5) {
    activeScene.duration = state.duration;
    
    let accumulatedTime = 0;
    currentScenesList.forEach(file => {
      file.timelineStart = accumulatedTime;
      accumulatedTime += file.duration;
    });
    
    const totalDuration = accumulatedTime;
    const containerWidth = container.clientWidth;
    if (containerWidth > 0 && totalDuration > 0) {
      currentSecWidth = Math.max(3, (containerWidth - 24) / totalDuration);
    }
    
    const timelineContent = document.getElementById('timeline-content');
    if (timelineContent) {
      timelineContent.style.setProperty('--sec-width', currentSecWidth + 'px');
      const totalWidth = accumulatedTime * currentSecWidth;
      timelineContent.style.width = totalWidth + 'px';
    }
    
    const cards = sceneListContainer.querySelectorAll('.scene-card');
    currentScenesList.forEach((file, index) => {
      const card = cards[index];
      if (card) {
        if (!file.isNonTime) {
          card.style.setProperty('--scene-duration', file.duration);
          const nameDiv = card.querySelector('.scene-card-name');
          if (nameDiv) nameDiv.textContent = file.name + ' (' + file.duration.toFixed(1) + 's)';
        }
      }
    });
    
    const ruler = document.getElementById('timeline-ruler');
    if (ruler) {
      ruler.innerHTML = '';
      let interval = 5;
      if (totalDuration > 120) interval = 10;
      if (totalDuration > 300) interval = 30;
      if (totalDuration > 900) interval = 60;
      
      for (let sec = 0; sec <= totalDuration; sec += interval) {
        const tick = document.createElement('div');
        tick.className = 'ruler-tick';
        tick.style.left = (sec * currentSecWidth) + 'px';
        tick.classList.add('major');
        const label = document.createElement('span');
        label.className = 'ruler-label';
        label.textContent = formatTimeShort(sec);
        tick.appendChild(label);
        ruler.appendChild(tick);
      }
    }
  }
  
  const globalTime = activeScene.timelineStart + state.time;
  const playheadLeft = globalTime * currentSecWidth;
  
  playhead.style.left = playheadLeft + 'px';
  playhead.classList.add('visible');
  
  if (state.playing) {
    container.scrollLeft = playheadLeft - container.clientWidth / 2;
  } else {
    const scrollLeft = container.scrollLeft;
    const clientWidth = container.clientWidth;
    if (playheadLeft < scrollLeft || playheadLeft > scrollLeft + clientWidth - 40) {
      container.scrollLeft = playheadLeft - clientWidth / 2;
    }
  }
}

let preloadedFilePath = '';
let isPreloading = false;

// Preload the next scene in a hidden iframe to reduce gaps during playback.
function preloadNextScene() {
  if (currentScenesList.length === 0) return;
  const currentIndex = currentScenesList.findIndex(file => file.path === currentFilePath);
  if (currentIndex > -1 && currentIndex < currentScenesList.length - 1) {
    const nextScene = currentScenesList[currentIndex + 1];
    const nextPath = nextScene.path;
    
    if (preloadedFilePath === nextPath || isPreloading) return;
    
    preloadedFilePath = nextPath;
    isPreloading = true;
    
    framePreload.src = fileUrl(nextPath);
    
    const handlePreloadLoad = () => {
      isPreloading = false;
      framePreload.removeEventListener('load', handlePreloadLoad);
    };
    framePreload.addEventListener('load', handlePreloadLoad);
  } else {
    preloadedFilePath = '';
    framePreload.src = 'about:blank';
  }
}

// Promote the hidden preload iframe to the active preview iframe.
async function swapToPreloadedScene(nextPath, shouldPlay = true) {
  if (preloadedFilePath !== nextPath || isPreloading) {
    await loadFile(nextPath);
    if (shouldPlay) player.play();
    else player.pause();
    return;
  }
  
  // Clear all playback state before adopting the already-loaded iframe. In
  // particular, this detaches a previous native MP4 element so play() cannot
  // rewind and restart its audio after the visual frame has changed.
  player.prepareForFrameSwap(nextPath);
  frame.removeEventListener('load', player.boundFrameLoad);
  
  frame.style.display = 'none';
  framePreload.style.display = 'block';
  
  const temp = frame;
  frame = framePreload;
  framePreload = temp;
  
  player.iframe = frame;
  frame.addEventListener('load', player.boundFrameLoad);
  
  setCurrentFile(nextPath);
  player.handleFrameLoad();
  if (shouldPlay) player.play();
  else player.pause();
  
  preloadedFilePath = '';
  preloadNextScene();
}

// Folder browsing is delegated to ide-server because browser JavaScript cannot
// directly list arbitrary local directories.
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
    refreshFolderButton.disabled = true;
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

function playAgentResponseRing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);

    const first = ctx.createOscillator();
    first.type = 'sine';
    first.frequency.setValueAtTime(659.25, now);
    first.connect(gain);
    first.start(now);
    first.stop(now + 0.34);

    const second = ctx.createOscillator();
    second.type = 'sine';
    second.frequency.setValueAtTime(987.77, now + 0.11);
    second.connect(gain);
    second.start(now + 0.11);
    second.stop(now + 0.58);

    second.addEventListener('ended', () => {
      ctx.close().catch(() => {});
    });
  } catch (err) {
    // Browsers may block audio if the page has not received a user gesture.
  }
}

// Resolve the current source HTML into deterministic timeline HTML.
async function runResolve() {
  if (!isIndexHtmlKind(currentFileKind())) return;
  const sourceName = fileBaseName(currentFilePath);
  setActionBusy(true, 'Resolving...', 'resolve');
  setResolveOptionsVisible(false);
  const currentOnlyCheckbox = document.getElementById('resolve-current-only');
  const isCurrentOnly = currentOnlyCheckbox && currentOnlyCheckbox.checked;
  const resolveMsg = isCurrentOnly
    ? 'Resolving ' + sourceName + ' only with ' + resolveTtsVoice.value + ' @ ' + resolveTtsSpeed.value + 'x'
    : 'Resolving ' + sourceName + ' with ' + resolveTtsVoice.value + ' @ ' + resolveTtsSpeed.value + 'x';
  startJobStatus(resolveMsg);
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

// Render the current source/resolved HTML into an MP4 through ide-server.
async function runRender() {
  const kind = currentFileKind();
  if (!isIndexHtmlKind(kind) && !isResolvedHtmlKind(kind)) return;
  const sourceName = fileBaseName(currentFilePath);
  setActionBusy(true, 'Rendering...', 'render');
  setRenderOptionsVisible(false);
  startJobStatus(
    'Rendering ' + sourceName +
    ' at ' + renderFps.value + ' FPS, ' +
    renderResolution.value +
    ', ' + renderTtsVoice.value + ' @ ' + renderTtsSpeed.value + 'x' +
    (renderBurnSubtitle.checked ? ', burning subtitles' : '')
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

// Info dialog is generated from viewer version plus whatever metadata the
// loaded lecture exposes.
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

// Publish flow sends the active lecture folder and course metadata to ide-server.
function openPublishDialog() {
  if (currentBrowserFolder) {
    const folderName = fileBaseName(currentBrowserFolder);
    publishLectureSlug.value = folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    publishLectureTitle.value = folderName.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } else {
    publishLectureSlug.value = '';
    publishLectureTitle.value = '';
  }
  
  publishModule.value = '';
  publishLectureDesc.value = '';
  publishLectureOrder.value = '';
  publishLecturePublished.checked = true;
  
  publishCourseSelect.innerHTML = '<option value="">-- Select Course --</option><option value="__new__">[Create New Course]</option>';
  publishCourseSelect.value = '';
  newCourseFields.style.display = 'none';
  
  publishNewCourseSlug.value = '';
  publishNewCourseTitle.value = '';
  publishNewCourseDesc.value = '';
  publishNewCoursePublished.checked = true;
  
  publishStatusBox.style.display = 'none';
  publishStatusBox.textContent = '';
  publishStatusBox.className = '';
  
  publishDialog.style.display = 'grid';
  publishButton.blur();
  
  fetchCoursesList();
}

function closePublishDialog() {
  publishDialog.style.display = 'none';
  publishButton.focus();
}

async function fetchCoursesList() {
  try {
    const res = await fetch('/list-courses');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to list courses');
    
    let optionsHtml = '<option value="">-- Select Course --</option><option value="__new__">[Create New Course]</option>';
    if (data.courses && data.courses.length > 0) {
      data.courses.forEach(course => {
        optionsHtml += '<option value="' + course.slug + '">' + course.title + ' (' + course.slug + ')</option>';
      });
    }
    publishCourseSelect.innerHTML = optionsHtml;
  } catch (err) {
    console.error('Error fetching courses list:', err);
    publishStatusBox.style.display = 'block';
    publishStatusBox.textContent = 'Warning: Could not fetch course database list: ' + err.message + '. Defaulting to [Create New Course] option.';
    publishStatusBox.className = 'error';
    publishCourseSelect.value = '__new__';
    newCourseFields.style.display = 'block';
  }
}

function handleCourseSelectChange() {
  const isNew = publishCourseSelect.value === '__new__';
  newCourseFields.style.display = isNew ? 'block' : 'none';
  if (isNew) {
    publishNewCourseSlug.required = true;
    publishNewCourseTitle.required = true;
  } else {
    publishNewCourseSlug.required = false;
    publishNewCourseTitle.required = false;
  }
}

async function handlePublishSubmit(event) {
  event.preventDefault();
  
  const course = publishCourseSelect.value;
  if (!course) {
    alert('Please select or create a course.');
    return;
  }
  
  if (!currentBrowserFolder) {
    alert('No active folder selected.');
    return;
  }
  
  publishSubmitButton.disabled = true;
  publishSubmitButton.textContent = 'Publishing...';
  publishStatusBox.style.display = 'block';
  publishStatusBox.className = '';
  publishStatusBox.textContent = 'Starting publish process...\\n';
  
  const payload = {
    course: course === '__new__' ? publishNewCourseSlug.value : course,
    slug: publishLectureSlug.value,
    title: publishLectureTitle.value,
    description: publishLectureDesc.value,
    module: publishModule.value,
    order: publishLectureOrder.value,
    published: publishLecturePublished.checked,
    sourceDir: currentBrowserFolder
  };
  
  if (course === '__new__') {
    payload.courseTitle = publishNewCourseTitle.value;
    payload.courseDescription = publishNewCourseDesc.value;
    payload.coursePublished = publishNewCoursePublished.checked;
  }
  
  try {
    const res = await fetch('/publish-lecture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    
    publishStatusBox.className = 'success';
    publishStatusBox.textContent = 'Successfully published!\\n\\n' + (data.output || '');
    playNotificationSound(true);
    refreshFolderFiles();
  } catch (err) {
    publishStatusBox.className = 'error';
    publishStatusBox.textContent = 'Error publishing lecture:\\n' + err.message;
    playNotificationSound(false);
  } finally {
    publishSubmitButton.disabled = false;
    publishSubmitButton.textContent = 'Publish!';
  }
}

function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.body.classList.contains('pseudo-fullscreen')
  );
}

let lastTouchTime = 0;

// Fullscreen keeps the preview dominant while briefly revealing controls on input.
function showFullscreenControls(duration = 3000) {
  if (!isFullscreenActive()) return;
  document.body.classList.add('controls-visible');
  clearTimeout(controlsHideTimer);
  controlsHideTimer = setTimeout(() => {
    document.body.classList.remove('controls-visible');
  }, duration);
}

function hideFullscreenControls() {
  if (!isFullscreenActive()) return;
  document.body.classList.remove('controls-visible');
  clearTimeout(controlsHideTimer);
}

function toggleFullscreenControls() {
  if (!isFullscreenActive()) return;
  if (document.body.classList.contains('controls-visible')) {
    hideFullscreenControls();
  } else {
    showFullscreenControls(3500);
  }
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
    if (isFullscreenActive()) {
      if (document.body.classList.contains('pseudo-fullscreen')) {
        document.body.classList.remove('pseudo-fullscreen');
        updateFullscreenState();
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      } else {
        document.body.classList.remove('pseudo-fullscreen');
        updateFullscreenState();
      }
    } else {
      const docEl = document.documentElement;
      let nativeSuccess = false;
      if (docEl.requestFullscreen) {
        try {
          await docEl.requestFullscreen();
          nativeSuccess = true;
        } catch (err) {
          // Native fullscreen call failed (e.g. non-secure HTTP context or browser policy)
        }
      } else if (docEl.webkitRequestFullscreen) {
        try {
          await docEl.webkitRequestFullscreen();
          nativeSuccess = true;
        } catch (err) {
          // WebKit native fullscreen failed
        }
      }

      if (!nativeSuccess && !isFullscreenActive()) {
        document.body.classList.add('pseudo-fullscreen');
        updateFullscreenState();
      }
    }
  } catch (error) {
    if (!isFullscreenActive()) {
      document.body.classList.add('pseudo-fullscreen');
      updateFullscreenState();
    } else {
      document.body.classList.remove('pseudo-fullscreen');
      updateFullscreenState();
    }
  }
}

function formatTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes + ':' + secs.toFixed(2).padStart(5, '0');
}

// Pull player state into the surrounding IDE controls and timeline indicators.
function updateControls(state = playerState()) {
  lastPlayerState = state;
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  const globalTime = activeScene ? (activeScene.timelineStart + state.time) : state.time;
  const totalDuration = currentScenesList.length > 0
    ? currentScenesList.reduce((acc, file) => acc + file.duration, 0)
    : (state.duration || 1);

  scrubber.max = String(totalDuration || 1);
  scrubber.value = String(globalTime || 0);
  timeReadout.textContent = formatTime(globalTime) + ' / ' + formatTime(totalDuration);
  setIconButton(playButton, state.playing ? 'pause' : 'play', state.playing ? 'Pause' : 'Play');
  playButton.classList.toggle('active', state.playing);
  subtitlesToggle.classList.toggle('active', state.subtitlesEnabled);
  subtitlesToggle.setAttribute('aria-pressed', state.subtitlesEnabled ? 'true' : 'false');
  liveTtsToggle.classList.toggle('active', state.liveTtsEnabled);
  liveTtsToggle.setAttribute('aria-pressed', state.liveTtsEnabled ? 'true' : 'false');
  const effectiveVolume = Math.max(0, Math.min(1, Number(state.volume ?? 1)));
  const isMuted = Boolean(state.muted || effectiveVolume <= 0);
  setIconButton(volumeToggle, isMuted ? 'volumeMuted' : 'volume', isMuted ? 'Unmute' : 'Mute');
  volumeToggle.classList.toggle('active', !isMuted);
  volumeToggle.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  if (document.activeElement !== volumeSlider) volumeSlider.value = String(effectiveVolume);
  
  const hasInteractiveFile = globalEntries.some(file => file.type === 'file' && file.name.toLowerCase() === 'interactive.html');
  const hasGameFile = globalEntries.some(file => file.type === 'file' && file.name.toLowerCase() === 'game.html');

  interactiveMarker.classList.toggle('visible', hasInteractiveFile || state.interactiveTimeline.length > 0);
  gameMarker.classList.toggle('visible', hasGameFile || state.gameTimeline.length > 0);
  
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  const isNonTime = state.interactiveActive || state.gameActive;
  
  scrubber.disabled = isMp4 || isNonTime;
  seekBackButton.disabled = isMp4 || isNonTime;
  seekForwardButton.disabled = isMp4 || isNonTime;
  playButton.disabled = isNonTime;
  
  viewportPreset.disabled = isNonTime;
  if (isNonTime) {
    setPreviewViewport(1920, 1080);
  }
  
  updatePlayheadPosition(state);
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
  
  const targetTab = getSceneTabForFile(currentFilePath);
  if (targetTab && targetTab !== currentSceneTab) {
    currentSceneTab = targetTab;
    updateTabUI();
    if (globalEntries && globalEntries.length > 0) {
      updateScenePanel(globalEntries);
    }
  } else if (sceneListContainer) {
    const cards = sceneListContainer.querySelectorAll('.scene-card');
    currentScenesList.forEach((file, index) => {
      const card = cards[index];
      if (card) {
        const isCurrent = file.path === currentFilePath;
        card.classList.toggle('active', isCurrent);
      }
    });
  }
  
  syncIdeActions();
  updatePlayheadPosition();
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

// Loading can target HTML/MP4 player content or document files shown directly.
async function loadFile(filePath = currentFilePath) {
  if (!filePath) {
    setStatus('Select a file first');
    return false;
  }

  if (isDocumentPreviewFile(filePath)) {
    await loadDocumentFile(filePath);
    return true;
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
    preloadNextScene();
    return true;
  } catch (error) {
    setStatus(error.message);
    refreshFolderFiles();
    return false;
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

// Polling lets the server-side file picker and viewport controls command this
// already-open viewer tab.
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
  const totalDuration = currentScenesList.length > 0
    ? currentScenesList.reduce((acc, file) => acc + file.duration, 0)
    : state.duration;
  seekToGlobalTime(ratio * totalDuration);
}

function handleViewerShortcut(event) {
  const state = playerState();
  if (state.interactiveActive || state.gameActive) {
    return;
  }
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
    seekGlobalBy(5);
  } else if (event.ctrlKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    seekGlobalBy(-5);
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    event.stopPropagation();
    toggleFullscreen();
  }
}

// Bridge player events into the surrounding IDE controls.
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

// When a scene ends, advance to the next scene file in the active tab.
player.on('ended', async () => {
  const currentIndex = currentScenesList.findIndex(file => file.path === currentFilePath);
  if (currentIndex > -1 && currentIndex < currentScenesList.length - 1) {
    const nextScene = currentScenesList[currentIndex + 1];
    setStatus('Auto-advancing to ' + nextScene.name + '...');
    // Interactive and game files are destinations, not zero-duration media.
    // Load/start them, but do not continue the timed player's play loop.
    await swapToPreloadedScene(nextScene.path, !nextScene.isNonTime);
  }
});

// DOM event wiring lives together so future UI changes can audit behavior from
// one place instead of chasing listeners across helper functions.
loadButton.addEventListener('click', pickAndLoadFile);
openFolderButton.addEventListener('click', openCurrentFolder);
refreshFolderButton.addEventListener('click', refreshFolderFiles);
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
publishButton.addEventListener('click', openPublishDialog);
publishCloseButton.addEventListener('click', closePublishDialog);
publishCancelButton.addEventListener('click', closePublishDialog);
publishDialog.addEventListener('click', event => {
  if (event.target === publishDialog) closePublishDialog();
});
publishCourseSelect.addEventListener('change', handleCourseSelectChange);
publishForm.addEventListener('submit', handlePublishSubmit);
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
renderBurnSubtitle.addEventListener('change', () => {
  renderSubtitleOptions.classList.toggle('visible', renderBurnSubtitle.checked);
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
seekBackButton.addEventListener('click', () => seekGlobalBy(-5));
seekForwardButton.addEventListener('click', () => seekGlobalBy(5));
subtitlesToggle.addEventListener('click', () => {
  const state = playerState();
  player.setSubtitlesEnabled(!state.subtitlesEnabled);
});
liveTtsToggle.addEventListener('click', () => {
  const state = playerState();
  player.setLiveTtsEnabled(!state.liveTtsEnabled);
});
narrationEditButton.addEventListener('click', openNarrationDialog);
narrationCloseButton.addEventListener('click', closeNarrationDialog);
narrationDialog.addEventListener('click', event => {
  if (event.target === narrationDialog) closeNarrationDialog();
});
narrationSectionSelect.addEventListener('change', renderNarrationSelection);
narrationResetButton.addEventListener('click', () => {
  narrationSpokenText.value = narrationCaption.value;
});
narrationForm.addEventListener('submit', regenerateNarrationSection);
visualTextEditButton.addEventListener('click', openVisualTextDialog);
visualTextCloseButton.addEventListener('click', closeVisualTextDialog);
visualTextDialog.addEventListener('click', event => {
  if (event.target === visualTextDialog) closeVisualTextDialog();
});
visualTextSelect.addEventListener('change', () => {
  if (!visualTextSelect.value) return;
  visualTextFind.value = visualTextSelect.value;
  visualTextReplacement.value = visualTextSelect.value;
  visualTextReplacement.focus();
  visualTextReplacement.select();
});
visualPromptTab.addEventListener('click', () => {
  setVisualEditorMode('prompt');
  visualPrompt.focus();
});
visualExactTab.addEventListener('click', async () => {
  setVisualEditorMode('exact');
  await loadVisualTextCandidates();
});
visualTextForm.addEventListener('submit', submitVisualEditor);
volumeToggle.addEventListener('click', () => {
  const state = playerState();
  const volume = Number(state.volume ?? volumeSlider.value) || 1;
  player.setVolume(volume <= 0 ? 1 : volume, { muted: !state.muted });
});
volumeSlider.addEventListener('input', event => {
  player.setVolume(Number(event.target.value), { muted: Number(event.target.value) <= 0 });
});
scrubber.addEventListener('input', event => {
  seekToGlobalTime(Number(event.target.value));
});
const tabsContainer = document.getElementById('scenes-tabs');
if (tabsContainer) {
  tabsContainer.addEventListener('click', event => {
    const btn = event.target.closest('.scenes-tab-btn');
    if (btn) {
      const tab = btn.getAttribute('data-tab');
      switchSceneTab(tab);
    }
  });
}
scrubber.addEventListener('pointerdown', seekFromPointer);
scrubber.addEventListener('click', seekFromPointer);
interactiveMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  const interactiveFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'interactive.html');
  if (interactiveFile) {
    loadFile(interactiveFile.path);
  } else {
    player.seekToInteractive();
  }
});
interactiveMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  const interactiveFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'interactive.html');
  if (interactiveFile) {
    loadFile(interactiveFile.path);
  } else {
    player.seekToInteractive();
  }
});
gameMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  const gameFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'game.html');
  if (gameFile) {
    loadFile(gameFile.path);
  } else {
    player.seekToGame();
  }
});
gameMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  const gameFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'game.html');
  if (gameFile) {
    loadFile(gameFile.path);
  } else {
    player.seekToGame();
  }
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
document.addEventListener('webkitfullscreenchange', updateFullscreenState);
document.addEventListener('touchstart', event => {
  if (!isFullscreenActive()) return;
  lastTouchTime = Date.now();
  if (controls && controls.contains(event.target)) {
    showFullscreenControls(4000);
    return;
  }
  toggleFullscreenControls();
}, { passive: true });
document.addEventListener('mousemove', event => {
  if (!isFullscreenActive()) return;
  if (Date.now() - lastTouchTime < 1000) return;
  if (event.clientY >= window.innerHeight - 92) showFullscreenControls(2000);
  else hideFullscreenControls();
});
document.addEventListener('keydown', handleViewerShortcut, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (infoDialog.classList.contains('visible')) {
      event.preventDefault();
      closeInfoDialog();
    } else if (narrationDialog.classList.contains('visible')) {
      event.preventDefault();
      closeNarrationDialog();
    } else if (visualTextDialog.classList.contains('visible')) {
      event.preventDefault();
      closeVisualTextDialog();
    } else if (publishDialog && publishDialog.style.display === 'grid') {
      event.preventDefault();
      closePublishDialog();
    }
  }
});
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
}
window.addEventListener('resize', () => {
  resizePreview();
  if (currentScenesList.length > 0) {
    updateScenePanel(currentScenesList);
  }
});
window.addEventListener('orientationchange', () => {
  setTimeout(resizePreview, 150);
});

if (timelineRuler) {
  timelineRuler.addEventListener('pointerdown', handleTimelinePointerDown);
  timelineRuler.addEventListener('pointermove', handleTimelinePointerMove);
  window.addEventListener('pointerup', handleTimelinePointerUp);
  window.addEventListener('pointercancel', handleTimelinePointerUp);
}
if (agentToggleBtn) {
  agentToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('agent-collapsed');
    
    const isCollapsed = document.body.classList.contains('agent-collapsed');
    agentToggleBtn.innerHTML = isCollapsed
      ? '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>'
      : '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 18 17 12 11 6"></polyline></svg>';
    
    setTimeout(resizePreview, 210);
  });
}

// Right panel starts expanded by default.
if (agentToggleBtn) {
  agentToggleBtn.innerHTML = '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 18 17 12 11 6"></polyline></svg>';
}

// Agent chat is a thin client over ide-server; the server owns execution and log
// persistence, while the browser polls for latest step text during a run.
function appendChatMessage(text, sender = 'agent') {
  if (!agentBody) return;
  const bubble = document.createElement('div');
  bubble.className = 'chat-message ' + sender;
  
  if (sender === 'user' || sender === 'error') {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }
  
  agentBody.appendChild(bubble);
  agentBody.scrollTop = agentBody.scrollHeight;
}

function getLatestStepFromLog(logText) {
  if (!logText) return '';
  const cleanLog = logText.replace(/\\x1B\\[[0-9;]*[a-zA-Z]/g, '');
  const lines = cleanLog.split(/\\r?\\n/);
  const stepLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().includes('[step ')) {
      stepLines.push(trimmed);
    }
  }
  if (stepLines.length > 0) {
    const lastLine = stepLines[stepLines.length - 1];
    const match = lastLine.match(/\\[step\\s+(\\d+)\\]\\s*(.*)/i);
    if (match) {
      const stepNum = match[1];
      const action = match[2];
      return "Step " + stepNum + ": " + action;
    }
    return lastLine;
  }
  return '';
}

function showThinking(statusText = 'Agent is starting...') {
  if (!agentBody) return;
  const bubble = document.createElement('div');
  bubble.className = 'thinking-bubble';
  bubble.id = 'agent-thinking';
  const label = document.createElement('span');
  label.textContent = statusText;
  bubble.append(label);
  const dots = document.createElement('div');
  dots.className = 'dot-flashing';
  bubble.append(dots);
  agentBody.appendChild(bubble);
  agentBody.scrollTop = agentBody.scrollHeight;
}

function updateThinkingStatus(statusText) {
  const el = document.getElementById('agent-thinking');
  if (el) {
    const span = el.querySelector('span');
    if (span) {
      span.textContent = statusText;
    }
  }
}

function removeThinking() {
  const el = document.getElementById('agent-thinking');
  if (el) el.remove();
}

const agentSupportedAttachmentExts = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'bmp',
  'pdf',
  'mp4', 'mpeg', 'mpg', 'mov', 'avi', 'webm', 'wmv', '3gp', '3gpp', 'flv'
]);
let pendingAgentAttachments = [];
let agentThemes = [];
let agentDefaultThemeId = 'default';
let agentTeachingStyles = [];
let agentDefaultTeachingStyleId = 'default';

function getFileExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\\.([^.]+)$/);
  return match ? match[1] : '';
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

function addAgentAttachments(files) {
  const rejected = [];
  for (const file of Array.from(files || [])) {
    const ext = getFileExtension(file.name);
    if (!agentSupportedAttachmentExts.has(ext)) {
      rejected.push(file.name);
      continue;
    }
    const duplicate = pendingAgentAttachments.some(item =>
      item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
    );
    if (!duplicate) pendingAgentAttachments.push(file);
  }
  renderAgentAttachments();
  if (rejected.length > 0) {
    appendChatMessage('Unsupported attachment type: ' + rejected.join(', '), 'error');
  }
}

function extensionForImageMimeType(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/bmp') return 'bmp';
  return 'png';
}

function clipboardImageFiles(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const files = [];
  for (const item of items) {
    if (item.kind !== 'file' || !String(item.type || '').startsWith('image/')) {
      continue;
    }
    const clipboardFile = item.getAsFile();
    if (!clipboardFile) continue;
    const ext = extensionForImageMimeType(clipboardFile.type);
    const name = clipboardFile.name && clipboardFile.name.includes('.')
      ? clipboardFile.name
      : 'pasted-image-' + Date.now() + '-' + (files.length + 1) + '.' + ext;
    files.push(new File([clipboardFile], name, {
      type: clipboardFile.type || 'image/png',
      lastModified: Date.now()
    }));
  }
  return files;
}

function removeAgentAttachment(index) {
  pendingAgentAttachments.splice(index, 1);
  renderAgentAttachments();
}

function renderAgentAttachments() {
  if (!agentAttachmentList) return;
  agentAttachmentList.innerHTML = '';
  agentAttachmentList.classList.toggle('has-files', pendingAgentAttachments.length > 0);
  pendingAgentAttachments.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'agent-attachment-chip';
    chip.innerHTML = '<span class="agent-attachment-name" title="' + escapeText(file.name) + '">' + escapeText(file.name) + '</span><span>' + formatFileSize(file.size) + '</span>';
    const remove = document.createElement('button');
    remove.className = 'agent-attachment-remove';
    remove.type = 'button';
    remove.title = 'Remove attachment';
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.textContent = 'x';
    remove.addEventListener('click', () => removeAgentAttachment(index));
    chip.appendChild(remove);
    agentAttachmentList.appendChild(chip);
  });
}

async function uploadAgentAttachments(files) {
  if (!files.length) return [];
  const form = new FormData();
  files.forEach(file => form.append('files', file, file.name));
  const response = await fetch('/agent-upload?agentClientId=' + encodeURIComponent(agentClientId), {
    method: 'POST',
    body: form
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Attachment upload failed');
  }
  return payload.files || [];
}

function buildAttachmentPrompt(message, uploadedFiles) {
  let task = message.trim();
  if (!task && uploadedFiles.length > 0) {
    task = 'Please use the attached file(s).';
  }
  if (agentPhase === 'generate') {
    task = appendGenerationSettingsPrompt(task);
  }
  for (const file of uploadedFiles) {
    task += '\\n[(attachment: ' + file.path + ')]';
  }
  return task;
}

function buildUserAttachmentDisplay(message, files) {
  const names = files.map(file => file.name).join(', ');
  const base = message.trim() || 'Attached file(s).';
  return files.length > 0 ? base + '\\n\\nAttachments: ' + names : base;
}

const generationLengthMinSeconds = 5;
const generationLengthMaxSeconds = 900;
const generationLengthSliderMax = 1000;

function formatGenerationLength(seconds) {
  const total = clampGenerationSeconds(seconds);
  if (total < 60) return total + 's';
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes + ':' + String(remainder).padStart(2, '0');
}

function clampGenerationSeconds(seconds) {
  const raw = Number(seconds);
  if (!Number.isFinite(raw)) return 60;
  const clamped = Math.max(generationLengthMinSeconds, Math.min(generationLengthMaxSeconds, raw));
  return Math.round(clamped / 5) * 5;
}

function sliderToGenerationSeconds(value) {
  const slider = Math.max(0, Math.min(generationLengthSliderMax, Number(value) || 0));
  const progress = slider / generationLengthSliderMax;
  const ratio = generationLengthMaxSeconds / generationLengthMinSeconds;
  return clampGenerationSeconds(generationLengthMinSeconds * Math.pow(ratio, progress));
}

function generationSecondsToSlider(seconds) {
  const clamped = clampGenerationSeconds(seconds);
  const ratio = generationLengthMaxSeconds / generationLengthMinSeconds;
  const progress = Math.log(clamped / generationLengthMinSeconds) / Math.log(ratio);
  return Math.round(Math.max(0, Math.min(1, progress)) * generationLengthSliderMax);
}

function parseGenerationLength(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const clockMatch = text.match(/^(\\d{1,2}):(\\d{1,2})$/);
  if (clockMatch) {
    return clampGenerationSeconds((Number(clockMatch[1]) * 60) + Number(clockMatch[2]));
  }
  const minuteMatch = text.match(/^(\\d+(?:\\.\\d+)?)\\s*m(?:in)?s?$/);
  if (minuteMatch) {
    return clampGenerationSeconds(Number(minuteMatch[1]) * 60);
  }
  const secondMatch = text.match(/^(\\d+(?:\\.\\d+)?)\\s*s(?:ec)?s?$/);
  if (secondMatch) {
    return clampGenerationSeconds(Number(secondMatch[1]));
  }
  const number = Number(text);
  return Number.isFinite(number) ? clampGenerationSeconds(number) : null;
}

function updateGenerationLengthDisplay() {
  if (!agentGenerationLength || !agentGenerationLengthValue) return;
  const value = formatGenerationLength(sliderToGenerationSeconds(agentGenerationLength.value));
  agentGenerationLengthValue.value = value;
  agentGenerationLengthValue.style.width = Math.max(7.5, value.length + 1.5) + 'ch';
}

function commitGenerationLengthInput() {
  if (!agentGenerationLength || !agentGenerationLengthValue) return;
  const parsed = parseGenerationLength(agentGenerationLengthValue.value);
  if (parsed !== null) {
    agentGenerationLength.value = String(generationSecondsToSlider(parsed));
  }
  updateGenerationLengthDisplay();
}

function getGenerationSettingsPrompt() {
  const aspectRatio = agentAspectRatio ? agentAspectRatio.value : configuredDefaults.aspectRatio;
  const generationLength = agentGenerationLength ? formatGenerationLength(sliderToGenerationSeconds(agentGenerationLength.value)) : configuredDefaults.generationLength;
  const enableGetimg = agentEnableGetimg && agentEnableGetimg.checked ? 'yes' : 'no';
  const includeVideo = !agentOutputVideo || agentOutputVideo.checked;
  const includeInteractive = Boolean(agentOutputInteractive && agentOutputInteractive.checked);
  const includeGame = Boolean(agentOutputGame && agentOutputGame.checked);
  const lines = [
    'if the user query is for lecture generation then follow this:',
    'aspect ratio: ' + aspectRatio,
    'generation length: ' + generationLength,
    'getimg enabled: ' + enableGetimg,
    'output video: ' + (includeVideo ? 'yes' : 'no'),
    'output interactive: ' + (includeInteractive ? 'yes' : 'no'),
    'output practice game: ' + (includeGame ? 'yes' : 'no')
  ];
  const themeContent = getSelectedThemeContent();
  if (themeContent) {
    lines.push('theme: ' + themeContent);
  }
  const teachingStyleContent = getSelectedTeachingStyleContent();
  if (teachingStyleContent) {
    lines.push('teaching style: ' + teachingStyleContent);
  }
  return lines.join('\\n');
}

function appendGenerationSettingsPrompt(message) {
  const base = message.trim();
  const settings = getGenerationSettingsPrompt();
  return base ? base + '\\n\\n' + settings : settings;
}

function getSelectedThemeContent() {
  if (!agentTheme || !agentTheme.value) return '';
  const selected = agentThemes.find(theme => theme.id === agentTheme.value);
  return selected && selected.content ? selected.content.trim() : '';
}

function getSelectedTeachingStyleContent() {
  if (!agentTeachingStyle || !agentTeachingStyle.value) return '';
  const selected = agentTeachingStyles.find(style => style.id === agentTeachingStyle.value);
  return selected && selected.content ? selected.content.trim() : '';
}

async function loadAgentThemes() {
  if (!agentTheme) return;
  try {
    const response = await fetch('/agent-themes');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load themes');
    agentThemes = Array.isArray(payload.themes) ? payload.themes : [];
    agentDefaultThemeId = typeof payload.defaultThemeId === 'string' && payload.defaultThemeId ? payload.defaultThemeId : 'default';
    agentTheme.innerHTML = '';
    for (const theme of agentThemes) {
      const option = document.createElement('option');
      option.value = theme.id;
      option.textContent = theme.name || theme.fileName || theme.id;
      agentTheme.appendChild(option);
    }
    if (agentThemes.some(theme => theme.id === agentDefaultThemeId)) {
      agentTheme.value = agentDefaultThemeId;
    }
  } catch (error) {
    agentThemes = [];
    agentDefaultThemeId = 'default';
    agentTheme.innerHTML = '<option value="' + agentDefaultThemeId + '">' + agentDefaultThemeId.replace(/\\.md$/i, '') + '</option>';
    appendChatMessage('Could not load themes: ' + error.message, 'error');
  }
}

async function loadAgentTeachingStyles() {
  if (!agentTeachingStyle) return;
  try {
    const response = await fetch('/agent-teaching-styles');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load teaching styles');
    agentTeachingStyles = Array.isArray(payload.teachingStyles) ? payload.teachingStyles : [];
    agentDefaultTeachingStyleId = typeof payload.defaultTeachingStyleId === 'string' && payload.defaultTeachingStyleId ? payload.defaultTeachingStyleId : 'default';
    agentTeachingStyle.innerHTML = '';
    for (const style of agentTeachingStyles) {
      const option = document.createElement('option');
      option.value = style.id;
      option.textContent = style.name || style.fileName || style.id;
      agentTeachingStyle.appendChild(option);
    }
    if (agentTeachingStyles.some(style => style.id === agentDefaultTeachingStyleId)) {
      agentTeachingStyle.value = agentDefaultTeachingStyleId;
    }
  } catch (error) {
    agentTeachingStyles = [];
    agentDefaultTeachingStyleId = 'default';
    agentTeachingStyle.innerHTML = '<option value="' + agentDefaultTeachingStyleId + '">' + agentDefaultTeachingStyleId.replace(/\\.md$/i, '') + '</option>';
    appendChatMessage('Could not load teaching styles: ' + error.message, 'error');
  }
}

async function sendChat() {
  if (!agentChatInput || !agentChatSend) return;
  const msg = agentChatInput.value.trim();
  const filesToSend = pendingAgentAttachments.slice();
  const requestPhase = agentPhase;
  if (!msg && filesToSend.length === 0) return;
  if (
    agentPhase === 'generate'
    && agentOutputVideo && !agentOutputVideo.checked
    && agentOutputInteractive && !agentOutputInteractive.checked
    && agentOutputGame && !agentOutputGame.checked
  ) {
    appendChatMessage('Select at least one output: Video, Interactive, or Practice game.', 'error');
    return;
  }

  agentChatInput.value = '';
  agentChatInput.style.height = '32px';
  pendingAgentAttachments = [];
  renderAgentAttachments();
  appendChatMessage(buildUserAttachmentDisplay(msg, filesToSend), 'user');
  
  agentChatInput.disabled = true;
  if (agentUploadButton) agentUploadButton.disabled = true;
  agentChatSend.style.display = 'none';
  if (agentChatStop) agentChatStop.style.display = 'block';
  if (agentStatusTag) {
    agentStatusTag.textContent = requestPhase === 'generate' ? 'Generating' : 'Thinking';
    agentStatusTag.style.background = 'rgba(255, 214, 10, 0.15)';
    agentStatusTag.style.color = '#ffd60a';
  }
  
  showThinking(requestPhase === 'generate' ? 'Generating' : 'Agent is starting...');
  let uploadCompleted = filesToSend.length === 0;

  let logPollInterval = setInterval(async () => {
    try {
      const logRes = await fetch('/agent-log?agentClientId=' + encodeURIComponent(agentClientId));
      const logData = await logRes.json();
      const latestStep = getLatestStepFromLog(logData.log);
      if (requestPhase !== 'generate' && latestStep) {
        updateThinkingStatus(latestStep);
      }
    } catch (e) {}
  }, 800);

  try {
    if (requestPhase !== 'generate') {
      updateThinkingStatus(filesToSend.length > 0 ? 'Uploading attachments...' : 'Agent is starting...');
    }
    const uploadedFiles = await uploadAgentAttachments(filesToSend);
    uploadCompleted = true;
    const taskMessage = buildAttachmentPrompt(msg, uploadedFiles);
    const endpoint = requestPhase === 'generate' ? '/lecturegen/generate' : '/agent-chat';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        agentClientId,
        message: taskMessage,
        currentFile: currentFilePath,
        currentDir: currentBrowserFolder
      })
    });
    
    const payload = await response.json();
    removeThinking();
    
    if (!response.ok) {
      throw new Error(payload.error || 'Agent execution failed');
    }
    
    if (payload.workspace) {
      currentBrowserFolder = payload.workspace;
    }
    if (payload.mode) {
      setAgentPhase(payload.mode);
    }
    if (payload.path) {
      setCurrentFile(payload.path);
    }
    if (!payload.stopped) {
      appendChatMessage(payload.output || 'Done.', 'agent');
      playAgentResponseRing();
    }
  } catch (error) {
    removeThinking();
    if (!uploadCompleted) {
      pendingAgentAttachments = filesToSend.concat(pendingAgentAttachments);
      renderAgentAttachments();
    }
    appendChatMessage(error.message, 'error');
  } finally {
    clearInterval(logPollInterval);
    agentChatInput.disabled = false;
    if (agentUploadButton) agentUploadButton.disabled = false;
    agentChatSend.style.display = 'block';
    if (agentChatStop) agentChatStop.style.display = 'none';
    agentChatInput.style.height = '32px';
    agentChatInput.focus();
    if (agentStatusTag) {
      agentStatusTag.textContent = 'Standby';
      agentStatusTag.style.background = '';
      agentStatusTag.style.color = '';
    }
    
    if (currentBrowserFolder) {
      browseFolder(currentBrowserFolder);
    } else {
      refreshFolderFiles();
    }
  }
}

if (agentChatInput) {
  agentChatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      if (event.shiftKey || event.ctrlKey) {
        // Allow default behavior (line break)
      } else {
        event.preventDefault();
        sendChat();
      }
    }
  });
  agentChatInput.addEventListener('input', () => {
    agentChatInput.style.height = 'auto';
    agentChatInput.style.height = Math.min(180, agentChatInput.scrollHeight) + 'px';
  });
  agentChatInput.addEventListener('paste', event => {
    const imageFiles = clipboardImageFiles(event);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    addAgentAttachments(imageFiles);
  });
}
if (agentUploadButton && agentFileInput) {
  agentUploadButton.addEventListener('click', () => {
    agentFileInput.click();
  });
  agentFileInput.addEventListener('change', () => {
    addAgentAttachments(agentFileInput.files);
    agentFileInput.value = '';
  });
}
if (agentInputArea) {
  ['dragenter', 'dragover'].forEach(type => {
    agentInputArea.addEventListener(type, event => {
      event.preventDefault();
      event.stopPropagation();
      agentInputArea.classList.add('drag-active');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach(type => {
    agentInputArea.addEventListener(type, event => {
      event.preventDefault();
      event.stopPropagation();
      if (type !== 'dragenter' && type !== 'dragover') {
        agentInputArea.classList.remove('drag-active');
      }
    });
  });
  agentInputArea.addEventListener('drop', event => {
    addAgentAttachments(event.dataTransfer ? event.dataTransfer.files : []);
  });
}
if (agentGenerationLength) {
  updateGenerationLengthDisplay();
  agentGenerationLength.addEventListener('input', updateGenerationLengthDisplay);
}
if (agentGenerationLengthValue) {
  agentGenerationLengthValue.addEventListener('blur', commitGenerationLengthInput);
  agentGenerationLengthValue.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitGenerationLengthInput();
      agentGenerationLengthValue.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      updateGenerationLengthDisplay();
      agentGenerationLengthValue.blur();
    }
  });
}
loadAgentThemes();
loadAgentTeachingStyles();
if (agentChatSend) {
  agentChatSend.addEventListener('click', sendChat);
}
if (agentChatStop) {
  agentChatStop.addEventListener('click', async () => {
    agentChatStop.disabled = true;
    agentChatStop.textContent = 'Stopping...';
    try {
      const response = await fetch('/stop-job?agentClientId=' + encodeURIComponent(agentClientId), { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to stop agent');
    } catch (error) {
      appendChatMessage('Error stopping agent: ' + error.message, 'error');
    } finally {
      agentChatStop.disabled = false;
      agentChatStop.textContent = 'Stop';
    }
  });
}
if (agentNewChat) {
  agentNewChat.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear this conversation and start a new chat?')) {
      try {
        const response = await fetch('/agent-new-chat?agentClientId=' + encodeURIComponent(agentClientId), { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to start new chat');
        if (agentBody) {
          agentBody.innerHTML = '';
        }
        setAgentPhase('generate');
      } catch (error) {
        appendChatMessage('Error starting new chat: ' + error.message, 'error');
      }
    }
  });
}

// Initial boot: hydrate state, load the requested file, and start server polling.
if (agentBody) {
  agentBody.innerHTML = '';
}
setAgentPhase('generate');

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

// Template escaping helpers protect the generated HTML/JS from file paths that
// contain quotes, angle brackets, or backslashes.
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
