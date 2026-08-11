// @ts-nocheck
export function renderAgentSidebarStyles(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
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
}`;
}
