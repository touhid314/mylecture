// @ts-nocheck
export const lectureViewerVersion = '0.1';

export function createLecturePlayer(options = {}) {
  return new LecturePlayer(options);
}

export function estimateTextDuration(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2.5, words / 2.65);
}

export function normalizeSectionKind(kind) {
  if (kind === 'visual-only' || kind === 'visual') return 'visual-only';
  if (kind === 'narration+visual' || kind === 'narration') return 'narration+visual';
  return kind;
}

export function viewportFromAspectRatio(aspectRatio) {
  const normalized = String(aspectRatio || '').trim();
  const presets = {
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 }
  };
  if (presets[normalized]) return presets[normalized];

  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return null;
  }

  const longEdge = 1920;
  if (widthRatio >= heightRatio) {
    return {
      width: longEdge,
      height: Math.round(longEdge * heightRatio / widthRatio)
    };
  }

  return {
    width: Math.round(longEdge * widthRatio / heightRatio),
    height: longEdge
  };
}

export function detectDocumentViewport(win) {
  const doc = win.document;
  const candidates = [
    doc.getElementById('frame'),
    doc.querySelector('.video-frame'),
    doc.getElementById('video-frame'),
    doc.getElementById('player-container')
  ].filter(Boolean);

  for (const el of candidates) {
    const style = win.getComputedStyle(el);
    const cssWidth = parseFloat(style.width);
    const cssHeight = parseFloat(style.height);
    if (Number.isFinite(cssWidth) && Number.isFinite(cssHeight) && cssWidth >= 320 && cssHeight >= 240) {
      const rounded = { width: Math.round(cssWidth), height: Math.round(cssHeight) };
      const ratio = rounded.width / rounded.height;
      if (ratio > 1.2 || ratio < 0.85) return rounded;
    }
  }

  const canvas = doc.querySelector('canvas[width][height]');
  if (canvas) {
    const width = Number(canvas.getAttribute('width'));
    const height = Number(canvas.getAttribute('height'));
    if (Number.isFinite(width) && Number.isFinite(height) && width >= 320 && height >= 240) {
      return { width, height };
    }
  }

  return null;
}

export function detectMetadataViewport(win) {
  return viewportFromAspectRatio(win.__VIDEO_METADATA__?.aspectRatio);
}

export function buildPreviewTimeline(win) {
  if (win.__RESOLVED_TIMELINE__?.videoTimeline?.length) {
    return win.__RESOLVED_TIMELINE__.videoTimeline.map(cue => ({
      start: cue.start,
      end: cue.end,
      duration: cue.duration,
      item: cue.item
    }));
  }

  if (Array.isArray(win.__VIDEO_TIMELINE__) && win.__VIDEO_TIMELINE__.length) {
    return win.__VIDEO_TIMELINE__.map(cue => ({
      start: cue.start,
      end: cue.end,
      duration: cue.duration,
      item: cue.item || cue
    }));
  }

  const plan = Array.isArray(win.__VIDEO_PLAN__) ? win.__VIDEO_PLAN__ : [];
  let cursor = 0;
  return plan.filter(item => ['visual-only', 'narration+visual'].includes(normalizeSectionKind(item?.kind))).map(item => {
    const duration = Number(item.resolvedDuration) ||
      Number(item.duration) ||
      estimateTextDuration(item.text);
    const cue = {
      start: cursor,
      end: cursor + duration,
      duration,
      item
    };
    cursor += duration;
    return cue;
  });
}

export function buildInteractiveTimeline(win) {
  return [];
}

export function buildGameTimeline(win) {
  return [];
}

export function buildAudioTimeline(win, videoTimeline) {
  if (Array.isArray(win.__AUDIO_TIMELINE__) && win.__AUDIO_TIMELINE__.length) {
    return win.__AUDIO_TIMELINE__.map(cue => {
      const videoCue = videoTimeline.find(candidate => candidate.item?.id === cue.sectionId);
      return {
        ...cue,
        text: cue.text || videoCue?.item?.text || ''
      };
    });
  }

  if (Array.isArray(win.__RESOLVED_TIMELINE__?.audioTimeline) && win.__RESOLVED_TIMELINE__.audioTimeline.length) {
    return win.__RESOLVED_TIMELINE__.audioTimeline.map(cue => {
      const videoCue = videoTimeline.find(candidate => candidate.item?.id === cue.sectionId);
      return {
        ...cue,
        text: cue.text || videoCue?.item?.text || ''
      };
    });
  }

  return videoTimeline
    .filter(cue => cue.item?.audio)
    .map(cue => ({
      start: cue.start,
      duration: cue.duration,
      src: cue.item.audio,
      text: cue.item.text || '',
      sectionId: cue.item.id
    }));
}

