// Tutor voice: sentences are synthesized as soon as they stream in and played
// in order. A level meter drives the speaking animation.

export class Voice {
  constructor({ onLevel } = {}) {
    this.onLevel = onLevel || (() => {});
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.rate = 1;
    this.current = null; // {resolve}
    this.paused = false;
    this.ctx = null;
    this._raf = 0;
  }

  _ensureGraph() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.buf = new Uint8Array(this.analyser.fftSize);
    } catch {
      this.ctx = null;
    }
  }

  _meter() {
    cancelAnimationFrame(this._raf);
    const tick = () => {
      if (!this.analyser || this.audio.paused) {
        this.onLevel(0);
        return;
      }
      this.analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const v = (this.buf[i] - 128) / 128;
        sum += v * v;
      }
      this.onLevel(Math.min(1, Math.sqrt(sum / this.buf.length) * 4));
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  // Queues synthesis; one request runs at a time (the voice engines are
  // sequential anyway), so dropping queued speech after an interruption
  // costs nothing. Returns a promise of {url, dur} or {error}.
  prepare(text, { priority = false } = {}) {
    let job;
    const promise = new Promise((resolve) => (job = { text, resolve }));
    job.promise = promise;
    if (priority) this._send(job);
    else {
      (this.pending ||= []).push(job);
      this._pump();
    }
    return promise;
  }

  // {engine, voice, speed} for the tutor's own voice.
  setVoice(opts) {
    this.opts = opts || null;
    this.fallback = false;
  }

  _send(job) {
    this.inflight = (this.inflight || 0) + 1;
    const opts = this.fallback ? undefined : this.opts || undefined;
    window.ml.tts.synth(job.text, opts).catch((e) => {
      // The tutor's voice isn't available (e.g. OmniVoice not installed): use the app voice.
      if (!opts) throw e;
      this.fallback = true;
      return window.ml.tts.synth(job.text);
    }).then(
      (r) => job.resolve({ url: r.url, dur: r.dur, words: r.words || null }),
      (e) => job.resolve({ error: String(e?.message || e) }),
    ).finally(() => {
      this.inflight--;
      this._pump();
    });
  }

  _pump() {
    while ((this.inflight || 0) < 1 && this.pending?.length) this._send(this.pending.shift());
  }

  // Drops queued (not yet started) synthesis.
  cancelPending() {
    for (const job of this.pending || []) job.resolve({ error: "cancelled", cancelled: true });
    this.pending = [];
  }

  // Plays a prepared clip. Resolves {done} or {stopped}.
  // marks(clip) -> [{t, run}]: callbacks at t seconds of clip time (before
  // the playback rate), fired by the audio clock, so pausing and speed
  // changes keep them on their words.
  async play(prepared, text = "", { onStart, marks } = {}) {
    const token = (this._playToken = (this._playToken || 0) + 1);
    this._waiting = token;
    const clip = await prepared;
    if (this._waiting !== token) return { stopped: true };
    this._waiting = 0;
    if (clip.cancelled) return { stopped: true };
    this._ensureGraph();
    if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
    return new Promise((resolve) => {
      const finish = (r) => {
        if (this.current?.resolve !== resolve) return;
        clearTimeout(this.current.timer);
        const left = this.current.marks;
        this.current = null;
        // Marks not reached yet (a clip that ended early) still run in order.
        if (r.done) for (const m of left) { try { m.run(); } catch (e) { console.error(e); } }
        this.onLevel(0);
        resolve(r);
      };
      this.current = { resolve, marks: [] };
      try { this.current.marks = (marks?.(clip) || []).filter((m) => m && typeof m.run === "function").sort((a, b) => a.t - b.t); } catch {}
      this._clock();
      if (clip.error || !clip.url) {
        // No voice available: hold the caption for reading time.
        const ms = Math.max(1200, (text.split(/\s+/).length / 2.8) * 1000) / this.rate;
        this.current.timer = setTimeout(() => finish({ done: true, silent: true }), ms);
        this.current.silent = { remaining: ms, startedAt: Date.now(), finish, total: ms };
        onStart?.(ms / 1000);
        return;
      }
      this.audio.onended = () => finish({ done: true });
      this.audio.onerror = () => finish({ done: true, error: true });
      this.audio.src = clip.url;
      this.audio.playbackRate = this.rate;
      this.current.finish = finish;
      const started = () => onStart?.((clip.dur || this.audio.duration || 0) / this.rate);
      if (!this.paused) this.audio.play().then(() => { this._meter(); started(); }).catch(() => finish({ done: true, error: true }));
      else this.current.onResume = started;
    });
  }

  // Clip time in seconds (unaffected by the playback rate).
  _clipTime() {
    const c = this.current;
    if (!c) return 0;
    if (c.silent) {
      const left = c.silent.remaining - (this.paused ? 0 : Date.now() - c.silent.startedAt);
      return ((c.silent.total - left) / 1000) * this.rate;
    }
    return this.audio.currentTime || 0;
  }

  _clock() {
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => {
      const c = this.current;
      if (!c) return clearInterval(this._clockTimer);
      if (this.paused || !c.marks.length) return;
      // Fire a little early: the eye needs a moment to land on the board.
      const t = this._clipTime() + 0.15;
      while (c.marks.length && c.marks[0].t <= t) {
        const m = c.marks.shift();
        try { m.run(); } catch (e) { console.error(e); }
      }
    }, 30);
  }

  setRate(r) {
    this.rate = r;
    this.audio.playbackRate = r;
  }

  pause() {
    this.paused = true;
    if (this.current?.silent) {
      clearTimeout(this.current.timer);
      const s = this.current.silent;
      s.remaining -= Date.now() - s.startedAt;
    } else this.audio.pause();
    this.onLevel(0);
  }

  resume() {
    this.paused = false;
    if (this.current?.silent) {
      const s = this.current.silent;
      s.startedAt = Date.now();
      this.current.timer = setTimeout(() => s.finish({ done: true, silent: true }), Math.max(0, s.remaining));
    } else if (this.current && this.audio.src) this.audio.play().then(() => {
      this._meter();
      const s = this.current?.onResume;
      if (this.current) this.current.onResume = null;
      s?.();
    }).catch(() => {});
  }

  // Stops the current clip; its play() resolves {stopped}. Fraction heard is returned.
  stop() {
    this._waiting = 0;
    this.paused = false;
    const heard = this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;
    this.audio.pause();
    const cur = this.current;
    this.current = null;
    if (cur) {
      clearTimeout(cur.timer);
      cur.resolve({ stopped: true, heard });
    }
    this.onLevel(0);
    return heard;
  }
}

