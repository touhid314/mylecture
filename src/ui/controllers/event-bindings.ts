// @ts-nocheck
export function renderEventBindings(context = {}) {
  const { agentConfig, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, viewerVersion } = context;
  return `
// DOM event wiring lives together so future UI changes can audit behavior from
// one place instead of chasing listeners across helper functions.
loadButton.addEventListener('click', pickAndLoadFile);
openFolderButton.addEventListener('click', openCurrentFolder);
refreshFolderButton.addEventListener('click', refreshFolderFiles);
copyFolderPathButton.addEventListener('click', async () => {
  if (!currentBrowserFolder) return;
  try {
    await navigator.clipboard.writeText(currentBrowserFolder);
    const originalTitle = copyFolderPathButton.title;
    copyFolderPathButton.title = 'Copied!';
    setStatus('Folder path copied to clipboard');
    
    copyFolderPathButton.innerHTML = '<svg class="control-icon" style="width: 14px; height: 14px; color: #b8f7c8;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    
    setTimeout(() => {
      copyFolderPathButton.title = originalTitle;
      copyFolderPathButton.innerHTML = '<svg class="control-icon" style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    }, 1500);
  } catch (err) {
    setStatus('Failed to copy: ' + err.message);
  }
});
infoButton.addEventListener('click', openInfoDialog);
infoCloseButton.addEventListener('click', closeInfoDialog);
infoDialog.addEventListener('click', event => {
  if (event.target === infoDialog) closeInfoDialog();
});
publishButton.addEventListener('click', openPublishDialog);
publishCloseButton.addEventListener('click', closePublishDialog);
publishCancelButton.addEventListener('click', closePublishDialog);
publishDialog.addEventListener('click', event => {
  if (event.target === publishDialog) closePublishDialog();
});
publishCourseSelect.addEventListener('change', handleCourseSelectChange);
publishForm.addEventListener('submit', handlePublishSubmit);
reloadButton.addEventListener('click', () => loadFile());
resolveMenuToggle.addEventListener('click', event => {
  event.stopPropagation();
  setResolveOptionsVisible(!resolveOptions.classList.contains('visible'));
  setRenderOptionsVisible(false);
});
resolveOptions.addEventListener('click', event => {
  event.stopPropagation();
});
renderMenuToggle.addEventListener('click', event => {
  event.stopPropagation();
  setRenderOptionsVisible(!renderOptions.classList.contains('visible'));
  setResolveOptionsVisible(false);
});
renderOptions.addEventListener('click', event => {
  event.stopPropagation();
});
document.addEventListener('click', () => {
  setResolveOptionsVisible(false);
  setRenderOptionsVisible(false);
});
sidebarResolveButton.addEventListener('click', runResolve);
sidebarRenderButton.addEventListener('click', runRender);
const stopJobBtn = document.getElementById('stop-job-btn');
if (stopJobBtn) {
  stopJobBtn.addEventListener('click', runStopJob);
}
playButton.addEventListener('click', () => player.togglePlay());
seekBackButton.addEventListener('click', () => seekGlobalBy(-5));
seekForwardButton.addEventListener('click', () => seekGlobalBy(5));
subtitlesToggle.addEventListener('click', () => {
  const state = playerState();
  player.setSubtitlesEnabled(!state.subtitlesEnabled);
});
liveTtsToggle.addEventListener('click', () => {
  const state = playerState();
  player.setLiveTtsEnabled(!state.liveTtsEnabled);
});
narrationEditButton.addEventListener('click', openNarrationDialog);
narrationCloseButton.addEventListener('click', closeNarrationDialog);
narrationDialog.addEventListener('click', event => {
  if (event.target === narrationDialog) closeNarrationDialog();
});
narrationSectionSelect.addEventListener('change', renderNarrationSelection);
narrationResetButton.addEventListener('click', () => {
  narrationSpokenText.value = narrationCaption.value;
});
narrationForm.addEventListener('submit', regenerateNarrationSection);
visualTextEditButton.addEventListener('click', openVisualTextDialog);
visualTextCloseButton.addEventListener('click', closeVisualTextDialog);
visualTextDialog.addEventListener('click', event => {
  if (event.target === visualTextDialog) closeVisualTextDialog();
});
visualTextSelect.addEventListener('change', () => {
  if (!visualTextSelect.value) return;
  visualTextFind.value = visualTextSelect.value;
  visualTextReplacement.value = visualTextSelect.value;
  visualTextReplacement.focus();
  visualTextReplacement.select();
});
visualPromptTab.addEventListener('click', () => {
  setVisualEditorMode('prompt');
  visualPrompt.focus();
});
visualExactTab.addEventListener('click', async () => {
  setVisualEditorMode('exact');
  await loadVisualTextCandidates();
});
visualTextForm.addEventListener('submit', submitVisualEditor);
volumeToggle.addEventListener('click', () => {
  const state = playerState();
  const volume = Number(state.volume ?? volumeSlider.value) || 1;
  player.setVolume(volume <= 0 ? 1 : volume, { muted: !state.muted });
});
volumeSlider.addEventListener('input', event => {
  player.setVolume(Number(event.target.value), { muted: Number(event.target.value) <= 0 });
});
scrubber.addEventListener('input', event => {
  seekToGlobalTime(Number(event.target.value));
});
const tabsContainer = document.getElementById('scenes-tabs');
if (tabsContainer) {
  tabsContainer.addEventListener('click', event => {
    const btn = event.target.closest('.scenes-tab-btn');
    if (btn) {
      const tab = btn.getAttribute('data-tab');
      switchSceneTab(tab);
    }
  });
}
scrubber.addEventListener('pointerdown', seekFromPointer);
scrubber.addEventListener('click', seekFromPointer);
interactiveMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  const interactiveFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'interactive.html');
  if (interactiveFile) {
    loadFile(interactiveFile.path);
  } else {
    player.seekToInteractive();
  }
});
interactiveMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  const interactiveFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'interactive.html');
  if (interactiveFile) {
    loadFile(interactiveFile.path);
  } else {
    player.seekToInteractive();
  }
});
gameMarker.addEventListener('pointerdown', event => {
  event.preventDefault();
  event.stopPropagation();
  const gameFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'game.html');
  if (gameFile) {
    loadFile(gameFile.path);
  } else {
    player.seekToGame();
  }
});
gameMarker.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  const gameFile = globalEntries.find(file => file.type === 'file' && file.name.toLowerCase() === 'game.html');
  if (gameFile) {
    loadFile(gameFile.path);
  } else {
    player.seekToGame();
  }
});
speedSelect.addEventListener('change', () => {
  player.setSpeed(Number(speedSelect.value) || 1);
});
viewportPreset.addEventListener('change', event => {
  const value = event.target.value;
  if (value === 'custom') return;
  const [width, height] = value.split('x').map(Number);
  userViewportOverride = true;
  setPreviewViewport(width, height, true);
});
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenState);
document.addEventListener('webkitfullscreenchange', updateFullscreenState);
document.addEventListener('touchstart', event => {
  if (!isFullscreenActive()) return;
  lastTouchTime = Date.now();
  if (controls && controls.contains(event.target)) {
    showFullscreenControls(4000);
    return;
  }
  toggleFullscreenControls();
}, { passive: true });
document.addEventListener('mousemove', event => {
  if (!isFullscreenActive()) return;
  if (Date.now() - lastTouchTime < 1000) return;
  if (event.clientY >= window.innerHeight - 92) showFullscreenControls(2000);
  else hideFullscreenControls();
});
document.addEventListener('keydown', handleViewerShortcut, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (infoDialog.classList.contains('visible')) {
      event.preventDefault();
      closeInfoDialog();
    } else if (narrationDialog.classList.contains('visible')) {
      event.preventDefault();
      closeNarrationDialog();
    } else if (visualTextDialog.classList.contains('visible')) {
      event.preventDefault();
      closeVisualTextDialog();
    } else if (publishDialog && publishDialog.style.display === 'grid') {
      event.preventDefault();
      closePublishDialog();
    }
  }
});
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
}
window.addEventListener('resize', () => {
  resizePreview();
  if (currentScenesList.length > 0) {
    updateScenePanel(currentScenesList);
  }
});
window.addEventListener('orientationchange', () => {
  setTimeout(resizePreview, 150);
});

if (timelineRuler) {
  timelineRuler.addEventListener('pointerdown', handleTimelinePointerDown);
  timelineRuler.addEventListener('pointermove', handleTimelinePointerMove);
  window.addEventListener('pointerup', handleTimelinePointerUp);
  window.addEventListener('pointercancel', handleTimelinePointerUp);
}
if (agentToggleBtn) {
  agentToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('agent-collapsed');
    
    const isCollapsed = document.body.classList.contains('agent-collapsed');
    agentToggleBtn.innerHTML = isCollapsed
      ? '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>'
      : '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 18 17 12 11 6"></polyline></svg>';
    
    setTimeout(resizePreview, 210);
  });
}

// Right panel starts expanded by default.
if (agentToggleBtn) {
  agentToggleBtn.innerHTML = '<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 18 17 12 11 6"></polyline></svg>';
}
`;
}
