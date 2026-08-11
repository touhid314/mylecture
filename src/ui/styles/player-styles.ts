// @ts-nocheck
export function renderPlayerStyles(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
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
  grid-template-columns: auto auto auto 1fr auto auto auto auto auto auto auto auto;
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
  width: 42px;
  padding: 0 5px;
  appearance: none;
  -webkit-appearance: none;
  text-align: center;
}
#viewport-preset {
  width: 50px;
  padding: 0 5px;
  appearance: none;
  -webkit-appearance: none;
  text-align: center;
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
  padding: 5px 10px;
}`;
}
