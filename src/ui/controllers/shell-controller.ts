// @ts-nocheck
export function renderShellController(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `<script type="module">
import { createLecturePlayer, lectureViewerVersion } from '/lecture-viewer/player/index.mjs';

function createAgentClientId() {
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
}

function getAgentClientId() {
  return createAgentClientId();
}

const agentClientId = getAgentClientId();

// DOM handles are grouped here because this generated page is intentionally
// framework-free; each feature below mutates these nodes directly.
const folderPathLabel = document.getElementById('folder-path');
const copyFolderPathButton = document.getElementById('copy-folder-path');
const openFolderButton = document.getElementById('open-folder');
const refreshFolderButton = document.getElementById('refresh-folder');
const fileList = document.getElementById('file-list');
const jobStatus = document.getElementById('job-status');
const resolveControl = document.getElementById('resolve-control');
const sidebarResolveButton = document.getElementById('sidebar-resolve');
const resolveMenuToggle = document.getElementById('resolve-menu-toggle');
const agentChatInput = document.getElementById('agent-chat-input');
const agentChatSend = document.getElementById('agent-chat-send');
const agentChatStop = document.getElementById('agent-chat-stop');
const agentNewChat = document.getElementById('agent-new-chat');
const agentBody = document.querySelector('.agent-body');
const agentStatusTag = document.querySelector('.agent-status-tag');
const agentInputArea = document.querySelector('.agent-input-area');
const agentUploadButton = document.getElementById('agent-upload-btn');
const agentFileInput = document.getElementById('agent-file-input');
const agentAttachmentList = document.getElementById('agent-attachment-list');
const agentGenerationControls = document.getElementById('agent-generation-controls');
const agentAspectRatio = document.getElementById('agent-aspect-ratio');
const agentGenerationLength = document.getElementById('agent-generation-length');
const agentGenerationLengthValue = document.getElementById('agent-generation-length-value');
const agentEnableGetimg = document.getElementById('agent-enable-getimg');
const agentOutputVideo = document.getElementById('agent-output-video');
const agentOutputInteractive = document.getElementById('agent-output-interactive');
const agentOutputGame = document.getElementById('agent-output-game');
const agentTheme = document.getElementById('agent-theme');
const agentTeachingStyle = document.getElementById('agent-teaching-style');
let agentPhase = 'generate';

function setAgentPhase(phase) {
  agentPhase = phase === 'edit' ? 'edit' : 'generate';
  if (agentChatInput) {
    agentChatInput.placeholder = agentPhase === 'edit' ? 'Edit the video...' : 'Make a video on...';
  }
  if (agentGenerationControls) {
    agentGenerationControls.style.display = agentPhase === 'edit' ? 'none' : '';
  }
}

const resolveOptions = document.getElementById('resolve-options');
const resolveTtsVoice = document.getElementById('resolve-tts-voice');
const resolveTtsSpeed = document.getElementById('resolve-tts-speed');
const renderControl = document.getElementById('render-control');
const sidebarRenderButton = document.getElementById('sidebar-render');
const renderMenuToggle = document.getElementById('render-menu-toggle');
const renderOptions = document.getElementById('render-options');
const renderTtsVoice = document.getElementById('render-tts-voice');
const renderTtsSpeed = document.getElementById('render-tts-speed');
const renderFps = document.getElementById('render-fps');
const renderResolution = document.getElementById('render-resolution');
const renderBurnSubtitle = document.getElementById('render-burn-subtitle');
const renderSubtitleOptions = document.getElementById('render-subtitle-options');
const renderSubtitleFont = document.getElementById('render-subtitle-font');
const renderSubtitleFontSize = document.getElementById('render-subtitle-font-size');
const renderSubtitleBottomPercent = document.getElementById('render-subtitle-bottom-percent');
const frameWrap = document.getElementById('frame-wrap');
const previewShell = document.getElementById('preview-shell');
let frame = document.getElementById('preview');
let framePreload = document.getElementById('preview-preload');
const documentPreview = document.getElementById('document-preview');
const currentFileLabel = document.getElementById('current-file');
const infoButton = document.getElementById('info');
const infoDialog = document.getElementById('info-dialog');
const infoCloseButton = document.getElementById('info-close');
const infoContent = document.getElementById('info-content');
const loadButton = document.getElementById('load');
const reloadButton = document.getElementById('reload');
const publishButton = document.getElementById('publish');
const publishDialog = document.getElementById('publish-dialog');
const publishCloseButton = document.getElementById('publish-close');
const publishCancelButton = document.getElementById('publish-cancel');
const publishForm = document.getElementById('publish-form');
const publishCourseSelect = document.getElementById('publish-course-select');
const newCourseFields = document.getElementById('new-course-fields');
const publishNewCourseSlug = document.getElementById('publish-new-course-slug');
const publishNewCourseTitle = document.getElementById('publish-new-course-title');
const publishNewCourseDesc = document.getElementById('publish-new-course-desc');
const publishNewCoursePublished = document.getElementById('publish-new-course-published');
const publishModule = document.getElementById('publish-module');
const publishLectureSlug = document.getElementById('publish-lecture-slug');
const publishLectureTitle = document.getElementById('publish-lecture-title');
const publishLectureDesc = document.getElementById('publish-lecture-desc');
const publishLectureOrder = document.getElementById('publish-lecture-order');
const publishLecturePublished = document.getElementById('publish-lecture-published');
const publishStatusBox = document.getElementById('publish-status-box');
const publishSubmitButton = document.getElementById('publish-submit');
const playButton = document.getElementById('play');
const seekBackButton = document.getElementById('seek-back');
const seekForwardButton = document.getElementById('seek-forward');
const scrubber = document.getElementById('scrub');
const interactiveMarker = document.getElementById('interactive-marker');
const gameMarker = document.getElementById('game-marker');
const timeReadout = document.getElementById('time');
const subtitlesToggle = document.getElementById('subtitles-toggle');
const liveTtsToggle = document.getElementById('live-tts-toggle');
const narrationEditButton = document.getElementById('narration-edit');
const narrationDialog = document.getElementById('narration-dialog');
const narrationCloseButton = document.getElementById('narration-close');
const narrationForm = document.getElementById('narration-form');
const narrationSectionSelect = document.getElementById('narration-section-select');
const narrationCaption = document.getElementById('narration-caption');
const narrationSpokenText = document.getElementById('narration-spoken-text');
const narrationResetButton = document.getElementById('narration-reset');
const narrationRegenerateButton = document.getElementById('narration-regenerate');
const narrationStatus = document.getElementById('narration-status');
const visualTextEditButton = document.getElementById('visual-text-edit');
const visualTextDialog = document.getElementById('visual-text-dialog');
const visualTextSubtitle = document.getElementById('visual-text-subtitle');
const visualTextCloseButton = document.getElementById('visual-text-close');
const visualTextForm = document.getElementById('visual-text-form');
const visualTextSelect = document.getElementById('visual-text-select');
const visualTextFind = document.getElementById('visual-text-find');
const visualTextReplacement = document.getElementById('visual-text-replacement');
const visualTextApplyButton = document.getElementById('visual-text-apply');
const visualTextStatus = document.getElementById('visual-text-status');
const visualPromptTab = document.getElementById('visual-prompt-tab');
const visualExactTab = document.getElementById('visual-exact-tab');
const visualPromptSection = document.getElementById('visual-prompt-section');
const visualExactSection = document.getElementById('visual-exact-section');
const visualPrompt = document.getElementById('visual-prompt');
const visualPromptApplyButton = document.getElementById('visual-prompt-apply');
const subtitleOverlay = document.getElementById('subtitle-overlay');
const volumeToggle = document.getElementById('volume-toggle');
const volumeSlider = document.getElementById('volume-slider');
const speedSelect = document.getElementById('speed');
const viewportPreset = document.getElementById('viewport-preset');
const fullscreenButton = document.getElementById('fullscreen');
const viewportText = document.getElementById('viewport');
const statusText = document.getElementById('status');
const VIEWER_VERSION = lectureViewerVersion;
`;
}
