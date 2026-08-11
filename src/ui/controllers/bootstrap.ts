// @ts-nocheck
export function renderBootstrap(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
// Initial boot: hydrate state, load the requested file, and start server polling.
if (agentBody) {
  agentBody.innerHTML = '';
}
setAgentPhase('generate');

setCurrentFile(currentFilePath);
resizePreview();
updateControls(player.snapshot());
setIconButton(fullscreenButton, 'fullscreen', 'Fullscreen');
refreshFolderFiles();
if (currentFilePath) loadFile();
setInterval(pollViewerCommands, 750);
</script>
</body>
</html>`;
}
