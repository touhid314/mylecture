// @ts-nocheck
export function renderPlayerArea(context = {}) {
  const { agentConfig, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, viewerVersion } = context;
  return `<!-- Center preview: HTML/MP4 iframe playback or markdown/AVSL document preview. -->
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
  <button id="narration-edit" type="button" title="Edit and regenerate one narration clip">Edit narration</button>
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
`;
}
