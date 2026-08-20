// @ts-nocheck
export function renderPlayerEditorController(context = {}) {
  const { agentConfig, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, viewerVersion } = context;
  return `
// Page-level state mirrors the current file, viewport, folder contents, scene
// list, and active server job. The player keeps its own playback state.
let currentFilePath = '${escapeJsString(normalizedOpenPath)}';
let viewerCommandVersion = 0;
let videoMetadata = {};
let renderViewport = {
  width: ${safeInitialWidth},
  height: ${safeInitialHeight}
};
const configuredDefaults = ${JSON.stringify({
    ttsProvider: defaultTtsProvider,
    ttsVoice: defaultTtsVoice,
    ttsSpeed: defaultTtsSpeed,
    fps: defaultFps,
    renderResolution: defaultRenderResolution,
    renderWidth: defaultRenderViewport.width,
    renderHeight: defaultRenderViewport.height,
    aspectRatio: defaultAspectRatio,
    generationLength: defaultLengthLabel,
    defaultTheme: agentConfig.defaultTheme || 'default',
    defaultTeachingStyle: agentConfig.defaultTeachingStyle || 'default'
  })};
let userViewportOverride = false;
let controlsHideTimer = 0;
let lastPlayerState = null;
let activeJobTimer = 0;
let activeJobStartedAt = 0;
let activeJobLabel = '';
let currentBrowserFolder = '';
let currentScenesList = [];
let currentSecWidth = 15;

let currentSceneTab = 'raw';
let globalEntries = [];
let narrationSections = [];
let visualEditorMode = 'prompt';
let visualTextCandidatesLoaded = false;

function isRenderedKind(name) {
  return /^rendered.*\.mp4$/i.test(name) || (name.toLowerCase().endsWith('.mp4') && !name.toLowerCase().startsWith('temp_'));
}

function getSceneTabForFile(filePath) {
  const name = fileBaseName(filePath).toLowerCase();
  if (isResolvedHtmlKind(name)) return 'resolved';
  if (isIndexHtmlKind(name)) return 'raw';
  if (isRenderedKind(name)) return 'rendered';
  return null;
}

function updateTabUI() {
  const tabsContainer = document.getElementById('scenes-tabs');
  if (!tabsContainer) return;
  const buttons = tabsContainer.querySelectorAll('.scenes-tab-btn');
  buttons.forEach(btn => {
    const tabName = btn.getAttribute('data-tab');
    btn.classList.toggle('active', tabName === currentSceneTab);
  });
}

async function switchSceneTab(tab) {
  if (currentSceneTab === tab) return;
  const oldTab = currentSceneTab;
  
  // Find current scene index
  let currentIndex = -1;
  const currentList = getFilesForTab(oldTab);
  if (currentList) {
    currentIndex = currentList.findIndex(f => f.path === currentFilePath);
  }
  
  currentSceneTab = tab;
  updateTabUI();
  
  // Get target files
  const targetList = getFilesForTab(tab);
  if (targetList && targetList.length > 0) {
    let targetFile = null;
    if (currentIndex >= 0 && currentIndex < targetList.length) {
      targetFile = targetList[currentIndex];
    } else {
      targetFile = targetList[0];
    }
    if (targetFile) {
      await loadFile(targetFile.path);
    }
  } else {
    // If no files in target tab, just update scenes panel
    updateScenePanel(globalEntries);
  }
}

function getFilesForTab(tab) {
  const filesOnly = globalEntries.filter(file => file.type === 'file');
  if (tab === 'raw') {
    const raw = filesOnly.filter(file => isIndexHtmlKind(file.name));
    raw.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return raw;
  }
  if (tab === 'resolved') {
    const resolved = filesOnly.filter(file => isResolvedHtmlKind(file.name));
    resolved.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return resolved;
  }
  if (tab === 'rendered') {
    const rendered = filesOnly.filter(file => isRenderedKind(file.name));
    rendered.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return rendered;
  }
  return [];
}

const sceneListContainer = document.getElementById('scene-list');
const agentToggleBtn = document.getElementById('agent-toggle-btn');
const timelineRuler = document.getElementById('timeline-ruler');

// The reusable player owns iframe playback; this shell owns files, controls,
// viewport sizing, timeline visualization, and server commands.
const player = createLecturePlayer({
  iframe: frame,
  subtitleElement: subtitleOverlay,
  resolveSrc: fileUrl,
  subtitlesEnabled: true,
  liveTtsEnabled: true,
  onStatus: setStatus
});

function playerState() {
  return lastPlayerState || player.snapshot();
}

function narrationCuesFromPlayer() {
  const state = playerState();
  return (Array.isArray(state.timeline) ? state.timeline : [])
    .filter(cue => cue?.item?.kind === 'narration+visual' && cue.item.id && cue.item.text)
    .map(cue => ({
      id: String(cue.item.id),
      start: Number(cue.start) || 0,
      end: Number(cue.end) || 0,
      caption: String(cue.item.text),
      spokenText: String(cue.item.ttsText || cue.item.text)
    }));
}

function selectedNarrationSection() {
  return narrationSections.find(section => section.id === narrationSectionSelect.value) || null;
}

function renderNarrationSelection() {
  const section = selectedNarrationSection();
  if (!section) return;
  narrationCaption.value = section.caption;
  narrationSpokenText.value = section.spokenText;
  narrationStatus.textContent = '';
  narrationStatus.className = '';
}

function openNarrationDialog() {
  narrationSections = narrationCuesFromPlayer();
  if (!narrationSections.length) {
    setStatus('No narration cues are available in this file');
    return;
  }

  const currentTime = Number(playerState().time) || 0;
  const active = narrationSections.find(section => currentTime >= section.start && currentTime < section.end) ||
    narrationSections.reduce((nearest, section) =>
      Math.abs(section.start - currentTime) < Math.abs(nearest.start - currentTime) ? section : nearest
    );

  narrationSectionSelect.textContent = '';
  for (const section of narrationSections) {
    const option = document.createElement('option');
    option.value = section.id;
    const excerpt = section.caption.length > 58 ? section.caption.slice(0, 55) + '...' : section.caption;
    option.textContent = section.id + '  ·  ' + formatTimecode(section.start) + '  ·  ' + excerpt;
    narrationSectionSelect.appendChild(option);
  }
  narrationSectionSelect.value = active.id;
  renderNarrationSelection();
  narrationDialog.classList.add('visible');
  narrationSpokenText.focus();
  narrationSpokenText.select();
}

function closeNarrationDialog() {
  narrationDialog.classList.remove('visible');
  narrationStatus.textContent = '';
  narrationStatus.className = '';
}

async function regenerateNarrationSection(event) {
  event.preventDefault();
  const section = selectedNarrationSection();
  const captionText = narrationCaption.value.trim();
  const spokenText = narrationSpokenText.value.trim();
  if (!section || !captionText || !spokenText) {
    narrationStatus.textContent = 'Caption and spoken text cannot be empty.';
    narrationStatus.className = 'error';
    return;
  }

  narrationRegenerateButton.disabled = true;
  narrationCloseButton.disabled = true;
  narrationStatus.textContent = 'Regenerating ' + section.id + ' with ' + resolveTtsVoice.value + '...';
  narrationStatus.className = '';
  startJobStatus('Regenerating narration cue ' + section.id);
  try {
    const response = await fetch('/regenerate-narration-section', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: currentFilePath,
        sectionId: section.id,
        text: captionText,
        ttsText: spokenText,
        ttsVoice: resolveTtsVoice.value,
        ttsSpeed: resolveTtsSpeed.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Narration regeneration failed');

    section.caption = captionText;
    section.spokenText = spokenText;
    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    player.seek(section.start);
    closeNarrationDialog();
    setStatus('Regenerated narration cue ' + section.id);
    finishJobStatus('Done: ' + section.id);
    playNotificationSound(true);
  } catch (error) {
    narrationStatus.textContent = error.message;
    narrationStatus.className = 'error';
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    narrationRegenerateButton.disabled = false;
    narrationCloseButton.disabled = false;
  }
}

function visibleTextFromCurrentFrame() {
  let doc;
  try {
    doc = frame.contentDocument;
  } catch {
    return [];
  }
  if (!doc?.body) return [];

  const isVisible = element => {
    let current = element;
    while (current && current !== doc.documentElement) {
      const style = frame.contentWindow.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      current = current.parentElement;
    }
    return element.getClientRects().length > 0;
  };

  const found = new Set();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName) || !isVisible(parent)) continue;
    const text = node.textContent.replace(/\\s+/g, ' ').trim();
    if (text && text.length <= 500) found.add(text);
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function setVisualEditorMode(mode) {
  visualEditorMode = mode === 'exact' ? 'exact' : 'prompt';
  const isPrompt = visualEditorMode === 'prompt';
  visualPromptTab.classList.toggle('active', isPrompt);
  visualExactTab.classList.toggle('active', !isPrompt);
  visualPromptTab.setAttribute('aria-selected', String(isPrompt));
  visualExactTab.setAttribute('aria-selected', String(!isPrompt));
  visualPromptSection.hidden = !isPrompt;
  visualExactSection.hidden = isPrompt;
  visualPromptApplyButton.hidden = !isPrompt;
  visualTextApplyButton.hidden = isPrompt;
  visualTextSubtitle.textContent = isPrompt
    ? 'Describe one focused visual change for this scene.'
    : 'Correct exact on-screen wording without using the model.';
}

async function loadVisualTextCandidates() {
  if (visualTextCandidatesLoaded) return;
  visualTextStatus.textContent = 'Reading text from this scene...';
  visualTextStatus.className = '';
  let candidates = visibleTextFromCurrentFrame();
  try {
    const response = await fetch('/visual-text-candidates?file=' + encodeURIComponent(currentFilePath));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not read scene text');
    candidates = [...new Set([...candidates, ...(Array.isArray(payload.candidates) ? payload.candidates : [])])]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  } catch (error) {
    visualTextStatus.textContent = error.message;
    visualTextStatus.className = 'error';
  }
  visualTextSelect.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = candidates.length ? 'Choose text from the current frame' : 'No visible text detected — enter it below';
  visualTextSelect.appendChild(placeholder);
  for (const text of candidates) {
    const option = document.createElement('option');
    option.value = text;
    option.textContent = text.length > 92 ? text.slice(0, 89) + '...' : text;
    visualTextSelect.appendChild(option);
  }
  visualTextFind.value = '';
  visualTextReplacement.value = '';
  if (candidates.length) {
    visualTextStatus.textContent = '';
    visualTextStatus.className = '';
  }
  visualTextCandidatesLoaded = true;
  if (candidates.length) visualTextSelect.focus();
  else visualTextFind.focus();
}

function openVisualTextDialog() {
  visualTextDialog.classList.add('visible');
  visualTextCandidatesLoaded = false;
  visualPrompt.value = '';
  visualTextFind.value = '';
  visualTextReplacement.value = '';
  visualTextStatus.textContent = '';
  visualTextStatus.className = '';
  setVisualEditorMode('prompt');
  visualPrompt.focus();
}

function closeVisualTextDialog() {
  visualTextDialog.classList.remove('visible');
  visualTextStatus.textContent = '';
  visualTextStatus.className = '';
}

async function applyVisualTextEdit(event) {
  event?.preventDefault();
  const oldText = visualTextFind.value.trim();
  const newText = visualTextReplacement.value.trim();
  if (!oldText) {
    visualTextStatus.textContent = 'Choose or enter the current text to replace. Leave replacement empty to delete it.';
    visualTextStatus.className = 'error';
    return;
  }
  if (oldText === newText) {
    visualTextStatus.textContent = 'The replacement is unchanged.';
    visualTextStatus.className = 'error';
    return;
  }

  setVisualEditorBusy(true);
  visualTextStatus.textContent = 'Applying exact text change...';
  visualTextStatus.className = '';
  try {
    const currentTime = Number(playerState().time) || 0;
    const response = await fetch('/edit-visual-text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: currentFilePath,
        oldText,
        newText,
        ttsVoice: resolveTtsVoice.value,
        ttsSpeed: resolveTtsSpeed.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Visual text edit failed');

    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    player.seek(currentTime);
    closeVisualTextDialog();
    const count = Number(payload.edits?.htmlReplacements) || 1;
    setStatus('Updated ' + count + ' visual text match' + (count === 1 ? '' : 'es'));
  } catch (error) {
    visualTextStatus.textContent = error.message;
    visualTextStatus.className = 'error';
  } finally {
    setVisualEditorBusy(false);
  }
}

function setVisualEditorBusy(isBusy) {
  visualTextApplyButton.disabled = isBusy;
  visualPromptApplyButton.disabled = isBusy;
  visualTextCloseButton.disabled = isBusy;
  visualPromptTab.disabled = isBusy;
  visualExactTab.disabled = isBusy;
}

async function regenerateVisualScene(event) {
  event?.preventDefault();
  const instruction = visualPrompt.value.trim();
  if (!instruction) {
    visualTextStatus.textContent = 'Describe the visual change to make.';
    visualTextStatus.className = 'error';
    return;
  }

  setVisualEditorBusy(true);
  visualTextStatus.textContent = 'Editing only this scene...';
  visualTextStatus.className = '';
  startJobStatus('Editing visual in ' + fileBaseName(currentFilePath));
  try {
    const currentTime = Number(playerState().time) || 0;
    const response = await fetch('/regenerate-visual-scene', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: currentFilePath,
        instruction,
        ttsVoice: resolveTtsVoice.value,
        ttsSpeed: resolveTtsSpeed.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Visual scene edit failed');

    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    player.seek(currentTime);
    closeVisualTextDialog();
    setStatus('Updated visual in ' + fileBaseName(payload.path));
    finishJobStatus('Visual edit complete');
    playNotificationSound(true);
  } catch (error) {
    visualTextStatus.textContent = error.message;
    visualTextStatus.className = 'error';
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    setVisualEditorBusy(false);
  }
}

function submitVisualEditor(event) {
  if (visualEditorMode === 'exact') {
    applyVisualTextEdit(event);
  } else {
    regenerateVisualScene(event);
  }
}

function resizePreview() {
  const wrapRect = frameWrap.getBoundingClientRect();
  const margin = isFullscreenActive() ? 0 : 32;
  const availableWidth = Math.max(1, wrapRect.width - margin);
  const availableHeight = Math.max(1, wrapRect.height - margin);
  const scale = Math.min(availableWidth / renderViewport.width, availableHeight / renderViewport.height);

  previewShell.style.width = Math.floor(renderViewport.width * scale) + 'px';
  previewShell.style.height = Math.floor(renderViewport.height * scale) + 'px';
  
  [frame, framePreload].forEach(f => {
    if (!f) return;
    f.width = renderViewport.width;
    f.height = renderViewport.height;
    f.style.width = renderViewport.width + 'px';
    f.style.height = renderViewport.height + 'px';
    f.style.transform = 'scale(' + scale + ')';
  });
  
  viewportText.textContent = renderViewport.width + 'x' + renderViewport.height + ' @ ' + scale.toFixed(3) + 'x';
  syncViewportPreset();
}

function syncViewportPreset() {
  const value = renderViewport.width + 'x' + renderViewport.height;
  const hasPreset = Array.from(viewportPreset.options).some(option => option.value === value);
  viewportPreset.value = hasPreset ? value : 'custom';
}

function setPreviewViewport(width, height, reload = false) {
  const nextWidth = Number(width);
  const nextHeight = Number(height);
  if (!Number.isInteger(nextWidth) || nextWidth <= 0 || !Number.isInteger(nextHeight) || nextHeight <= 0) return;
  if (renderViewport.width === nextWidth && renderViewport.height === nextHeight) return;

  renderViewport = { width: nextWidth, height: nextHeight };
  resizePreview();

  if (reload && currentFilePath) {
    loadFile(currentFilePath);
    return;
  }

  const state = playerState();
  if (state.loaded) player.seek(state.time, { resume: state.playing });
}
`;
}
