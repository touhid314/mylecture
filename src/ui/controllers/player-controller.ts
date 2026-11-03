// @ts-nocheck
export function renderPlayerController(context = {}) {
  const { agentConfig, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, viewerVersion } = context;
  return `
function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.body.classList.contains('pseudo-fullscreen')
  );
}

let lastTouchTime = 0;

// Fullscreen keeps the preview dominant while briefly revealing controls on input.
function showFullscreenControls(duration = 3000) {
  if (!isFullscreenActive()) return;
  document.body.classList.add('controls-visible');
  clearTimeout(controlsHideTimer);
  controlsHideTimer = setTimeout(() => {
    document.body.classList.remove('controls-visible');
  }, duration);
}

function hideFullscreenControls() {
  if (!isFullscreenActive()) return;
  document.body.classList.remove('controls-visible');
  clearTimeout(controlsHideTimer);
}

function toggleFullscreenControls() {
  if (!isFullscreenActive()) return;
  if (document.body.classList.contains('controls-visible')) {
    hideFullscreenControls();
  } else {
    showFullscreenControls(3500);
  }
}

function updateFullscreenState() {
  const active = isFullscreenActive();
  document.body.classList.toggle('fullscreen-active', active);
  document.body.classList.remove('controls-visible');
  clearTimeout(controlsHideTimer);
  if (active && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  setIconButton(fullscreenButton, active ? 'fullscreenExit' : 'fullscreen', active ? 'Exit fullscreen' : 'Fullscreen');
  resizePreview();
}

async function toggleFullscreen() {
  try {
    if (isFullscreenActive()) {
      if (document.body.classList.contains('pseudo-fullscreen')) {
        document.body.classList.remove('pseudo-fullscreen');
        updateFullscreenState();
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      } else {
        document.body.classList.remove('pseudo-fullscreen');
        updateFullscreenState();
      }
    } else {
      const docEl = document.documentElement;
      let nativeSuccess = false;
      if (docEl.requestFullscreen) {
        try {
          await docEl.requestFullscreen();
          nativeSuccess = true;
        } catch (err) {
          // Native fullscreen call failed (e.g. non-secure HTTP context or browser policy)
        }
      } else if (docEl.webkitRequestFullscreen) {
        try {
          await docEl.webkitRequestFullscreen();
          nativeSuccess = true;
        } catch (err) {
          // WebKit native fullscreen failed
        }
      }

      if (!nativeSuccess && !isFullscreenActive()) {
        document.body.classList.add('pseudo-fullscreen');
        updateFullscreenState();
      }
    }
  } catch (error) {
    if (!isFullscreenActive()) {
      document.body.classList.add('pseudo-fullscreen');
      updateFullscreenState();
    } else {
      document.body.classList.remove('pseudo-fullscreen');
      updateFullscreenState();
    }
  }
}

function formatTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes + ':' + secs.toFixed(2).padStart(5, '0');
}

// Pull player state into the surrounding IDE controls and timeline indicators.
function updateControls(state = playerState()) {
  lastPlayerState = state;
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  const globalTime = activeScene ? (activeScene.timelineStart + state.time) : state.time;
  const totalDuration = currentScenesList.length > 0
    ? currentScenesList.reduce((acc, file) => acc + file.duration, 0)
    : (state.duration || 1);

  scrubber.max = String(totalDuration || 1);
  scrubber.value = String(globalTime || 0);
  timeReadout.textContent = formatTime(globalTime) + ' / ' + formatTime(totalDuration);
  setIconButton(playButton, state.playing ? 'pause' : 'play', state.playing ? 'Pause' : 'Play');
  playButton.classList.toggle('active', state.playing);
  subtitlesToggle.classList.toggle('active', state.subtitlesEnabled);
  subtitlesToggle.setAttribute('aria-pressed', state.subtitlesEnabled ? 'true' : 'false');
  liveTtsToggle.classList.toggle('active', state.liveTtsEnabled);
  liveTtsToggle.setAttribute('aria-pressed', state.liveTtsEnabled ? 'true' : 'false');
  const effectiveVolume = Math.max(0, Math.min(1, Number(state.volume ?? 1)));
  const isMuted = Boolean(state.muted || effectiveVolume <= 0);
  setIconButton(volumeToggle, isMuted ? 'volumeMuted' : 'volume', isMuted ? 'Unmute' : 'Mute');
  volumeToggle.classList.toggle('active', !isMuted);
  volumeToggle.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  if (document.activeElement !== volumeSlider) volumeSlider.value = String(effectiveVolume);
  
  const hasInteractiveFile = globalEntries.some(file => file.type === 'file' && file.name.toLowerCase() === 'interactive.html');
  const hasGameFile = globalEntries.some(file => file.type === 'file' && file.name.toLowerCase() === 'game.html');

  interactiveMarker.classList.toggle('visible', hasInteractiveFile || state.interactiveTimeline.length > 0);
  gameMarker.classList.toggle('visible', hasGameFile || state.gameTimeline.length > 0);
  
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  const isNonTime = state.interactiveActive || state.gameActive;
  
  scrubber.disabled = isMp4 || isNonTime;
  seekBackButton.disabled = isMp4 || isNonTime;
  seekForwardButton.disabled = isMp4 || isNonTime;
  playButton.disabled = isNonTime;
  
  viewportPreset.disabled = isNonTime;
  if (isNonTime) {
    setPreviewViewport(1280, 720);
  }
  
  updatePlayheadPosition(state);
}

function fileUrl(filePath) {
  const cleaned = filePath.trim().replaceAll('\\\\', '/').replace(/^\\/+/, '');
  return '/files/' + cleaned + '?export=1&viewer=1&t=' + Date.now();
}

function setCurrentFile(filePath) {
  const nextFilePath = String(filePath || '').replaceAll('\\\\', '/');
  if (nextFilePath !== currentFilePath) userViewportOverride = false;
  currentFilePath = nextFilePath;
  currentFileLabel.textContent = currentFilePath || 'No file selected';
  currentFileLabel.title = currentFilePath;
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  document.body.classList.toggle('file-kind-mp4', isMp4);
  
  const targetTab = getSceneTabForFile(currentFilePath);
  if (targetTab && targetTab !== currentSceneTab) {
    currentSceneTab = targetTab;
    updateTabUI();
    if (globalEntries && globalEntries.length > 0) {
      updateScenePanel(globalEntries);
    }
  } else if (sceneListContainer) {
    const cards = sceneListContainer.querySelectorAll('.scene-card');
    currentScenesList.forEach((file, index) => {
      const card = cards[index];
      if (card) {
        const isCurrent = file.path === currentFilePath;
        card.classList.toggle('active', isCurrent);
      }
    });
  }
  
  syncIdeActions();
  updatePlayheadPosition();
}

async function openCurrentFolder() {
  if (!currentBrowserFolder) return;
  try {
    const response = await fetch('/open-folder?dir=' + encodeURIComponent(currentBrowserFolder), { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Open folder failed');
    setStatus('Opened folder: ' + payload.folder);
  } catch (error) {
    setStatus(error.message);
  }
}

// Loading can target HTML/MP4 player content or document files shown directly.
async function loadFile(filePath = currentFilePath) {
  if (!filePath) {
    setStatus('Select a file first');
    return false;
  }

  if (isDocumentPreviewFile(filePath)) {
    await loadDocumentFile(filePath);
    return true;
  }

  setPreviewMode('html');
  setCurrentFile(filePath);
  videoMetadata = {};
  lastPlayerState = null;
  updateControls(player.snapshot());
  setStatus('Loading...');

  try {
    await player.load(currentFilePath);
    refreshFolderFiles();
    preloadNextScene();
    return true;
  } catch (error) {
    setStatus(error.message);
    refreshFolderFiles();
    return false;
  }
}

async function pickAndLoadFile() {
  player.pause();
  setStatus('Opening file picker...');
  try {
    const response = await fetch('/pick');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'File picker failed');
    if (!payload.path) {
      setStatus('File picker cancelled');
      return;
    }
    await loadFile(payload.path);
  } catch (error) {
    setStatus(error.message);
  }
}

// Polling lets the server-side file picker and viewport controls command this
// already-open viewer tab.
async function pollViewerCommands() {
  try {
    const response = await fetch('/viewer-state?since=' + viewerCommandVersion, { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.changed) return;

    viewerCommandVersion = Number(payload.version) || viewerCommandVersion;
    if (Number.isInteger(payload.width) && Number.isInteger(payload.height)) {
      setPreviewViewport(payload.width, payload.height);
    }
    if (payload.path && payload.path !== currentFilePath) {
      await loadFile(payload.path);
    }
  } catch {
    // The viewer can keep running even if a transient poll fails.
  }
}

function seekFromPointer(event) {
  const state = playerState();
  if (!state.loaded) return;
  const rect = scrubber.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const totalDuration = currentScenesList.length > 0
    ? currentScenesList.reduce((acc, file) => acc + file.duration, 0)
    : state.duration;
  seekToGlobalTime(ratio * totalDuration);
}

function handleViewerShortcut(event) {
  const state = playerState();
  if (state.interactiveActive || state.gameActive) {
    return;
  }
  const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
  const target = event.target;
  const isTextInput = target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;

  if (event.ctrlKey && isSpace) {
    event.preventDefault();
    event.stopPropagation();
    player.togglePlay();
  } else if (isTextInput) {
    return;
  } else if (isSpace) {
    event.preventDefault();
    event.stopPropagation();
  } else if (event.ctrlKey && event.key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    seekGlobalBy(5);
  } else if (event.ctrlKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    seekGlobalBy(-5);
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    event.stopPropagation();
    toggleFullscreen();
  }
}

// Bridge player events into the surrounding IDE controls.
player.on('ready', state => {
  frame.contentWindow.addEventListener('keydown', handleViewerShortcut, true);
  videoMetadata = state.metadata || {};
  if (!userViewportOverride && state.detectedViewport) {
    setPreviewViewport(state.detectedViewport.width, state.detectedViewport.height);
  }

  if (state.detectedViewport) {
    const val = state.detectedViewport.width + 'x' + state.detectedViewport.height;
    let exists = Array.from(renderResolution.options).some(opt => opt.value === val);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val + ' (Auto)';
      opt.id = 'render-resolution-auto';
      
      const prev = document.getElementById('render-resolution-auto');
      if (prev) prev.remove();
      
      renderResolution.prepend(opt);
    }
    renderResolution.value = val;
  }

  updateControls(state);
  setStatus(state.resolved ? 'Resolved timeline loaded' : 'Preview timeline estimated');
});
player.on('statechange', updateControls);
player.on('timeupdate', updateControls);
player.on('error', error => setStatus(error.message));

// When a scene ends, advance to the next scene file in the active tab.
player.on('ended', async () => {
  const currentIndex = currentScenesList.findIndex(file => file.path === currentFilePath);
  if (currentIndex > -1 && currentIndex < currentScenesList.length - 1) {
    const nextScene = currentScenesList[currentIndex + 1];
    setStatus('Auto-advancing to ' + nextScene.name + '...');
    // Interactive and game files are destinations, not zero-duration media.
    // Load/start them, but do not continue the timed player's play loop.
    await swapToPreloadedScene(nextScene.path, !nextScene.isNonTime);
  }
});
`;
}
