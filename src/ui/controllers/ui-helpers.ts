// @ts-nocheck
export function renderUiHelpers(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
// Status helpers keep labels, busy state, and long-running job timers aligned.
function setStatus(message) {
  statusText.textContent = message;
}

function formatElapsed(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes + ':' + String(remainder).padStart(2, '0');
}

function setJobStatus(message, state = '') {
  const textSpan = document.getElementById('job-status-text');
  const stopBtn = document.getElementById('stop-job-btn');
  if (textSpan) textSpan.textContent = message || '';
  jobStatus.classList.toggle('visible', Boolean(message));
  jobStatus.classList.toggle('error', state === 'error');
  jobStatus.classList.toggle('success', state === 'success');

  if (stopBtn) {
    const isRunning = Boolean(message) && state !== 'error' && state !== 'success';
    stopBtn.classList.toggle('visible', isRunning);
  }
}

function setResolveOptionsVisible(visible) {
  resolveOptions.classList.toggle('visible', visible);
  resolveMenuToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
}

function setRenderOptionsVisible(visible) {
  renderOptions.classList.toggle('visible', visible);
  renderMenuToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
}

function selectedTtsProvider(select) {
  const option = select.options[select.selectedIndex];
  const group = option && option.closest('optgroup');
  return (group && group.dataset.provider) || configuredDefaults.ttsProvider;
}

function resolveQuery() {
  const params = new URLSearchParams();
  params.set('file', currentFilePath);
  params.set('ttsProvider', selectedTtsProvider(resolveTtsVoice));
  params.set('ttsVoice', resolveTtsVoice.value || configuredDefaults.ttsVoice);
  params.set('ttsSpeed', resolveTtsSpeed.value || configuredDefaults.ttsSpeed);
  const currentOnlyCheckbox = document.getElementById('resolve-current-only');
  if (currentOnlyCheckbox && currentOnlyCheckbox.checked) {
    params.set('currentOnly', '1');
  }
  return params.toString();
}

function renderQuery() {
  const params = new URLSearchParams();
  const [width, height] = String(renderResolution.value || configuredDefaults.renderResolution).split('x');
  params.set('file', currentFilePath);
  params.set('ttsProvider', selectedTtsProvider(renderTtsVoice));
  params.set('ttsVoice', renderTtsVoice.value || configuredDefaults.ttsVoice);
  params.set('ttsSpeed', renderTtsSpeed.value || configuredDefaults.ttsSpeed);
  params.set('fps', renderFps.value || configuredDefaults.fps);
  params.set('width', width || String(configuredDefaults.renderWidth));
  params.set('height', height || String(configuredDefaults.renderHeight));
  params.set('burnSubtitle', renderBurnSubtitle.checked ? '1' : '0');
  if (renderBurnSubtitle.checked) {
    params.set('subtitleFont', renderSubtitleFont.value);
    params.set('subtitleFontSize', renderSubtitleFontSize.value);
    params.set('subtitleBottomPercent', renderSubtitleBottomPercent.value);
  }
  return params.toString();
}

function startJobStatus(label) {
  activeJobLabel = label;
  activeJobStartedAt = Date.now();
  clearInterval(activeJobTimer);

  const update = () => {
    const elapsed = (Date.now() - activeJobStartedAt) / 1000;
    setJobStatus(activeJobLabel + '... ' + formatElapsed(elapsed));
  };

  update();
  activeJobTimer = setInterval(update, 1000);
}

function finishJobStatus(message, state = 'success') {
  clearInterval(activeJobTimer);
  activeJobTimer = 0;
  activeJobLabel = '';
  setJobStatus(message, state);
}

// Inline SVG icons avoid extra assets in this self-contained generated page.
const controlIcons = {
  play: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  volume: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  volumeMuted: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M18 9l4 4m0-4l-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fullscreen: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fullscreenExit: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v4H5M19 9h-4V5M15 19v-4h4M5 15h4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};

// Icon buttons share accessible labels so compact controls remain inspectable.
function setIconButton(button, icon, label) {
  button.innerHTML = controlIcons[icon] || '';
  button.setAttribute('aria-label', label);
  button.title = label;
}

// File-kind helpers centralize which UI actions are valid for the selected path.
function fileBaseName(filePath) {
  return String(filePath || '').replaceAll('\\\\', '/').split('/').filter(Boolean).at(-1) || '';
}

function fileExtension(filePath) {
  const name = fileBaseName(filePath);
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index + 1).toLowerCase() : '';
}

function folderPathFromFile(filePath) {
  const normalized = String(filePath || '').replaceAll('\\\\', '/');
  const index = normalized.lastIndexOf('/');
  return index > -1 ? normalized.slice(0, index) : '';
}

function isDocumentPreviewFile(filePath) {
  return ['txt', 'md', 'avsl'].includes(fileExtension(filePath));
}

function currentFileKind() {
  return fileBaseName(currentFilePath).toLowerCase();
}

function isIndexHtmlKind(kind) {
  return /^index.*\\.html$/i.test(kind);
}

function isResolvedHtmlKind(kind) {
  return /^resolved.*\\.html$/i.test(kind);
}

