// @ts-nocheck
import { renderDocumentHead } from './document-shell.js';
import { renderBaseStyles } from './styles/base-styles.js';
import { renderLeftSidebarStyles } from './styles/left-sidebar-styles.js';
import { renderPlayerStyles } from './styles/player-styles.js';
import { renderDialogStyles } from './styles/dialog-styles.js';
import { renderTimelineStyles } from './styles/timeline-styles.js';
import { renderAgentSidebarStyles } from './styles/agent-sidebar-styles.js';
import { renderBodyOpen } from './body-shell.js';
import { renderLeftSidebar } from './components/left-sidebar.js';
import { renderPlayerArea } from './components/player-area.js';
import { renderRightSidebar } from './components/right-sidebar.js';
import { renderDialogs } from './components/dialogs.js';
import { renderShellController } from './controllers/shell-controller.js';
import { renderPlayerEditorController } from './controllers/player-editor-controller.js';
import { renderUiHelpers } from './controllers/ui-helpers.js';
import { renderFileBrowserController } from './controllers/file-browser-controller.js';
import { renderTimelineController } from './controllers/timeline-controller.js';
import { renderLectureActionsController } from './controllers/lecture-actions-controller.js';
import { renderPlayerController } from './controllers/player-controller.js';
import { renderEventBindings } from './controllers/event-bindings.js';
import { renderAgentController } from './controllers/agent-controller.js';
import { renderBootstrap } from './controllers/bootstrap.js';

/**
 * Builds the browser IDE shell used by the local ide-server.
 *
 * The returned HTML contains the complete three-panel interface: folder browser,
 * preview/player surface, timeline controls, publish dialog, and agent sidebar.
 */
const viewerVersion = '0.2';

function viewportFromConfigAspectRatio(aspectRatio, baseWidth, baseHeight) {
  const match = String(aspectRatio || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  const longEdge = Math.max(Number(baseWidth) || 1920, Number(baseHeight) || 1080);
  if (!match) return { width: Number(baseWidth) || 1920, height: Number(baseHeight) || 1080 };

  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return { width: Number(baseWidth) || 1920, height: Number(baseHeight) || 1080 };
  }

  if (widthRatio >= heightRatio) {
    return {
      width: longEdge,
      height: Math.round(longEdge * heightRatio / widthRatio)
    };
  }

  return {
    width: Math.round(longEdge * widthRatio / heightRatio),
    height: longEdge
  };
}

function generationSecondsToInitialSlider(seconds) {
  const minSeconds = 5;
  const maxSeconds = 900;
  const sliderMax = 1000;
  const raw = Number(seconds);
  const clamped = Math.max(minSeconds, Math.min(maxSeconds, Number.isFinite(raw) ? raw : 60));
  const progress = Math.log(clamped / minSeconds) / Math.log(maxSeconds / minSeconds);
  return Math.round(Math.max(0, Math.min(1, progress)) * sliderMax);
}