export function buildSubtitleTimeline(audioTimeline, videoTimeline) {
  const audioSubtitleCues = audioTimeline
    .filter(cue => String(cue.text || '').trim())
    .map(cue => ({
      start: Number(cue.start) || 0,
      end: (Number(cue.start) || 0) + (Number(cue.duration) || 0),
      text: String(cue.text || '').trim(),
      sectionId: cue.sectionId || ''
    }))
    .filter(cue => cue.end > cue.start);

  const audioSectionIds = new Set(audioSubtitleCues.map(cue => cue.sectionId).filter(Boolean));
  const videoSubtitleCues = videoTimeline
    .filter(cue => String(cue.item?.text || '').trim())
    .filter(cue => !audioSectionIds.has(cue.item?.id))
    .map(cue => ({
      start: Number(cue.start) || 0,
      end: Number(cue.end) || ((Number(cue.start) || 0) + (Number(cue.duration) || 0)),
      text: String(cue.item.text || '').trim(),
      sectionId: cue.item.id || ''
    }))
    .filter(cue => cue.end > cue.start);

  return [...audioSubtitleCues, ...videoSubtitleCues].sort((a, b) => a.start - b.start);
}

class LecturePlayer {
  constructor(options = {}) {
    if (!options.iframe) throw new Error('createLecturePlayer requires an iframe option.');

    this.iframe = options.iframe;
    this.subtitleElement = options.subtitleElement || null;
    this.resolveSrc = typeof options.resolveSrc === 'function' ? options.resolveSrc : src => src;
    this.statusHandler = typeof options.onStatus === 'function' ? options.onStatus : null;
    this.speed = Number(options.speed) || 1;
    this.subtitlesEnabled = options.subtitlesEnabled !== false;
    this.liveTtsEnabled = options.liveTtsEnabled !== false;
    this.listeners = new Map();
    this.loadToken = 0;
    this.state = this.createInitialState();
    this.boundFrameLoad = () => this.handleFrameLoad();
    this.iframe.addEventListener('load', this.boundFrameLoad);
  }

