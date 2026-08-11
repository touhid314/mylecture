// @ts-nocheck
export function renderBaseStyles(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
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
}`;
}
