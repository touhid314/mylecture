// @ts-nocheck
export function renderTimelineStyles(context = {}) {
  const { agentConfig, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, viewerVersion } = context;
  return `
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
`;
}
