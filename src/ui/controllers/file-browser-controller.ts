// @ts-nocheck
export function renderFileBrowserController(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `
// Render the server-provided folder listing into the sidebar, then refresh the
// scene timeline from the same entries.
function renderFolderFiles(payload) {
  folderPathLabel.textContent = payload?.folder || 'No file selected';
  folderPathLabel.title = payload?.folder || '';
  currentBrowserFolder = payload?.folder || '';
  openFolderButton.disabled = !currentBrowserFolder;
  refreshFolderButton.disabled = !currentBrowserFolder;
  copyFolderPathButton.disabled = !currentBrowserFolder;
  fileList.textContent = '';

  const entries = Array.isArray(payload?.entries)
    ? payload.entries
    : (Array.isArray(payload?.files) ? payload.files.map(file => ({ ...file, type: 'file' })) : []);

  globalEntries = entries;

  if (payload?.parent) {
    const parentButton = document.createElement('button');
    parentButton.type = 'button';
    parentButton.className = 'file-item';
    parentButton.title = payload.parent;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = '..';

    const kind = document.createElement('span');
    kind.className = 'file-kind';
    kind.textContent = 'UP';

    parentButton.append(name, kind);
    parentButton.addEventListener('click', () => browseFolder(payload.parent));
    fileList.append(parentButton);
  }

  if (!entries.length && !payload?.parent) {
    const empty = document.createElement('div');
    empty.id = 'sidebar-empty';
    empty.textContent = 'No files found in this folder.';
    fileList.append(empty);
    return;
  }

  for (const file of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-item';
    button.classList.toggle('active', file.path === currentFilePath);
    button.title = file.path;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;

    const kind = document.createElement('span');
    kind.className = 'file-kind';
    kind.textContent = file.type === 'directory' ? 'DIR' : (fileExtension(file.name) || 'file');

    button.append(name, kind);
    button.addEventListener('click', () => {
      if (file.type === 'directory') browseFolder(file.path);
      else loadFile(file.path);
    });
    fileList.append(button);
  }

  updateScenePanel(entries);
}

// Build the bottom scene strip for raw, resolved, or rendered files. Durations
// come from server metadata when available and fall back to a preview estimate.
function updateScenePanel(entries) {
  let filesOnly = entries;
  if (entries.length > 0 && (entries[0].type === 'directory' || !('timelineStart' in entries[0]))) {
    filesOnly = entries.filter(file => file.type === 'file');
  }

  const rawFiles = filesOnly.filter(file => isIndexHtmlKind(file.name));
  rawFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const resolvedFiles = filesOnly.filter(file => isResolvedHtmlKind(file.name));
  resolvedFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const renderedFiles = filesOnly.filter(file => isRenderedKind(file.name));
  renderedFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const getFileSuffix = (name) => {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.html')) {
      // Legacy HTML: index/resolved + optional scene digits (unchanged).
      const legacyHtml = name.match(/^(?:index|resolved)(.*)\\.html$/i);
      return legacyHtml ? legacyHtml[1] : '';
    }
    if (lower.endsWith('.mp4')) {
      // Historical producer only: rendered.mp4 / rendered1.mp4 — not titled files
      // that merely start with those words (e.g. "Index Funds Explained.mp4").
      // Accepted edge: a title that is literally Rendered + digits (e.g. Rendered3.mp4)
      // still parses as legacy scene 3 — extremely rare, not worth more complexity.
      const legacyMp4 = name.match(/^rendered(\\d*)\\.mp4$/i);
      if (legacyMp4) return legacyMp4[1];
      // Titled scene MP4s use ~ so Part-2.mp4 finals are not parsed as scene 2.
      const titled = name.match(/~(\\d+)\\.mp4$/i);
      if (titled) return titled[1];
      // No -<digits>.mp4 back-compat: that pattern re-breaks new finals whose titles
      // end in -<digits> (e.g. Part-2.mp4). Pre-~ titled scene leftovers from the
      // short-lived - delimiter may mis-pair until cleaned up.
      return '';
    }
    return '';
  };

  renderedFiles.forEach(rf => {
    if (!rf.duration) {
      const suffix = getFileSuffix(rf.name);
      const matchingResolved = resolvedFiles.find(f => getFileSuffix(f.name) === suffix);
      if (matchingResolved && matchingResolved.duration) {
        rf.duration = matchingResolved.duration;
      } else {
        const matchingRaw = rawFiles.find(f => getFileSuffix(f.name) === suffix);
        if (matchingRaw && matchingRaw.duration) {
          rf.duration = matchingRaw.duration;
        }
      }
    }
  });

  let activeFiles = [];
  if (currentSceneTab === 'raw') {
    activeFiles = [...rawFiles];
  } else if (currentSceneTab === 'resolved') {
    activeFiles = [...resolvedFiles];
  } else if (currentSceneTab === 'rendered') {
    activeFiles = [...renderedFiles];
  }

  if (currentSceneTab === 'raw' || currentSceneTab === 'resolved') {
    const interactiveFile = filesOnly.find(file => file.name.toLowerCase() === 'interactive.html');
    if (interactiveFile) {
      activeFiles.push({
        ...interactiveFile,
        isNonTime: true,
        duration: 0
      });
    }
    const gameFile = filesOnly.find(file => file.name.toLowerCase() === 'game.html');
    if (gameFile) {
      activeFiles.push({
        ...gameFile,
        isNonTime: true,
        duration: 0
      });
    }
  }

  let accumulatedTime = 0;
  activeFiles.forEach(file => {
    if (file.isNonTime) {
      file.duration = 0;
      file.timelineStart = accumulatedTime;
    } else {
      const dur = Number(file.duration);
      file.duration = (Number.isFinite(dur) && dur > 0) ? dur : 15;
      file.timelineStart = accumulatedTime;
      accumulatedTime += file.duration;
    }
  });
  
  currentScenesList = activeFiles;
  
  const timelineContent = document.getElementById('timeline-content');
  const container = document.getElementById('timeline-container');
  if (!timelineContent || !container) return;
  
  const totalDuration = accumulatedTime;
  const containerWidth = container.clientWidth;
  if (containerWidth > 0 && totalDuration > 0) {
    currentSecWidth = Math.max(3, (containerWidth - 24) / totalDuration);
  } else {
    currentSecWidth = 15;
  }
  
  timelineContent.style.setProperty('--sec-width', currentSecWidth + 'px');
  
  const totalWidth = totalDuration * currentSecWidth;
  timelineContent.style.width = totalWidth + 'px';
  
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
  
  if (!sceneListContainer) return;
  sceneListContainer.innerHTML = '';
  
  if (activeFiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scene-empty-state';
    empty.textContent = 'No ' + currentSceneTab + ' files found.';
    sceneListContainer.appendChild(empty);
    return;
  }
  
  activeFiles.forEach((file, index) => {
    const isCurrent = file.path === currentFilePath;
    const card = document.createElement('div');
    card.className = 'scene-card' + (isCurrent ? ' active' : '');
    if (file.isNonTime) {
      card.classList.add('non-time-element');
      const isGame = file.name.toLowerCase() === 'game.html';
      if (isGame) {
        card.classList.add('game-card');
      }
    } else {
      card.style.setProperty('--scene-duration', file.duration);
    }
    
    const label = document.createElement('div');
    label.className = 'scene-card-label';
    if (file.isNonTime) {
      label.textContent = file.name.toLowerCase() === 'game.html' ? 'Game' : 'Interactive';
    } else {
      label.textContent = 'Scene ' + (index + 1);
    }
    
    const name = document.createElement('div');
    name.className = 'scene-card-name';
    if (file.isNonTime) {
      name.textContent = file.name;
    } else {
      name.textContent = file.name + ' (' + file.duration.toFixed(1) + 's)';
    }
    
    card.appendChild(label);
    card.appendChild(name);
    
    card.addEventListener('click', () => {
      if (file.path !== currentFilePath) {
        loadFile(file.path);
      }
    });
    
    sceneListContainer.appendChild(card);
  });
  
  updatePlayheadPosition();
}
`;
}
