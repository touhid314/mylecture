// @ts-nocheck
export function renderDialogStyles(context = {}) {
  const { agentConfig, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, viewerVersion } = context;
  return `
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
`;
}