  createInitialState() {
    return {
      loaded: false,
      playing: false,
      duration: 0,
      time: 0,
      startedAt: 0,
      startTime: 0,
      raf: 0,
      timeline: [],
      audioTimeline: [],
      subtitleTimeline: [],
      interactiveTimeline: [],
      gameTimeline: [],
      audio: null,
      audioCue: null,
      audioFailures: new Set(),
      speechSegmentKey: '',
      completed: false,
      interactiveActive: false,
      gameActive: false,
      metadata: {},
      resolved: false,
      src: ''
    };
  }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type, payload) {
    for (const handler of this.listeners.get(type) || []) {
      handler(payload);
    }
  }

  snapshot() {
    return {
      loaded: this.state.loaded,
      playing: this.state.playing,
      duration: this.state.duration,
      time: this.state.time,
      completed: this.state.completed,
      interactiveActive: this.state.interactiveActive,
      gameActive: this.state.gameActive,
      timeline: this.state.timeline,
      audioTimeline: this.state.audioTimeline,
      subtitleTimeline: this.state.subtitleTimeline,
      interactiveTimeline: this.state.interactiveTimeline,
      gameTimeline: this.state.gameTimeline,
      metadata: this.state.metadata,
      resolved: this.state.resolved,
      subtitlesEnabled: this.subtitlesEnabled,
      liveTtsEnabled: this.liveTtsEnabled,
      speed: this.speed,
      src: this.state.src
    };
  }

  setStatus(message) {
    if (this.statusHandler) this.statusHandler(message);
    this.emit('status', message);
  }

  async load(src) {
    if (!src) throw new Error('load requires a source.');
    this.pause();
    this.resetForLoad();
    this.state.src = src;
    const token = ++this.loadToken;
    const loaded = new Promise((resolve, reject) => {
      const offReady = this.on('ready', state => {
        cleanup();
        resolve(state);
      });
      const offError = this.on('error', error => {
        cleanup();
        reject(error);
      });
      const cleanup = () => {
        offReady();
        offError();
      };
    });

    this.iframe.src = this.resolveSrc(src);
    this.emit('loadstart', this.snapshot());
    try {
      return await loaded;
    } finally {
      if (token !== this.loadToken) return;
    }
  }

  resetForLoad() {
    if (this.nativeVideo) {
      this.nativeVideo.ontimeupdate = null;
      this.nativeVideo.onended = null;
      this.nativeVideo = null;
    }
    this.stopAudio();
    this.stopLiveTts();
    cancelAnimationFrame(this.state.raf);
    this.state = this.createInitialState();
    this.updateSubtitleOverlay();
    this.emit('statechange', this.snapshot());
  }

  handleFrameLoad() {
    try {
      const win = this.iframe.contentWindow;

      // Check if loading an MP4 file
      const isMp4 = String(this.state.src || '').toLowerCase().endsWith('.mp4');
      if (isMp4) {
        const doc = win.document;
        const videoEl = doc.querySelector('video');
        if (videoEl) {
          this.nativeVideo = videoEl;
          this.nativeVideo.playbackRate = this.speed;
          this.nativeVideo.defaultPlaybackRate = this.speed;

          const onMetadata = () => {
            const duration = videoEl.duration || 0;
            this.state.duration = duration;
            this.state.loaded = true;
            this.state.resolved = true;
            this.state.timeline = [{
              start: 0,
              end: duration,
              duration: duration,
              item: { id: 'rendered-video', text: '' }
            }];
            this.state.audioTimeline = [];
            this.state.subtitleTimeline = [];
            this.state.interactiveTimeline = [];
            this.state.gameTimeline = [];

            const snapshot = this.snapshot();
            this.emit('ready', snapshot);
            this.emit('statechange', snapshot);
          };

          if (videoEl.readyState >= 1) { // HAVE_METADATA or higher
            onMetadata();
          } else {
            videoEl.addEventListener('loadedmetadata', onMetadata, { once: true });
          }

          videoEl.onplay = () => {
            if (!this.state.playing) {
              this.state.playing = true;
              this.emit('statechange', this.snapshot());
            }
          };

          videoEl.onpause = () => {
            if (this.state.playing) {
              this.state.playing = false;
              this.emit('statechange', this.snapshot());
            }
          };

          videoEl.ontimeupdate = () => {
            this.state.time = videoEl.currentTime;
            this.emit('timeupdate', this.snapshot());
          };

          videoEl.onended = () => {
            this.state.playing = false;
            this.state.completed = true;
            this.emit('ended', this.snapshot());
            this.emit('statechange', this.snapshot());
          };
          return;
        }
      }

      const metadata = win.__VIDEO_METADATA__ && typeof win.__VIDEO_METADATA__ === 'object'
        ? { ...win.__VIDEO_METADATA__ }
        : {};
      const timeline = buildPreviewTimeline(win);
      const audioTimeline = buildAudioTimeline(win, timeline);
      const subtitleTimeline = buildSubtitleTimeline(audioTimeline, timeline);
      const interactiveTimeline = buildInteractiveTimeline(win);
      const gameTimeline = buildGameTimeline(win);
      const duration = Number(win.__VIDEO_DURATION__) ||
        Number(win.__RESOLVED_TIMELINE__?.duration) ||
        (timeline.at(-1)?.end || 0);

      const cleanSrcPath = String(this.state.src || '').split('?')[0].toLowerCase();
      const isInteractiveFile = cleanSrcPath.endsWith('/interactive.html');
      const isGameFile = cleanSrcPath.endsWith('/game.html');

      const isGameOnly = typeof win.__START_GAME__ === 'function' || isGameFile;
      const isInteractiveOnly = typeof win.__START_INTERACTIVE__ === 'function' || isInteractiveFile;

      if (!timeline.length || !Number.isFinite(duration) || duration <= 0) {
        if (!isGameOnly && !isInteractiveOnly) {
          throw new Error('No render timeline found');
        }
      }

      this.state.metadata = metadata;
      this.state.timeline = timeline;
      this.state.audioTimeline = audioTimeline;
      this.state.subtitleTimeline = subtitleTimeline;
      this.state.interactiveTimeline = interactiveTimeline;
      this.state.gameTimeline = gameTimeline;
      this.state.duration = isGameOnly || isInteractiveOnly ? 0 : duration;
      this.state.loaded = true;
      this.state.resolved = typeof win.renderAt === 'function' || isGameOnly || isInteractiveOnly;

      if (!isGameOnly && !isInteractiveOnly) {
        this.renderAt(0);
      }

      const detectedViewport = (isGameOnly || isInteractiveOnly)
        ? { width: 1920, height: 1080 }
        : (detectMetadataViewport(win) || detectDocumentViewport(win));
      const snapshot = { ...this.snapshot(), detectedViewport };
      this.emit('ready', snapshot);
      this.emit('statechange', snapshot);

      if (isGameOnly) {
        requestAnimationFrame(() => this.startGameSection());
      } else if (isInteractiveOnly) {
        requestAnimationFrame(() => this.startInteractiveSection());
      }

    } catch (error) {
      this.emit('error', error);
    }
  }

  setSpeed(speed) {
    this.speed = Math.max(0.1, Number(speed) || 1);
    if (this.nativeVideo) {
      this.nativeVideo.playbackRate = this.speed;
      this.nativeVideo.defaultPlaybackRate = this.speed;
    }
    if (this.state.audio) this.state.audio.playbackRate = this.speed;
    if (this.state.speechSegmentKey) {
      const currentTime = this.state.time;
      this.stopLiveTts();
      if (this.state.playing) this.renderAt(currentTime);
    }
    this.emit('statechange', this.snapshot());
  }

  setSubtitlesEnabled(enabled) {
    this.subtitlesEnabled = Boolean(enabled);
    this.updateSubtitleOverlay();
    this.emit('statechange', this.snapshot());
  }

  setLiveTtsEnabled(enabled) {
    this.liveTtsEnabled = Boolean(enabled);
    if (!this.liveTtsEnabled) {
      this.stopLiveTts();
    } else if (!('speechSynthesis' in window)) {
      this.liveTtsEnabled = false;
      this.setStatus('Live TTS unavailable in this browser');
    } else {
      this.syncAudio();
    }
    this.emit('statechange', this.snapshot());
  }

  activeVideoCue() {
    let cue = null;
    for (const candidate of this.state.timeline) {
      if (candidate.start <= this.state.time && this.state.time < candidate.end) cue = candidate;
      if (candidate.start > this.state.time) break;
    }
    return cue;
  }

  activeAudioCue() {
    return this.state.audioTimeline.find(candidate =>
      this.state.time >= candidate.start &&
      this.state.time < candidate.start + candidate.duration &&
      !this.state.audioFailures.has(this.audioCueKey(candidate))
    );
  }

  audioCueKey(cue) {
    return cue?.sectionId || cue?.src || String(cue?.start || '');
  }

  audioUrl(src) {
    return new URL(src, this.iframe.contentWindow.location.href).href;
  }

  stopAudio() {
    if (!this.state.audio) return;
    this.state.audio.pause();
    this.state.audio = null;
    this.state.audioCue = null;
  }

  stopLiveTts() {
    this.state.speechSegmentKey = '';
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  selectLiveTtsVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    const enGbVoices = voices.filter(voice => String(voice.lang || '').toLowerCase().startsWith('en-gb'));
    return enGbVoices.find(voice => /female|woman|zira|susan|serena|sonia|hazel|libby/i.test(voice.name)) ||
      enGbVoices[0] ||
      voices.find(voice => /female|woman|zira|susan|serena|sonia|hazel|libby/i.test(voice.name)) ||
      null;
  }

  syncLiveTts() {
    if (!this.state.playing || !this.liveTtsEnabled || !('speechSynthesis' in window)) {
      this.stopLiveTts();
      return;
    }

    const cue = this.activeVideoCue();
    const text = String(cue?.item?.text || '').trim();
    if (!cue || !text || this.state.interactiveActive || this.state.gameActive) {
      this.stopLiveTts();
      return;
    }

    const key = cue.item?.id || String(cue.start);
    if (this.state.speechSegmentKey === key) return;

    this.stopLiveTts();
    this.state.speechSegmentKey = key;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.selectLiveTtsVoice();
    utterance.lang = 'en-GB';
    if (voice) utterance.voice = voice;
    utterance.rate = Math.max(0.5, Math.min(2, this.speed));
    utterance.onerror = () => {
      if (this.state.speechSegmentKey === key) this.state.speechSegmentKey = '';
      this.setStatus('Live TTS unavailable in this browser');
    };
    window.speechSynthesis.speak(utterance);
  }

  syncAudio() {
    if (!this.state.playing) return;

    const cue = this.activeAudioCue();

    if (!cue) {
      this.stopAudio();
      this.syncLiveTts();
      return;
    }

    this.stopLiveTts();
    const offset = this.state.time - cue.start;
    if (this.state.audioCue !== cue) {
      this.stopAudio();
      this.state.audioCue = cue;
      this.state.audio = new Audio(this.audioUrl(cue.src));
      this.state.audio.addEventListener('error', () => {
        this.state.audioFailures.add(this.audioCueKey(cue));
        this.stopAudio();
        this.syncLiveTts();
      }, { once: true });
      this.state.audio.playbackRate = this.speed;
      this.state.audio.currentTime = Math.max(0, offset);
      this.state.audio.play().catch(() => this.setStatus('Audio blocked until play is clicked again'));
      return;
    }

    this.state.audio.playbackRate = this.speed;
    if (Math.abs(this.state.audio.currentTime - offset) > 0.22) {
      this.state.audio.currentTime = Math.max(0, offset);
    }
    if (this.state.audio.paused) {
      this.state.audio.play().catch(() => this.setStatus('Audio blocked until play is clicked again'));
    }
  }

  renderAt(time) {
    if (!this.state.loaded) return;
    const win = this.iframe.contentWindow;
    const activeTime = Math.max(0, Math.min(Number(time) || 0, this.state.duration));
    this.state.time = activeTime;
    if (activeTime < this.state.duration) {
      if (this.state.interactiveActive) this.stopInteractiveSection();
      if (this.state.gameActive) this.stopGameSection();
    }

    if (typeof win.renderAt === 'function') {
      win.renderAt(activeTime);
    } else {
      let cue = this.state.timeline[0];
      for (const candidate of this.state.timeline) {
        if (candidate.start <= activeTime) cue = candidate;
        if (candidate.start > activeTime) break;
      }
      const renderSection = win.__RENDER_SECTION__ || win.__HTML_RENDER_SECTION__ || win.__AI_RENDER_SECTION__;
      if (cue && typeof renderSection === 'function') {
        renderSection(cue.item, activeTime - cue.start, activeTime);
      }
    }

    this.updateSubtitleOverlay();
    this.syncAudio();
    this.emit('timeupdate', this.snapshot());
    this.emit('statechange', this.snapshot());
  }

  stopInteractiveSection() {
    const win = this.iframe.contentWindow;
    this.state.interactiveActive = false;
    if (typeof win.__STOP_INTERACTIVE__ === 'function') {
      win.__STOP_INTERACTIVE__();
    } else if (typeof win.__RENDER_SECTION__ === 'function' && this.state.timeline[0]) {
      win.__RENDER_SECTION__(this.state.timeline[0].item, 0, 0);
    }
  }

  stopGameSection() {
    const win = this.iframe.contentWindow;
    this.state.gameActive = false;
    if (typeof win.__STOP_GAME__ === 'function') {
      win.__STOP_GAME__();
    } else if (typeof win.__RENDER_SECTION__ === 'function' && this.state.timeline[0]) {
      win.__RENDER_SECTION__(this.state.timeline[0].item, 0, 0);
    }
  }

  tick(now) {
    if (!this.state.playing) return;
    const nextTime = this.state.startTime + ((now - this.state.startedAt) / 1000) * this.speed;
    this.renderAt(nextTime);

    if (this.state.time >= this.state.duration) {
      this.state.playing = false;
      this.state.completed = true;
      this.startInteractiveSection();
      this.emit('ended', this.snapshot());
      this.emit('statechange', this.snapshot());
      return;
    }

    this.state.raf = requestAnimationFrame(now => this.tick(now));
  }

  play() {
    if (!this.state.loaded) return;
    if (this.nativeVideo) {
      if (this.state.time >= this.state.duration) {
        this.nativeVideo.currentTime = 0;
      }
      this.state.playing = true;
      this.nativeVideo.play().catch(e => {
        this.setStatus('Playback blocked: ' + e.message);
      });
      this.emit('statechange', this.snapshot());
      return;
    }
    if (this.state.time >= this.state.duration) {
      this.state.completed = false;
      this.renderAt(0);
    }
    this.state.playing = true;
    this.state.startedAt = performance.now();
    this.state.startTime = this.state.time;
    this.emit('statechange', this.snapshot());
    this.syncAudio();
    this.state.raf = requestAnimationFrame(now => this.tick(now));
  }

  pause() {
    if (this.nativeVideo) {
      this.state.playing = false;
      this.nativeVideo.pause();
      this.emit('statechange', this.snapshot());
      return;
    }
    this.state.playing = false;
    cancelAnimationFrame(this.state.raf);
    this.stopAudio();
    this.stopLiveTts();
    this.emit('statechange', this.snapshot());
  }

  togglePlay() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(time, options = {}) {
    const shouldResume = Boolean((options.resume ?? this.state.playing) && this.state.loaded);
    if (this.nativeVideo) {
      this.state.playing = false;
      const targetTime = Math.max(0, Math.min(time, this.state.duration));
      this.state.time = targetTime;
      this.nativeVideo.currentTime = targetTime;
      this.state.completed = targetTime >= this.state.duration;

      if (shouldResume) {
        this.state.playing = true;
        this.nativeVideo.play().catch(e => {
          this.setStatus('Playback blocked: ' + e.message);
        });
      }
      this.emit('statechange', this.snapshot());
      return;
    }
    this.state.playing = false;
    cancelAnimationFrame(this.state.raf);
    this.stopAudio();
    this.stopLiveTts();

    this.renderAt(time);
    this.state.completed = this.state.time >= this.state.duration;

    if (shouldResume) {
      this.state.playing = true;
      this.state.startedAt = performance.now();
      this.state.startTime = this.state.time;
      this.emit('statechange', this.snapshot());
      this.syncAudio();
      this.state.raf = requestAnimationFrame(now => this.tick(now));
    }
  }

  seekBy(deltaSeconds) {
    if (!this.state.loaded) return;
    this.seek(this.state.time + deltaSeconds);
  }

  startInteractiveSection() {
    const win = this.iframe.contentWindow;
    const interactive = this.state.interactiveTimeline[0]?.item || { id: 'interactive' };
    if (this.state.gameActive) this.stopGameSection();

    const cleanSrcPath = String(this.state.src || '').split('?')[0].toLowerCase();
    const isInteractiveFile = cleanSrcPath.endsWith('/interactive.html');

    if (typeof win.__START_INTERACTIVE__ === 'function' || isInteractiveFile) {
      this.state.interactiveActive = true;
      this.stopLiveTts();
      this.updateSubtitleOverlay();
      if (typeof win.__START_INTERACTIVE__ === 'function') {
        win.__START_INTERACTIVE__(interactive);
      }
      this.setStatus('Interactive: ' + (interactive.title || interactive.id || 'ready'));
      this.emit('interactive', interactive);
      return;
    }
    if (typeof win.__ON_VIEWER_COMPLETE__ === 'function') {
      this.state.interactiveActive = true;
      this.stopLiveTts();
      this.updateSubtitleOverlay();
      win.__ON_VIEWER_COMPLETE__(interactive);
      this.setStatus('Interactive ready');
      this.emit('interactive', interactive);
    }
  }

  startGameSection() {
    const win = this.iframe.contentWindow;
    const game = this.state.gameTimeline[0]?.item || { id: 'game' };
    if (this.state.interactiveActive) this.stopInteractiveSection();

    const cleanSrcPath = String(this.state.src || '').split('?')[0].toLowerCase();
    const isGameFile = cleanSrcPath.endsWith('/game.html');

    if (typeof win.__START_GAME__ === 'function' || isGameFile) {
      this.state.gameActive = true;
      this.stopLiveTts();
      this.updateSubtitleOverlay();
      if (typeof win.__START_GAME__ === 'function') {
        win.__START_GAME__(game);
      }
      this.setStatus('Game: ' + (game.title || game.id || 'ready'));
      this.emit('game', game);
    }
  }

  seekToInteractive() {
    if (!this.state.loaded || this.state.interactiveTimeline.length === 0) return;
    this.pause();
    this.renderAt(this.state.duration);
    this.state.completed = true;
    this.startInteractiveSection();
    this.emit('statechange', this.snapshot());
  }

  seekToGame() {
    if (!this.state.loaded || this.state.gameTimeline.length === 0) return;
    this.pause();
    this.renderAt(this.state.duration);
    this.state.completed = true;
    this.startGameSection();
    this.emit('statechange', this.snapshot());
  }

  updateSubtitleOverlay() {
    if (!this.subtitleElement) return;
    if (!this.subtitlesEnabled || this.state.interactiveActive || this.state.gameActive) {
      this.subtitleElement.textContent = '';
      this.subtitleElement.classList.remove('visible');
      return;
    }

    const activeSubtitle = this.state.subtitleTimeline.find(cue =>
      this.state.time >= cue.start && this.state.time < cue.end
    );
    const text = activeSubtitle?.text || '';
    this.subtitleElement.textContent = text;
    this.subtitleElement.classList.toggle('visible', Boolean(text));
  }

  destroy() {
    this.pause();
    this.iframe.removeEventListener('load', this.boundFrameLoad);
    this.listeners.clear();
  }
}
