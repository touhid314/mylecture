// @ts-nocheck
export function renderRightSidebar(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `<!-- Right panel: agent chat UI backed by ide-server HTTP endpoints. -->
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
`;
}
