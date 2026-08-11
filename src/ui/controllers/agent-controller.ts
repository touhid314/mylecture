// @ts-nocheck
export function renderAgentController(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
// Agent chat is a thin client over ide-server; the server owns execution and log
// persistence, while the browser polls for latest step text during a run.
function appendChatMessage(text, sender = 'agent') {
  if (!agentBody) return;
  const bubble = document.createElement('div');
  bubble.className = 'chat-message ' + sender;
  
  if (sender === 'user' || sender === 'error') {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }
  
  agentBody.appendChild(bubble);
  agentBody.scrollTop = agentBody.scrollHeight;
}

function getLatestStepFromLog(logText) {
  if (!logText) return '';
  const cleanLog = logText.replace(/\\x1B\\[[0-9;]*[a-zA-Z]/g, '');
  const lines = cleanLog.split(/\\r?\\n/);
  const stepLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().includes('[step ')) {
      stepLines.push(trimmed);
    }
  }
  if (stepLines.length > 0) {
    const lastLine = stepLines[stepLines.length - 1];
    const match = lastLine.match(/\\[step\\s+(\\d+)\\]\\s*(.*)/i);
    if (match) {
      const stepNum = match[1];
      const action = match[2];
      return "Step " + stepNum + ": " + action;
    }
    return lastLine;
  }
  return '';
}

function showThinking(statusText = 'Agent is starting...') {
  if (!agentBody) return;
  const bubble = document.createElement('div');
  bubble.className = 'thinking-bubble';
  bubble.id = 'agent-thinking';
  const label = document.createElement('span');
  label.textContent = statusText;
  bubble.append(label);
  const dots = document.createElement('div');
  dots.className = 'dot-flashing';
  bubble.append(dots);
  agentBody.appendChild(bubble);
  agentBody.scrollTop = agentBody.scrollHeight;
}

function updateThinkingStatus(statusText) {
  const el = document.getElementById('agent-thinking');
  if (el) {
    const span = el.querySelector('span');
    if (span) {
      span.textContent = statusText;
    }
  }
}

function removeThinking() {
  const el = document.getElementById('agent-thinking');
  if (el) el.remove();
}

const agentSupportedAttachmentExts = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'bmp',
  'pdf',
  'mp4', 'mpeg', 'mpg', 'mov', 'avi', 'webm', 'wmv', '3gp', '3gpp', 'flv'
]);
let pendingAgentAttachments = [];
let agentThemes = [];
let agentDefaultThemeId = 'default';
let agentTeachingStyles = [];
let agentDefaultTeachingStyleId = 'default';

function getFileExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\\.([^.]+)$/);
  return match ? match[1] : '';
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

function addAgentAttachments(files) {
  const rejected = [];
  for (const file of Array.from(files || [])) {
    const ext = getFileExtension(file.name);
    if (!agentSupportedAttachmentExts.has(ext)) {
      rejected.push(file.name);
      continue;
    }
    const duplicate = pendingAgentAttachments.some(item =>
      item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
    );
    if (!duplicate) pendingAgentAttachments.push(file);
  }
  renderAgentAttachments();
  if (rejected.length > 0) {
    appendChatMessage('Unsupported attachment type: ' + rejected.join(', '), 'error');
  }
}

function extensionForImageMimeType(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/bmp') return 'bmp';
  return 'png';
}

function clipboardImageFiles(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const files = [];
  for (const item of items) {
    if (item.kind !== 'file' || !String(item.type || '').startsWith('image/')) {
      continue;
    }
    const clipboardFile = item.getAsFile();
    if (!clipboardFile) continue;
    const ext = extensionForImageMimeType(clipboardFile.type);
    const name = clipboardFile.name && clipboardFile.name.includes('.')
      ? clipboardFile.name
      : 'pasted-image-' + Date.now() + '-' + (files.length + 1) + '.' + ext;
    files.push(new File([clipboardFile], name, {
      type: clipboardFile.type || 'image/png',
      lastModified: Date.now()
    }));
  }
  return files;
}