// Clip time (seconds) of the word that starts at or after character pos.
export function cueTime(text, pos, words, dur) {
  const before = (String(text).slice(0, pos).match(/\S+/g) || []).length;
  // A cue glued to the middle of a word belongs to that word.
  const mid = pos > 0 && /\S/.test(text[pos - 1] || "") && /\S/.test(text[pos] || "");
  const k = mid ? before - 1 : before;
  if (Array.isArray(words) && words.length) {
    if (k >= words.length) return words[words.length - 1][1];
    return Math.max(0, words[Math.max(0, k)][0]);
  }
  return Math.max(0, (pos / Math.max(1, String(text).length)) * dur - 0.15);
}

// Push-to-talk microphone capture -> 16 kHz mono Float32Array.
export class Mic {
  constructor({ onLevel } = {}) {
    this.onLevel = onLevel || (() => {});
    this.stream = null;
    this.chunks = [];
    this.recording = false;
  }

  async _open() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is enough for short push-to-talk clips.
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.proc.onaudioprocess = (e) => {
      if (!this.recording) return;
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] * data[i];
      this.onLevel(Math.min(1, Math.sqrt(sum / (data.length / 4)) * 6));
    };
    this.src.connect(this.proc);
    this.proc.connect(this.ctx.destination);
  }

  async start() {
    await this._open();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.chunks = [];
    this.recording = true;
    this.startedAt = performance.now();
  }

  // -> {pcm: Float32Array (16k), seconds}
  stop() {
    this.recording = false;
    this.onLevel(0);
    const sr = this.ctx?.sampleRate || 48000;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return { pcm: resample(all, sr, 16000), seconds: total / sr };
  }

  close() {
    this.recording = false;
    try {
      this.proc?.disconnect();
      this.src?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      this.ctx?.close();
    } catch {}
    this.stream = null;
  }
}

export function resample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Average over the source window (cheap low-pass).
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += input[k];
    out[i] = b > a ? s / (b - a) : input[a] || 0;
  }
  return out;
}

// Whisper invents text for silence; drop the usual inventions.
export function cleanTranscript(text) {
  const t = String(text || "").replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|inaudible)\]|\((?:[^)]*?(?:music|silence|noise|inaudible)[^)]*)\)/gi, "").replace(/\s+/g, " ").trim();
  if (/^(?:thank you\.?|thanks for watching!?|you\.?|bye\.?|\.+)$/i.test(t)) return "";
  return t;
}
