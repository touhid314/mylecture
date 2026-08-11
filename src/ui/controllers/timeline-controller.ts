// @ts-nocheck
export function renderTimelineController(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
function formatTimeShort(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return minutes + ':' + String(secs).padStart(2, '0');
}

function formatTimecode(seconds) {
  seconds = Math.max(0, seconds);
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  return minutes + ':' + String(secs).padStart(2, '0') + '.' + String(hundredths).padStart(2, '0');
}

let isDraggingTimeline = false;
let isLoadFilePending = false;

// Timeline dragging maps a global lecture time back to the correct scene file.
function handleTimelinePointerDown(event) {
  if (event.button !== 0) return;
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  if (isMp4) return;
  isDraggingTimeline = true;
  if (timelineRuler) {
    timelineRuler.setPointerCapture(event.pointerId);
  }
  seekFromTimelineEvent(event);
}

function handleTimelinePointerMove(event) {
  if (!isDraggingTimeline) return;
  seekFromTimelineEvent(event);
}

function handleTimelinePointerUp(event) {
  if (!isDraggingTimeline) return;
  isDraggingTimeline = false;
  if (timelineRuler) {
    try {
      timelineRuler.releasePointerCapture(event.pointerId);
    } catch (e) {}
  }
}

async function seekFromTimelineEvent(event) {
  if (!timelineRuler || currentScenesList.length === 0) return;
  const rect = timelineRuler.getBoundingClientRect();
  const clickedX = event.clientX - rect.left;
  const clickedTime = Math.max(0, clickedX / currentSecWidth);
  await seekToGlobalTime(clickedTime);
}

// Convert one global lecture time into a scene file plus local time inside that
// scene. If the target scene is already preloaded, swap iframes instead of
// waiting for a fresh load.
async function seekToGlobalTime(globalTime) {
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  if (isMp4) return;
  
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  if (activeScene && activeScene.isNonTime) return;
  
  if (currentScenesList.length === 0) {
    player.seek(globalTime);
    return;
  }
  
  let targetScene = currentScenesList.find(file => globalTime >= file.timelineStart && globalTime < file.timelineStart + file.duration);
  if (!targetScene) {
    targetScene = currentScenesList[currentScenesList.length - 1];
  }
  if (!targetScene) return;
  
  const localTime = Math.max(0, Math.min(targetScene.duration, globalTime - targetScene.timelineStart));
  const wasPlaying = playerState().playing;
  
  if (targetScene.path !== currentFilePath) {
    if (preloadedFilePath === targetScene.path && !isPreloading) {
      await swapToPreloadedScene(targetScene.path, wasPlaying);
      player.seek(localTime);
    } else {
      if (isLoadFilePending) return;
      isLoadFilePending = true;
      const success = await loadFile(targetScene.path);
      isLoadFilePending = false;
      if (success) {
        player.seek(localTime);
        if (wasPlaying) player.play();
        else player.pause();
      }
    }
  } else {
    player.seek(localTime);
  }
}

async function seekGlobalBy(seconds) {
  const isMp4 = fileExtension(currentFilePath) === 'mp4';
  if (isMp4) return;

  const state = playerState();
  if (!state.loaded) return;
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  const globalTime = activeScene ? (activeScene.timelineStart + state.time) : state.time;
  const totalDuration = currentScenesList.length > 0
    ? currentScenesList.reduce((acc, file) => acc + file.duration, 0)
    : state.duration;
  const targetTime = Math.max(0, Math.min(totalDuration, globalTime + seconds));
  await seekToGlobalTime(targetTime);
}

// Keep the visual playhead aligned with the active scene and update scene
// duration metadata once the player knows the true duration.
function updatePlayheadPosition(state = playerState()) {
  const playhead = document.getElementById('timeline-playhead');
  const container = document.getElementById('timeline-container');
  if (!playhead || !container) return;
  
  if (!state.loaded || currentScenesList.length === 0 || state.interactiveActive || state.gameActive) {
    playhead.classList.remove('visible');
    return;
  }
  
  const activeScene = currentScenesList.find(file => file.path === currentFilePath);
  if (!activeScene || activeScene.isNonTime) {
    playhead.classList.remove('visible');
    return;
  }
  
  if (state.duration > 0 && Math.abs(activeScene.duration - state.duration) > 0.5) {
    activeScene.duration = state.duration;
    
    let accumulatedTime = 0;
    currentScenesList.forEach(file => {
      file.timelineStart = accumulatedTime;
      accumulatedTime += file.duration;
    });
    
    const totalDuration = accumulatedTime;
    const containerWidth = container.clientWidth;
    if (containerWidth > 0 && totalDuration > 0) {
      currentSecWidth = Math.max(3, (containerWidth - 24) / totalDuration);
    }
    
    const timelineContent = document.getElementById('timeline-content');
    if (timelineContent) {
      timelineContent.style.setProperty('--sec-width', currentSecWidth + 'px');
      const totalWidth = accumulatedTime * currentSecWidth;
      timelineContent.style.width = totalWidth + 'px';
    }
    
    const cards = sceneListContainer.querySelectorAll('.scene-card');
    currentScenesList.forEach((file, index) => {
      const card = cards[index];
      if (card) {
        if (!file.isNonTime) {
          card.style.setProperty('--scene-duration', file.duration);
          const nameDiv = card.querySelector('.scene-card-name');
          if (nameDiv) nameDiv.textContent = file.name + ' (' + file.duration.toFixed(1) + 's)';
        }
      }
    });
    
    const ruler = document.getElementById('timeline-ruler');
    if (ruler) {
      ruler.innerHTML = '';
      let interval = 5;
      if (totalDuration > 120) interval = 10;
      if (totalDuration > 300) interval = 30;
      if (totalDuration > 900) interval = 60;
      
      for (let sec = 0; sec <= totalDuration; sec += interval) {
        const tick = document.createElement('div');
        tick.className = 'ruler-tick';
        tick.style.left = (sec * currentSecWidth) + 'px';
        tick.classList.add('major');
        const label = document.createElement('span');
        label.className = 'ruler-label';
        label.textContent = formatTimeShort(sec);
        tick.appendChild(label);
        ruler.appendChild(tick);
      }
    }
  }
  
  const globalTime = activeScene.timelineStart + state.time;
  const playheadLeft = globalTime * currentSecWidth;
  
  playhead.style.left = playheadLeft + 'px';
  playhead.classList.add('visible');
  
  if (state.playing) {
    container.scrollLeft = playheadLeft - container.clientWidth / 2;
  } else {
    const scrollLeft = container.scrollLeft;
    const clientWidth = container.clientWidth;
    if (playheadLeft < scrollLeft || playheadLeft > scrollLeft + clientWidth - 40) {
      container.scrollLeft = playheadLeft - clientWidth / 2;
    }
  }
}

let preloadedFilePath = '';
let isPreloading = false;

// Preload the next scene in a hidden iframe to reduce gaps during playback.
function preloadNextScene() {
  if (currentScenesList.length === 0) return;
  const currentIndex = currentScenesList.findIndex(file => file.path === currentFilePath);
  if (currentIndex > -1 && currentIndex < currentScenesList.length - 1) {
    const nextScene = currentScenesList[currentIndex + 1];
    const nextPath = nextScene.path;
    
    if (preloadedFilePath === nextPath || isPreloading) return;
    
    preloadedFilePath = nextPath;
    isPreloading = true;
    
    framePreload.src = fileUrl(nextPath);
    
    const handlePreloadLoad = () => {
      isPreloading = false;
      framePreload.removeEventListener('load', handlePreloadLoad);
    };
    framePreload.addEventListener('load', handlePreloadLoad);
  } else {
    preloadedFilePath = '';
    framePreload.src = 'about:blank';
  }
}

// Promote the hidden preload iframe to the active preview iframe.
async function swapToPreloadedScene(nextPath, shouldPlay = true) {
  if (preloadedFilePath !== nextPath || isPreloading) {
    await loadFile(nextPath);
    if (shouldPlay) player.play();
    else player.pause();
    return;
  }
  
  // Clear all playback state before adopting the already-loaded iframe. In
  // particular, this detaches a previous native MP4 element so play() cannot
  // rewind and restart its audio after the visual frame has changed.
  player.prepareForFrameSwap(nextPath);
  frame.removeEventListener('load', player.boundFrameLoad);
  
  frame.style.display = 'none';
  framePreload.style.display = 'block';
  
  const temp = frame;
  frame = framePreload;
  framePreload = temp;
  
  player.iframe = frame;
  frame.addEventListener('load', player.boundFrameLoad);
  
  setCurrentFile(nextPath);
  player.handleFrameLoad();
  if (shouldPlay) player.play();
  else player.pause();
  
  preloadedFilePath = '';
  preloadNextScene();
}
`;
}
