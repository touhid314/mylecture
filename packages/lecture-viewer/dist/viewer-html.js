// @ts-nocheck
const viewerVersion = '0.2';
export function createViewerHtml(openPath, initialWidth = 1920, initialHeight = 1080) {
    const normalizedOpenPath = openPath ? openPath.replaceAll('\\', '/') : '';
    const safeInitialWidth = Number.isInteger(initialWidth) && initialWidth > 0 ? initialWidth : 1920;
    const safeInitialHeight = Number.isInteger(initialHeight) && initialHeight > 0 ? initialHeight : 1080;
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
  grid-template-columns: 1fr auto auto auto;
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
#subtitles-toggle,
#live-tts-toggle,
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
#subtitles-toggle:hover,
#live-tts-toggle:hover,
#fullscreen:hover,
#seek-back:hover,
#seek-forward:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: #555;
  color: var(--text);
}
#subtitles-toggle.active,
#live-tts-toggle.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent);
  color: var(--accent);
}
#subtitles-toggle.active:hover,
#live-tts-toggle.active:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: #fff;
  color: #fff;
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
  gap: 8px;
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
            <optgroup label="Kokoro TTS (Local)">
              <option value="am_puck">am_puck</option>
              <option value="af_heart" selected>af_heart</option>
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
            <option value="1" selected>1.0x</option>
            <option value="1.2">1.2x</option>
            <option value="1.3">1.3x</option>
            <option value="1.5">1.5x</option>
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
            <optgroup label="Kokoro TTS (Local)">
              <option value="am_puck">am_puck</option>
              <option value="af_heart" selected>af_heart</option>
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
            <option value="1" selected>1.0x</option>
            <option value="1.2">1.2x</option>
            <option value="1.3">1.3x</option>
            <option value="1.5">1.5x</option>
          </select>
        </div>
        <div class="render-option">
          <label for="render-fps">FPS</label>
          <select id="render-fps">
            <option value="24">24</option>
            <option value="30">30</option>
            <option value="60" selected>60</option>
          </select>
        </div>
        <div class="render-option">
          <label for="render-resolution">Resolution</label>
          <select id="render-resolution">
            <option value="1920x1080" selected>1920x1080</option>
            <option value="1080x1920">1080x1920</option>
            <option value="720x1280">720x1280</option>
          </select>
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
<main id="frame-wrap">
  <div id="preview-shell">
    <iframe id="preview" title="Render preview"></iframe>
    <iframe id="preview-preload" title="Preload preview" style="display: none;"></iframe>
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
        <button id="agent-new-chat" class="agent-new-chat-btn" type="button" title="New Chat">New Chat</button>
        <span class="agent-status-tag">Standby</span>
      </div>
    </div>
    <div class="agent-body">
      <div class="agent-placeholder-card">
        <div class="agent-placeholder-title">Agent Panel</div>
        <div class="agent-placeholder-desc">
          This panel is a placeholder for the Lecture Agent. You will be able to interact with the agent to edit and refine your script, visuals, or code here soon.
        </div>
      </div>
    </div>

    <div class="agent-input-area">
      <textarea id="agent-chat-input" class="agent-input" placeholder="Ask agent to build/edit..."></textarea>
      <button id="agent-chat-send" class="agent-send-btn" type="button">Send</button>
      <button id="agent-chat-stop" class="agent-stop-btn" type="button" style="display: none;">Stop</button>
    </div>
  </div>
</aside>
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
let currentScenesList = [];
let currentSecWidth = 15;

let currentSceneTab = 'raw';
let globalEntries = [];

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
  params.set('ttsVoice', resolveTtsVoice.value || 'af_heart');
  params.set('ttsSpeed', resolveTtsSpeed.value || '1');
  const currentOnlyCheckbox = document.getElementById('resolve-current-only');
  if (currentOnlyCheckbox && currentOnlyCheckbox.checked) {
    params.set('currentOnly', '1');
  }
  return params.toString();
}

