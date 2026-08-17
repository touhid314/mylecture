// @ts-nocheck
export function renderLeftSidebarStyles(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
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
#sidebar-brand {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  margin-bottom: 5px;
}
#sidebar-brand-logo {
  width: 108px;
  height: 42px;
  object-fit: contain;
  flex: 0 0 auto;
  margin: -9px -3px -8px -3px;
}
#sidebar-brand-title {
  color: var(--text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
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
}`;
}
