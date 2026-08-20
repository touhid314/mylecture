// @ts-nocheck
export function renderLectureActionsController(context = {}) {
  const { agentConfig, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, viewerVersion } = context;
  return `
// Folder browsing is delegated to ide-server because browser JavaScript cannot
// directly list arbitrary local directories.
async function browseFolder(folderPath = '') {
  try {
    const query = folderPath ? '?dir=' + encodeURIComponent(folderPath) : '';
    const response = await fetch('/browse-folder' + query, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Folder browse failed');
    renderFolderFiles(payload);
  } catch (error) {
    folderPathLabel.textContent = error.message;
    folderPathLabel.title = '';
    currentBrowserFolder = '';
    openFolderButton.disabled = true;
    refreshFolderButton.disabled = true;
    copyFolderPathButton.disabled = true;
    fileList.textContent = '';
  } finally {
    syncIdeActions();
  }
}

async function refreshFolderFiles() {
  if (!currentFilePath) {
    await browseFolder(currentBrowserFolder);
    return;
  }

  try {
    const response = await fetch('/browse-folder?dir=' + encodeURIComponent(folderPathFromFile(currentFilePath)), { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Folder scan failed');
    renderFolderFiles(payload);
  } catch (error) {
    folderPathLabel.textContent = error.message;
    fileList.textContent = '';
  } finally {
    syncIdeActions();
  }
}

function playNotificationSound(success = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (success) {
      // Pleasant dual tone chime: low to high
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.40);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.40);
    } else {
      // Duller warning tone for errors/aborts
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (err) {
    console.error('Failed to play notification sound:', err);
  }
}

function playAgentResponseRing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);

    const first = ctx.createOscillator();
    first.type = 'sine';
    first.frequency.setValueAtTime(659.25, now);
    first.connect(gain);
    first.start(now);
    first.stop(now + 0.34);

    const second = ctx.createOscillator();
    second.type = 'sine';
    second.frequency.setValueAtTime(987.77, now + 0.11);
    second.connect(gain);
    second.start(now + 0.11);
    second.stop(now + 0.58);

    second.addEventListener('ended', () => {
      ctx.close().catch(() => {});
    });
  } catch (err) {
    // Browsers may block audio if the page has not received a user gesture.
  }
}

// Resolve the current source HTML into deterministic timeline HTML.
async function runResolve() {
  if (!isIndexHtmlKind(currentFileKind())) return;
  const sourceName = fileBaseName(currentFilePath);
  setActionBusy(true, 'Resolving...', 'resolve');
  setResolveOptionsVisible(false);
  const currentOnlyCheckbox = document.getElementById('resolve-current-only');
  const isCurrentOnly = currentOnlyCheckbox && currentOnlyCheckbox.checked;
  const resolveMsg = isCurrentOnly
    ? 'Resolving ' + sourceName + ' only with ' + resolveTtsVoice.value + ' @ ' + resolveTtsSpeed.value + 'x'
    : 'Resolving ' + sourceName + ' with ' + resolveTtsVoice.value + ' @ ' + resolveTtsSpeed.value + 'x';
  startJobStatus(resolveMsg);
  try {
    const response = await fetch('/resolve-file?' + resolveQuery(), { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Resolve failed');
    renderFolderFiles(payload.folder);
    await loadFile(payload.path);
    setStatus('Resolved: ' + payload.path);
    finishJobStatus('Done: ' + fileBaseName(payload.path));
    playNotificationSound(true);
  } catch (error) {
    setStatus(error.message);
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    setActionBusy(false);
    syncIdeActions();
  }
}

// Render the current source/resolved HTML into an MP4 through ide-server.
async function runRender() {
  const kind = currentFileKind();
  if (!isIndexHtmlKind(kind) && !isResolvedHtmlKind(kind)) return;
  const sourceName = fileBaseName(currentFilePath);
  setActionBusy(true, 'Rendering...', 'render');
  setRenderOptionsVisible(false);
  startJobStatus(
    'Rendering ' + sourceName +
    ' at ' + renderFps.value + ' FPS, ' +
    renderResolution.value +
    ', ' + renderTtsVoice.value + ' @ ' + renderTtsSpeed.value + 'x'
  );
  try {
    const response = await fetch('/render-file?' + renderQuery(), { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Render failed');
    renderFolderFiles(payload.folder);
    setStatus('Rendered: ' + payload.output);
    finishJobStatus('Done: ' + fileBaseName(payload.output));
    playNotificationSound(true);
  } catch (error) {
    setStatus(error.message);
    finishJobStatus(error.message, 'error');
    playNotificationSound(false);
  } finally {
    setActionBusy(false);
    syncIdeActions();
  }
}

async function runStopJob() {
  const stopBtn = document.getElementById('stop-job-btn');
  if (stopBtn) stopBtn.disabled = true;
  setStatus('Stopping process...');
  try {
    const response = await fetch('/stop-job', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to stop');
    setStatus('Process stopped successfully');
  } catch (error) {
    setStatus(error.message);
  } finally {
    if (stopBtn) stopBtn.disabled = false;
  }
}

function formatMetadataKey(key) {
  if (key === 'viewerVersion') return 'IDE version';
  if (key === 'lastResolved') return 'Last rendered';
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, char => char.toUpperCase());
}

function formatMetadataValue(key, value) {
  if (key === 'lastResolved' && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
    }
  }

  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (value === undefined || value === null || value === '') return 'Not set';
  return String(value);
}

// Info dialog is generated from viewer version plus whatever metadata the
// loaded lecture exposes.
function renderInfoDialog() {
  infoContent.textContent = '';
  const rows = [
    ['viewerVersion', VIEWER_VERSION],
    ...Object.entries(videoMetadata || {})
  ];

  if (rows.length === 1) rows.push(['metadata', 'No video metadata found']);

  for (const [key, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = formatMetadataKey(key);
    const detail = document.createElement('dd');
    detail.textContent = formatMetadataValue(key, value);
    infoContent.append(term, detail);
  }
}

function openInfoDialog() {
  renderInfoDialog();
  infoDialog.classList.add('visible');
  infoCloseButton.focus();
}

function closeInfoDialog() {
  infoDialog.classList.remove('visible');
  infoButton.focus();
}

// Publish flow sends the active lecture folder and course metadata to ide-server.
function openPublishDialog() {
  if (currentBrowserFolder) {
    const folderName = fileBaseName(currentBrowserFolder);
    publishLectureSlug.value = folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    publishLectureTitle.value = folderName.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } else {
    publishLectureSlug.value = '';
    publishLectureTitle.value = '';
  }
  
  publishModule.value = '';
  publishLectureDesc.value = '';
  publishLectureOrder.value = '';
  publishLecturePublished.checked = true;
  
  publishCourseSelect.innerHTML = '<option value="">-- Select Course --</option><option value="__new__">[Create New Course]</option>';
  publishCourseSelect.value = '';
  newCourseFields.style.display = 'none';
  
  publishNewCourseSlug.value = '';
  publishNewCourseTitle.value = '';
  publishNewCourseDesc.value = '';
  publishNewCoursePublished.checked = true;
  
  publishStatusBox.style.display = 'none';
  publishStatusBox.textContent = '';
  publishStatusBox.className = '';
  
  publishDialog.style.display = 'grid';
  publishButton.blur();
  
  fetchCoursesList();
}

function closePublishDialog() {
  publishDialog.style.display = 'none';
  publishButton.focus();
}

async function fetchCoursesList() {
  try {
    const res = await fetch('/list-courses');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to list courses');
    
    let optionsHtml = '<option value="">-- Select Course --</option><option value="__new__">[Create New Course]</option>';
    if (data.courses && data.courses.length > 0) {
      data.courses.forEach(course => {
        optionsHtml += '<option value="' + course.slug + '">' + course.title + ' (' + course.slug + ')</option>';
      });
    }
    publishCourseSelect.innerHTML = optionsHtml;
  } catch (err) {
    console.error('Error fetching courses list:', err);
    publishStatusBox.style.display = 'block';
    publishStatusBox.textContent = 'Warning: Could not fetch course database list: ' + err.message + '. Defaulting to [Create New Course] option.';
    publishStatusBox.className = 'error';
    publishCourseSelect.value = '__new__';
    newCourseFields.style.display = 'block';
  }
}

function handleCourseSelectChange() {
  const isNew = publishCourseSelect.value === '__new__';
  newCourseFields.style.display = isNew ? 'block' : 'none';
  if (isNew) {
    publishNewCourseSlug.required = true;
    publishNewCourseTitle.required = true;
  } else {
    publishNewCourseSlug.required = false;
    publishNewCourseTitle.required = false;
  }
}

async function handlePublishSubmit(event) {
  event.preventDefault();
  
  const course = publishCourseSelect.value;
  if (!course) {
    alert('Please select or create a course.');
    return;
  }
  
  if (!currentBrowserFolder) {
    alert('No active folder selected.');
    return;
  }
  
  publishSubmitButton.disabled = true;
  publishSubmitButton.textContent = 'Publishing...';
  publishStatusBox.style.display = 'block';
  publishStatusBox.className = '';
  publishStatusBox.textContent = 'Starting publish process...\\n';
  
  const payload = {
    course: course === '__new__' ? publishNewCourseSlug.value : course,
    slug: publishLectureSlug.value,
    title: publishLectureTitle.value,
    description: publishLectureDesc.value,
    module: publishModule.value,
    order: publishLectureOrder.value,
    published: publishLecturePublished.checked,
    sourceDir: currentBrowserFolder
  };
  
  if (course === '__new__') {
    payload.courseTitle = publishNewCourseTitle.value;
    payload.courseDescription = publishNewCourseDesc.value;
    payload.coursePublished = publishNewCoursePublished.checked;
  }
  
  try {
    const res = await fetch('/publish-lecture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    
    publishStatusBox.className = 'success';
    publishStatusBox.textContent = 'Successfully published!\\n\\n' + (data.output || '');
    playNotificationSound(true);
    refreshFolderFiles();
  } catch (err) {
    publishStatusBox.className = 'error';
    publishStatusBox.textContent = 'Error publishing lecture:\\n' + err.message;
    playNotificationSound(false);
  } finally {
    publishSubmitButton.disabled = false;
    publishSubmitButton.textContent = 'Publish!';
  }
}
`;
}