function formatInitialGenerationLength(seconds) {
  const total = Math.round(Number(seconds) || 60);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return remainder ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes}:00`;
}

function selectedAttr(value, selected) {
  return String(value) === String(selected) ? ' selected' : '';
}

export function createViewerHtml(openPath, initialWidth = 1920, initialHeight = 1080, options = {}) {
  // Normalize values before interpolation so the generated page can be served
  // directly without another runtime configuration step.
  const agentConfig = options.agent || {};
  const ttsConfig = options.tts || {};
  const renderConfig = options.render || {};
  const normalizedOpenPath = openPath ? openPath.replaceAll('\\', '/') : '';
  const safeInitialWidth = Number.isInteger(initialWidth) && initialWidth > 0 ? initialWidth : 1920;
  const safeInitialHeight = Number.isInteger(initialHeight) && initialHeight > 0 ? initialHeight : 1080;
  const configuredTtsProvider = String(ttsConfig.provider || 'omnivoice').trim().toLowerCase();
  const defaultTtsProvider = configuredTtsProvider === '11labs'
    ? 'elevenlabs'
    : configuredTtsProvider;
  const defaultTtsVoice = String(ttsConfig.voice || 'maruf');
  const elevenLabsDefaultVoice = 'bIHbv24MWmeRgasZH58o';
  const configuredElevenLabsVoiceOption = (
    defaultTtsProvider === 'elevenlabs' &&
    defaultTtsVoice !== elevenLabsDefaultVoice
  )
    ? `<option value="${escapeHtml(defaultTtsVoice)}" selected>Configured ElevenLabs voice (${escapeHtml(defaultTtsVoice)})</option>`
    : '';
  const defaultTtsSpeed = String(ttsConfig.speed || 1);
  const defaultFps = String(renderConfig.fps || 60);
  const defaultBurnSubtitle = renderConfig.burnSubtitle === true;
  const defaultSubtitleFont = String(renderConfig.subtitleFont || 'Arial');
  const defaultSubtitleFontSize = Number(renderConfig.subtitleFontSize) || 48;
  const defaultSubtitleBottomPercent = Number.isFinite(Number(renderConfig.subtitleBottomPercent))
    ? Number(renderConfig.subtitleBottomPercent)
    : 8;
  const subtitleFontOptions = [...new Set([
    defaultSubtitleFont,
    'Arial',
    'Inter',
    'Verdana',
    'Georgia',
    'Times New Roman'
  ])].map(font => `<option value="${escapeHtml(font)}"${selectedAttr(font, defaultSubtitleFont)}>${escapeHtml(font)}</option>`).join('');
  const burnSubtitleChecked = defaultBurnSubtitle ? ' checked' : '';
  const subtitleOptionsVisible = defaultBurnSubtitle ? ' class="visible"' : '';
  const defaultAspectRatio = String(agentConfig.defaultAspectRatio || '16:9');
  const defaultLengthSeconds = Number(agentConfig.defaultLengthSeconds) || 60;
  const defaultLengthSliderValue = generationSecondsToInitialSlider(defaultLengthSeconds);
  const defaultLengthLabel = formatInitialGenerationLength(defaultLengthSeconds);
  const defaultRenderViewport = viewportFromConfigAspectRatio(
    defaultAspectRatio,
    renderConfig.baseWidth || 1920,
    renderConfig.baseHeight || 1080
  );
  const defaultRenderResolution = `${defaultRenderViewport.width}x${defaultRenderViewport.height}`;
  const getimgChecked = agentConfig.enableGetimgTool ? ' checked' : '';
  const context = {
    agentConfig,
    burnSubtitleChecked,
    configuredElevenLabsVoiceOption,
    defaultAspectRatio,
    defaultFps,
    defaultLengthLabel,
    defaultLengthSeconds,
    defaultLengthSliderValue,
    defaultRenderResolution,
    defaultRenderViewport,
    defaultSubtitleBottomPercent,
    defaultSubtitleFontSize,
    defaultTtsProvider,
    defaultTtsSpeed,
    defaultTtsVoice,
    elevenLabsDefaultVoice,
    escapeHtml,
    escapeJsString,
    getimgChecked,
    normalizedOpenPath,
    safeInitialHeight,
    safeInitialWidth,
    selectedAttr,
    subtitleFontOptions,
    subtitleOptionsVisible,
    viewerVersion,
  };
  return [
    renderDocumentHead(context),
    renderBaseStyles(context),
    renderLeftSidebarStyles(context),
    renderPlayerStyles(context),
    renderDialogStyles(context),
    renderTimelineStyles(context),
    renderAgentSidebarStyles(context),
    renderBodyOpen(context),
    renderLeftSidebar(context),
    renderPlayerArea(context),
    renderRightSidebar(context),
    renderDialogs(context),
    renderShellController(context),
    renderPlayerEditorController(context),
    renderUiHelpers(context),
    renderFileBrowserController(context),
    renderTimelineController(context),
    renderLectureActionsController(context),
    renderPlayerController(context),
    renderEventBindings(context),
    renderAgentController(context),
    renderBootstrap(context),
  ].join('');
}

// Template escaping helpers protect the generated HTML/JS from file paths that
// contain quotes, angle brackets, or backslashes.
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