function removeAgentAttachment(index) {
  pendingAgentAttachments.splice(index, 1);
  renderAgentAttachments();
}

function renderAgentAttachments() {
  if (!agentAttachmentList) return;
  agentAttachmentList.innerHTML = '';
  agentAttachmentList.classList.toggle('has-files', pendingAgentAttachments.length > 0);
  pendingAgentAttachments.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'agent-attachment-chip';
    chip.innerHTML = '<span class="agent-attachment-name" title="' + escapeText(file.name) + '">' + escapeText(file.name) + '</span><span>' + formatFileSize(file.size) + '</span>';
    const remove = document.createElement('button');
    remove.className = 'agent-attachment-remove';
    remove.type = 'button';
    remove.title = 'Remove attachment';
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.textContent = 'x';
    remove.addEventListener('click', () => removeAgentAttachment(index));
    chip.appendChild(remove);
    agentAttachmentList.appendChild(chip);
  });
}

async function uploadAgentAttachments(files) {
  if (!files.length) return [];
  const form = new FormData();
  files.forEach(file => form.append('files', file, file.name));
  const response = await fetch('/agent-upload?agentClientId=' + encodeURIComponent(agentClientId), {
    method: 'POST',
    body: form
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Attachment upload failed');
  }
  return payload.files || [];
}

function buildAttachmentPrompt(message, uploadedFiles) {
  let task = message.trim();
  if (!task && uploadedFiles.length > 0) {
    task = 'Please use the attached file(s).';
  }
  if (agentPhase === 'generate') {
    task = appendGenerationSettingsPrompt(task);
  }
  for (const file of uploadedFiles) {
    task += '\\n[(attachment: ' + file.path + ')]';
  }
  return task;
}

function buildUserAttachmentDisplay(message, files) {
  const names = files.map(file => file.name).join(', ');
  const base = message.trim() || 'Attached file(s).';
  return files.length > 0 ? base + '\\n\\nAttachments: ' + names : base;
}

const generationLengthMinSeconds = 5;
const generationLengthMaxSeconds = 900;
const generationLengthSliderMax = 1000;

function formatGenerationLength(seconds) {
  const total = clampGenerationSeconds(seconds);
  if (total < 60) return total + 's';
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes + ':' + String(remainder).padStart(2, '0');
}

function clampGenerationSeconds(seconds) {
  const raw = Number(seconds);
  if (!Number.isFinite(raw)) return 60;
  const clamped = Math.max(generationLengthMinSeconds, Math.min(generationLengthMaxSeconds, raw));
  return Math.round(clamped / 5) * 5;
}

function sliderToGenerationSeconds(value) {
  const slider = Math.max(0, Math.min(generationLengthSliderMax, Number(value) || 0));
  const progress = slider / generationLengthSliderMax;
  const ratio = generationLengthMaxSeconds / generationLengthMinSeconds;
  return clampGenerationSeconds(generationLengthMinSeconds * Math.pow(ratio, progress));
}

function generationSecondsToSlider(seconds) {
  const clamped = clampGenerationSeconds(seconds);
  const ratio = generationLengthMaxSeconds / generationLengthMinSeconds;
  const progress = Math.log(clamped / generationLengthMinSeconds) / Math.log(ratio);
  return Math.round(Math.max(0, Math.min(1, progress)) * generationLengthSliderMax);
}

function parseGenerationLength(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const clockMatch = text.match(/^(\\d{1,2}):(\\d{1,2})$/);
  if (clockMatch) {
    return clampGenerationSeconds((Number(clockMatch[1]) * 60) + Number(clockMatch[2]));
  }
  const minuteMatch = text.match(/^(\\d+(?:\\.\\d+)?)\\s*m(?:in)?s?$/);
  if (minuteMatch) {
    return clampGenerationSeconds(Number(minuteMatch[1]) * 60);
  }
  const secondMatch = text.match(/^(\\d+(?:\\.\\d+)?)\\s*s(?:ec)?s?$/);
  if (secondMatch) {
    return clampGenerationSeconds(Number(secondMatch[1]));
  }
  const number = Number(text);
  return Number.isFinite(number) ? clampGenerationSeconds(number) : null;
}

function updateGenerationLengthDisplay() {
  if (!agentGenerationLength || !agentGenerationLengthValue) return;
  const value = formatGenerationLength(sliderToGenerationSeconds(agentGenerationLength.value));
  agentGenerationLengthValue.value = value;
  agentGenerationLengthValue.style.width = Math.max(7.5, value.length + 1.5) + 'ch';
}

function commitGenerationLengthInput() {
  if (!agentGenerationLength || !agentGenerationLengthValue) return;
  const parsed = parseGenerationLength(agentGenerationLengthValue.value);
  if (parsed !== null) {
    agentGenerationLength.value = String(generationSecondsToSlider(parsed));
  }
  updateGenerationLengthDisplay();
}

function getGenerationSettingsPrompt() {
  const aspectRatio = agentAspectRatio ? agentAspectRatio.value : configuredDefaults.aspectRatio;
  const generationLength = agentGenerationLength ? formatGenerationLength(sliderToGenerationSeconds(agentGenerationLength.value)) : configuredDefaults.generationLength;
  const enableGetimg = agentEnableGetimg && agentEnableGetimg.checked ? 'yes' : 'no';
  const includeVideo = !agentOutputVideo || agentOutputVideo.checked;
  const includeInteractive = Boolean(agentOutputInteractive && agentOutputInteractive.checked);
  const includeGame = Boolean(agentOutputGame && agentOutputGame.checked);
  return [
    'if the user query is for lecture generation then follow this:',
    'aspect ratio: ' + aspectRatio,
    'generation length: ' + generationLength,
    'getimg enabled: ' + enableGetimg,
    'output video: ' + (includeVideo ? 'yes' : 'no'),
    'output interactive: ' + (includeInteractive ? 'yes' : 'no'),
    'output practice game: ' + (includeGame ? 'yes' : 'no')
  ].join('\\n');
}

function appendGenerationSettingsPrompt(message) {
  const base = message.trim();
  const settings = getGenerationSettingsPrompt();
  return base ? base + '\\n\\n' + settings : settings;
}

function fillAgentResourceSelect(select, options, defaultId) {
  if (!select) return;
  select.innerHTML = '';
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label || item.id;
    select.appendChild(option);
  }
  if (options.some(item => item.id === defaultId)) select.value = defaultId;
}