function setPreviewMode(mode) {
  const documentMode = mode === 'document';
  previewShell.style.display = documentMode ? 'none' : '';
  documentPreview.classList.toggle('visible', documentMode);
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Lightweight markdown is enough for local docs; avoiding a parser keeps this
// generated IDE page dependency-free.
function renderMarkdown(markdown) {
  const lines = String(markdown || '').split(/\\r?\\n/);
  const html = [];
  let paragraph = [];
  let listOpen = false;
  let codeOpen = false;

  const parseInline = (text) => {
    let res = String(text);
    res = res.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
    res = res.replace(/__(.*?)__/g, '<strong>$1</strong>');
    res = res.replace(/\\*(.*?)\\*/g, '<em>$1</em>');
    res = res.replace(/_(.*?)_/g, '<em>$1</em>');
    res = res.replace(new RegExp(String.fromCharCode(96) + '(.*?)' + String.fromCharCode(96), 'g'), '<code>$1</code>');
    res = res.replace(/\\\[(.*?)\\\]\\\((.*?)\\\)/g, '<a href="$2" target="_blank" style="color: #6fc2ff; text-decoration: underline;">$1</a>');
    return res;
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push('<p>' + parseInline(paragraph.map(escapeText).join(' ')) + '</p>');
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    html.push('</ul>');
    listOpen = false;
  };

  for (const line of lines) {
    if (line.trim().startsWith(String.fromCharCode(96, 96, 96))) {
      flushParagraph();
      closeList();
      html.push(codeOpen ? '</code></pre>' : '<pre><code>');
      codeOpen = !codeOpen;
      continue;
    }
    if (codeOpen) {
      html.push(escapeText(line) + '\\n');
      continue;
    }

    const heading = line.match(/^(#{1,3})\\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push('<h' + level + '>' + parseInline(escapeText(heading[2])) + '</h' + level + '>');
      continue;
    }

    const listItem = line.match(/^\\s*[-*]\\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push('<li>' + parseInline(escapeText(listItem[1])) + '</li>');
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (codeOpen) html.push('</code></pre>');
  return html.join('');
}

// AVSL preview highlights {visual: ...} blocks while preserving narration text.
function findAvslVisualEnd(text, startIndex) {
  let quote = '';
  let escaped = false;

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === '\\\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '}') {
      return index + 1;
    }
  }

  return text.length;
}

function appendAvslSpan(parent, className, text) {
  if (!text) return;
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  parent.append(span);
}

function renderAvsl(avsl) {
  const fragment = document.createDocumentFragment();
  const lines = String(avsl || '').split(/\\r?\\n/);

  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'avsl-line';
    let cursor = 0;

    while (cursor < line.length) {
      const start = line.indexOf('{visual:', cursor);
      if (start === -1) {
        appendAvslSpan(row, 'avsl-narration', line.slice(cursor));
        break;
      }

      appendAvslSpan(row, 'avsl-narration', line.slice(cursor, start));
      const end = findAvslVisualEnd(line, start + 8);
      appendAvslSpan(row, 'avsl-visual', line.slice(start, end));
      cursor = end;
    }

    fragment.append(row);
  }

  return fragment;
}

// Document files are displayed in the center panel instead of loaded into the
// lecture player iframe.
async function loadDocumentFile(filePath) {
  player.pause();
  setPreviewMode('document');
  setCurrentFile(filePath);
  videoMetadata = {};
  lastPlayerState = null;
  updateControls(player.snapshot());
  const extension = fileExtension(currentFilePath);
  documentPreview.classList.toggle('avsl-preview', extension === 'avsl');
  documentPreview.textContent = 'Loading...';
  setStatus('Loading document...');

  try {
    const response = await fetch(fileUrl(currentFilePath), { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) throw new Error(text || 'Document load failed');

    if (extension === 'md') {
      documentPreview.innerHTML = renderMarkdown(text);
    } else if (extension === 'avsl') {
      documentPreview.textContent = '';
      documentPreview.append(renderAvsl(text));
    } else {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = text;
      pre.append(code);
      documentPreview.textContent = '';
      documentPreview.append(pre);
    }

    setStatus('Document loaded');
    refreshFolderFiles();
  } catch (error) {
    documentPreview.textContent = error.message;
    setStatus(error.message);
    refreshFolderFiles();
  }
}

function syncIdeActions() {
  const kind = currentFileKind();
  const canResolve = isIndexHtmlKind(kind);
  const canRender = isIndexHtmlKind(kind) || isResolvedHtmlKind(kind);
  resolveControl.hidden = !canResolve;
  if (!canResolve) {
    setResolveOptionsVisible(false);
  }
  sidebarResolveButton.disabled = !canResolve;
  resolveMenuToggle.disabled = !canResolve;
  renderControl.hidden = !canRender;
  if (!canRender) {
    setRenderOptionsVisible(false);
  }
  sidebarRenderButton.disabled = !canRender;
  renderMenuToggle.disabled = !canRender;
  narrationEditButton.disabled = !canRender;
  visualTextEditButton.disabled = !canRender;
}

function setActionBusy(isBusy, message, action = '') {
  for (const button of [sidebarResolveButton, resolveMenuToggle, sidebarRenderButton, renderMenuToggle, narrationEditButton, visualTextEditButton]) {
    button.disabled = isBusy;
  }
  sidebarResolveButton.textContent = isBusy && action === 'resolve' ? 'Resolving...' : 'Resolve';
  sidebarRenderButton.textContent = isBusy && action === 'render' ? 'Rendering...' : 'Render';
  if (message) setStatus(message);
}
`;
}