function renderQuery() {
  const params = new URLSearchParams();
  const [width, height] = String(renderResolution.value || '1080x1920').split('x');
  params.set('file', currentFilePath);
  params.set('ttsVoice', renderTtsVoice.value || 'af_heart');
  params.set('ttsSpeed', renderTtsSpeed.value || '1');
  params.set('fps', renderFps.value || '60');
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

async function swapToPreloadedScene(nextPath, shouldPlay = true) {
  if (preloadedFilePath !== nextPath || isPreloading) {
    await loadFile(nextPath);
    if (shouldPlay) player.play();
    else player.pause();
    return;
  }
  
  player.pause();
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

player.on('ended', async () => {
  const currentIndex = currentScenesList.findIndex(file => file.path === currentFilePath);
  if (currentIndex > -1 && currentIndex < currentScenesList.length - 1) {
    const nextScene = currentScenesList[currentIndex + 1];
    setStatus('Auto-advancing to ' + nextScene.name + '...');
    await swapToPreloadedScene(nextScene.path);
  }
});

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
document.addEventListener('mousemove', event => {
  if (!isFullscreenActive()) return;
  if (event.clientY >= window.innerHeight - 92) showFullscreenControls();
  else hideFullscreenControls();
});
document.addEventListener('keydown', handleViewerShortcut, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (infoDialog.classList.contains('visible')) {
      event.preventDefault();
      closeInfoDialog();
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

// Right panel expanded by default
if (agentToggleBtn) {
  agentToggleBtn.innerHTML = '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 18 17 12 11 6"></polyline></svg>';
}

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

function showThinking() {
  if (!agentBody) return;
  const bubble = document.createElement('div');
  bubble.className = 'thinking-bubble';
  bubble.id = 'agent-thinking';
  bubble.innerHTML = '<span>Agent is starting...</span><div class="dot-flashing"></div>';
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

async function sendChat() {
  if (!agentChatInput || !agentChatSend) return;
  const msg = agentChatInput.value.trim();
  if (!msg) return;

  agentChatInput.value = '';
  agentChatInput.style.height = '32px';
  appendChatMessage(msg, 'user');
  
  agentChatInput.disabled = true;
  agentChatSend.style.display = 'none';
  if (agentChatStop) agentChatStop.style.display = 'block';
  if (agentStatusTag) {
    agentStatusTag.textContent = 'Thinking';
    agentStatusTag.style.background = 'rgba(255, 214, 10, 0.15)';
    agentStatusTag.style.color = '#ffd60a';
  }
  
  showThinking();

  let logPollInterval = setInterval(async () => {
    try {
      const logRes = await fetch('/agent-log');
      const logData = await logRes.json();
      const latestStep = getLatestStepFromLog(logData.log);
      if (latestStep) {
        updateThinkingStatus(latestStep);
      }
    } catch (e) {}
  }, 800);

  try {
    const response = await fetch('/agent-chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        message: msg,
        currentFile: currentFilePath,
        currentDir: currentBrowserFolder
      })
    });
    
    const payload = await response.json();
    removeThinking();
    
    if (!response.ok) {
      throw new Error(payload.error || 'Agent execution failed');
    }
    
    appendChatMessage(payload.output || 'Done.', 'agent');
  } catch (error) {
    removeThinking();
    appendChatMessage(error.message, 'error');
  } finally {
    clearInterval(logPollInterval);
    agentChatInput.disabled = false;
    agentChatSend.style.display = 'block';
    if (agentChatStop) agentChatStop.style.display = 'none';
    agentChatInput.style.height = '32px';
    agentChatInput.focus();
    if (agentStatusTag) {
      agentStatusTag.textContent = 'Standby';
      agentStatusTag.style.background = '';
      agentStatusTag.style.color = '';
    }
    
    refreshFolderFiles();
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
}
if (agentChatSend) {
  agentChatSend.addEventListener('click', sendChat);
}
if (agentChatStop) {
  agentChatStop.addEventListener('click', async () => {
    agentChatStop.disabled = true;
    agentChatStop.textContent = 'Stopping...';
    try {
      const response = await fetch('/stop-job', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to stop agent');
      appendChatMessage('Stopping agent...', 'error');
    } catch (error) {
      appendChatMessage('Error stopping agent: ' + error.message, 'error');
    } finally {
      agentChatStop.disabled = false;
      agentChatStop.textContent = 'Stop';
    }
  });
}
if (agentNewChat) {
  agentNewChat.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear this conversation and start a new chat?')) {
      if (agentBody) {
        agentBody.innerHTML = '';
        appendChatMessage("Hello! I am your Lecture Agent. I can make great lecture videos, interactive demonstrations, and games. What would you like to build today?", "agent");
      }
    }
  });
}



// Add a welcome message and clear placeholder card
if (agentBody) {
  agentBody.innerHTML = '';
  appendChatMessage("Hello! I am your Lecture Agent. I can make great lecture videos, interactive demonstrations, and games. What would you like to build today?", "agent");
}

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