function fillTtsVoiceSelect(select, tts) {
  if (!select || !tts || !Array.isArray(tts.providers)) return;
  select.innerHTML = '';
  for (const provider of tts.providers) {
    if (!Array.isArray(provider.voices) || provider.voices.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = provider.label + (provider.configured === false ? ' (not configured)' : '');
    group.dataset.provider = provider.id;
    group.disabled = provider.configured === false;
    for (const voice of provider.voices) {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = voice.label || voice.id;
      if (provider.id === tts.defaults.provider && voice.id === tts.defaults.voice) {
        option.selected = true;
      }
      group.appendChild(option);
    }
    select.appendChild(group);
  }
}

async function loadAgentResourceOptions() {
  try {
    const response = await fetch('/agent-options');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load agent options');
    agentThemes = Array.isArray(payload.themes) ? payload.themes : [];
    agentTeachingStyles = Array.isArray(payload.teachingStyles) ? payload.teachingStyles : [];
    agentDefaultThemeId = payload.defaults && payload.defaults.themeId || 'default';
    agentDefaultTeachingStyleId = payload.defaults && payload.defaults.teachingStyleId || 'default';
    fillAgentResourceSelect(agentTheme, agentThemes, agentDefaultThemeId);
    fillAgentResourceSelect(agentTeachingStyle, agentTeachingStyles, agentDefaultTeachingStyleId);
    fillTtsVoiceSelect(resolveTtsVoice, payload.tts);
    fillTtsVoiceSelect(renderTtsVoice, payload.tts);
  } catch (error) {
    agentThemes = [];
    agentTeachingStyles = [];
    appendChatMessage('Could not load agent options: ' + error.message, 'error');
  }
}

async function sendChat() {
  if (!agentChatInput || !agentChatSend) return;
  const msg = agentChatInput.value.trim();
  const filesToSend = pendingAgentAttachments.slice();
  const requestPhase = agentPhase;
  if (!msg && filesToSend.length === 0) return;
  if (
    agentPhase === 'generate'
    && agentOutputVideo && !agentOutputVideo.checked
    && agentOutputInteractive && !agentOutputInteractive.checked
    && agentOutputGame && !agentOutputGame.checked
  ) {
    appendChatMessage('Select at least one output: Video, Interactive, or Practice game.', 'error');
    return;
  }

  agentChatInput.value = '';
  agentChatInput.style.height = '32px';
  pendingAgentAttachments = [];
  renderAgentAttachments();
  appendChatMessage(buildUserAttachmentDisplay(msg, filesToSend), 'user');
  
  agentChatInput.disabled = true;
  if (agentUploadButton) agentUploadButton.disabled = true;
  agentChatSend.style.display = 'none';
  if (agentChatStop) agentChatStop.style.display = 'block';
  if (agentStatusTag) {
    agentStatusTag.textContent = requestPhase === 'generate' ? 'Generating' : 'Thinking';
    agentStatusTag.style.background = 'rgba(255, 214, 10, 0.15)';
    agentStatusTag.style.color = '#ffd60a';
  }
  
  showThinking(requestPhase === 'generate' ? 'Generating' : 'Agent is starting...');
  let uploadCompleted = filesToSend.length === 0;

  let logPollInterval = setInterval(async () => {
    try {
      const logRes = await fetch('/agent-log?agentClientId=' + encodeURIComponent(agentClientId));
      const logData = await logRes.json();
      const latestStep = getLatestStepFromLog(logData.log);
      if (requestPhase !== 'generate' && latestStep) {
        updateThinkingStatus(latestStep);
      }
    } catch (e) {}
  }, 800);

  try {
    if (requestPhase !== 'generate') {
      updateThinkingStatus(filesToSend.length > 0 ? 'Uploading attachments...' : 'Agent is starting...');
    }
    const uploadedFiles = await uploadAgentAttachments(filesToSend);
    uploadCompleted = true;
    const taskMessage = buildAttachmentPrompt(msg, uploadedFiles);
    const endpoint = requestPhase === 'generate' ? '/lecturegen/generate' : '/agent-chat';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        agentClientId,
        message: taskMessage,
        currentFile: currentFilePath,
        currentDir: currentBrowserFolder,
        themeId: requestPhase === 'generate' && agentTheme ? agentTheme.value : undefined,
        teachingStyleId: requestPhase === 'generate' && agentTeachingStyle ? agentTeachingStyle.value : undefined
      })
    });
    
    const payload = await response.json();
    removeThinking();
    
    if (!response.ok) {
      throw new Error(payload.error || 'Agent execution failed');
    }
    
    if (payload.workspace) {
      currentBrowserFolder = payload.workspace;
    }
    if (payload.mode) {
      setAgentPhase(payload.mode);
    }
    if (payload.path) {
      setCurrentFile(payload.path);
    }
    if (!payload.stopped) {
      appendChatMessage(payload.output || 'Done.', 'agent');
      playAgentResponseRing();
    }
  } catch (error) {
    removeThinking();
    if (!uploadCompleted) {
      pendingAgentAttachments = filesToSend.concat(pendingAgentAttachments);
      renderAgentAttachments();
    }
    appendChatMessage(error.message, 'error');
  } finally {
    clearInterval(logPollInterval);
    agentChatInput.disabled = false;
    if (agentUploadButton) agentUploadButton.disabled = false;
    agentChatSend.style.display = 'block';
    if (agentChatStop) agentChatStop.style.display = 'none';
    agentChatInput.style.height = '32px';
    agentChatInput.focus();
    if (agentStatusTag) {
      agentStatusTag.textContent = 'Standby';
      agentStatusTag.style.background = '';
      agentStatusTag.style.color = '';
    }
    
    if (currentBrowserFolder) {
      browseFolder(currentBrowserFolder);
    } else {
      refreshFolderFiles();
    }
  }
}

