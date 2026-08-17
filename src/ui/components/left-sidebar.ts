// @ts-nocheck
export function renderLeftSidebar(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `<!-- Left panel: local folder browser plus resolve/render/publish actions. -->
<aside id="folder-sidebar">
  <div id="sidebar-header">
    <div id="sidebar-brand" aria-label="MyLecture Local IDE">
      <img id="sidebar-brand-logo" src="/assets/logo-lockup.png" alt="MyLecture" draggable="false">
      <span id="sidebar-brand-title">Local IDE</span>
    </div>
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
            <option value="${escapeHtml(defaultTtsVoice)}" selected>${escapeHtml(defaultTtsVoice)}</option>
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
            <option value="${escapeHtml(defaultTtsVoice)}" selected>${escapeHtml(defaultTtsVoice)}</option>
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
`;
}