if (agentChatInput) {
  agentChatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      if (event.shiftKey || event.ctrlKey) {
        // Allow default behavior (line break)
      } else {
        event.preventDefault();
        sendChat();
      }
    }
  });
  agentChatInput.addEventListener('input', () => {
    agentChatInput.style.height = 'auto';
    agentChatInput.style.height = Math.min(180, agentChatInput.scrollHeight) + 'px';
  });
  agentChatInput.addEventListener('paste', event => {
    const imageFiles = clipboardImageFiles(event);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    addAgentAttachments(imageFiles);
  });
}
if (agentUploadButton && agentFileInput) {
  agentUploadButton.addEventListener('click', () => {
    agentFileInput.click();
  });
  agentFileInput.addEventListener('change', () => {
    addAgentAttachments(agentFileInput.files);
    agentFileInput.value = '';
  });
}
if (agentInputArea) {
  ['dragenter', 'dragover'].forEach(type => {
    agentInputArea.addEventListener(type, event => {
      event.preventDefault();
      event.stopPropagation();
      agentInputArea.classList.add('drag-active');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach(type => {
    agentInputArea.addEventListener(type, event => {
      event.preventDefault();
      event.stopPropagation();
      if (type !== 'dragenter' && type !== 'dragover') {
        agentInputArea.classList.remove('drag-active');
      }
    });
  });
  agentInputArea.addEventListener('drop', event => {
    addAgentAttachments(event.dataTransfer ? event.dataTransfer.files : []);
  });
}
if (agentGenerationLength) {
  updateGenerationLengthDisplay();
  agentGenerationLength.addEventListener('input', updateGenerationLengthDisplay);
}
if (agentGenerationLengthValue) {
  agentGenerationLengthValue.addEventListener('blur', commitGenerationLengthInput);
  agentGenerationLengthValue.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitGenerationLengthInput();
      agentGenerationLengthValue.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      updateGenerationLengthDisplay();
      agentGenerationLengthValue.blur();
    }
  });
}
loadAgentResourceOptions();
if (agentChatSend) {
  agentChatSend.addEventListener('click', sendChat);
}
if (agentChatStop) {
  agentChatStop.addEventListener('click', async () => {
    agentChatStop.disabled = true;
    agentChatStop.textContent = 'Stopping...';
    try {
      const response = await fetch('/stop-job?agentClientId=' + encodeURIComponent(agentClientId), { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to stop agent');
    } catch (error) {
      appendChatMessage('Error stopping agent: ' + error.message, 'error');
    } finally {
      agentChatStop.disabled = false;
      agentChatStop.textContent = 'Stop';
    }
  });
}
if (agentNewChat) {
  agentNewChat.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear this conversation and start a new chat?')) {
      try {
        const response = await fetch('/agent-new-chat?agentClientId=' + encodeURIComponent(agentClientId), { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to start new chat');
        if (agentBody) {
          agentBody.innerHTML = '';
        }
        setAgentPhase('generate');
      } catch (error) {
        appendChatMessage('Error starting new chat: ' + error.message, 'error');
      }
    }
  });
}
`;
}
