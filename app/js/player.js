// The MyLecture player. Plays a lesson made of scenes (HTML + render code)
// and narrated beats (audio files), keeping visuals locked to the voice.
// In live mode, scenes and audio arrive while it is already playing; the
// player holds at a boundary (buffering) only when the next piece isn't ready.
import { h, icon, fmtTime } from "./ui.js";

const TL = window.MLTimeline;
const RATES = [0.75, 1, 1.25, 1.5, 2];

export class Player {
  constructor({ aspect = "16:9", theme = "dark", captions = true, rate = 1, live = false, showErrors = true } = {}) {
    this.aspect = aspect;
    this.theme = theme;
    this.captions = captions;
    this.rate = rate;
    this.live = live;
    this.generating = live;
    this.showErrors = showErrors;
    this.scenes = [];
    this.meta = {}; // "si:bi" -> {url, dur, failed}
    this.audio = new Map();
    this.cur = null;
    this.t = 0;
    this.playing = false;
    this.waiting = false;
    this.ended = false;
    this.dirty = true;
    this.tl = TL.build([]);
    this.stageReady = false;
    this.queue = [];
    this.listeners = {};
    this.lastPosted = -1;
    this.volume = 1;
    this.muted = false;
    this._build();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this._last = performance.now();
  }

  on(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
    return this;
  }
  _emit(ev, ...a) {
    for (const fn of this.listeners[ev] || []) fn(...a);
  }

  // ---------- DOM ----------
  _build() {
    const ar = this.aspect === "9:16" ? "portrait" : this.aspect === "1:1" ? "square" : "";
    this.frame = h("iframe", { class: "p-frame", sandbox: "allow-scripts", src: "stage/stage.html", title: "Lesson stage" });
    this.ovTitle = h("div", { class: "p-ov-title" }, "Thinking…");
    this.ovSub = h("div", { class: "p-ov-sub" }, "");
    this.ovLines = h("div", { class: "p-ov-lines" }, "");
    this.overlay = h("div", { class: "p-overlay" + (this.live ? "" : " hidden") }, h("div", { class: "thinking" }, h("i"), h("i"), h("i")), this.ovTitle, this.ovSub, this.ovLines);
    this.bufferChip = h("div", { class: "p-buffer" }, h("div", { class: "spin" }), h("span", {}, "Preparing next scene…"));
    this.big = h("div", { class: "p-big" }, svgPath("M8 5v14l11-7z"));
    this.btnPlay = h("button", { title: "Play/Pause (Space)", onclick: () => this.toggle() });
    this.timeEl = h("div", { class: "p-time" }, "0:00 / 0:00");
    this.fill = h("div", { class: "p-fill" });
    this.loaded = h("div", { class: "p-loaded" });
    this.marks = h("div", { class: "p-marks" });
    this.knob = h("div", { class: "p-knob" });
    this.tip = h("div", { class: "p-tip" });
    this.seekEl = h("div", { class: "p-seek" }, h("div", { class: "p-track" }, this.loaded, this.fill), this.marks, this.knob, this.tip);
    this.btnRate = h("button", { title: "Playback speed", onclick: () => this.cycleRate() }, this.rate + "×");
    this.btnCC = h("button", { title: "Captions (C)", class: this.captions ? "on" : "", onclick: () => this.setCaptions(!this.captions) }, "CC");
    this.btnMute = h("button", { title: "Mute (M)", onclick: () => this.setMuted(!this.muted) });
    this.btnFull = h("button", { title: "Fullscreen (F)", onclick: () => this.fullscreen() }, svgPath("M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", true));
    this.bar = h("div", { class: "p-bar" }, this.btnPlay, this.timeEl, this.seekEl, this.btnRate, this.btnCC, this.btnMute, this.btnFull);
    this.click = h("div", { class: "p-click", onclick: () => this.toggle(), ondblclick: () => this.fullscreen() });
    this.el = h("div", { class: `player paused ${ar}`, tabindex: "0" }, this.frame, this.click, this.overlay, this.bufferChip, this.big, this.bar);
    this._syncButtons();

    this.el.addEventListener("keydown", (e) => {
      if (e.target !== this.el) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") {
        e.preventDefault();
        this.toggle();
      } else if (k === "arrowright") this.seek(this.t + 5);
      else if (k === "arrowleft") this.seek(this.t - 5);
      else if (k === "c") this.setCaptions(!this.captions);
      else if (k === "f") this.fullscreen();
      else if (k === "m") this.setMuted(!this.muted);
      else if (k === "home") this.seek(0);
    });

    let dragging = false;
    const posToT = (e) => {
      const r = this.seekEl.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.tl.total;
    };
    this.seekEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      this.seekEl.setPointerCapture(e.pointerId);
      this.seek(posToT(e));
    });
    this.seekEl.addEventListener("pointermove", (e) => {
      const t = posToT(e);
      const r = this.seekEl.getBoundingClientRect();
      this.tip.style.left = e.clientX - r.left + "px";
      const loc = TL.locate(this.tl, t);
      this.tip.textContent = fmtTime(t) + (loc ? "  ·  " + (this.scenes[loc.scene]?.title || "") : "");
      if (dragging) this.seek(t);
    });
    this.seekEl.addEventListener("pointerup", () => (dragging = false));

    this._onMsg = (ev) => {
      if (ev.source !== this.frame.contentWindow) return;
      const m = ev.data || {};
      if (m.type === "stage-ready") {
        this.stageReady = true;
        this._post({ type: "config", aspect: this.aspect, theme: this.theme, captions: this.captions, showErrors: this.showErrors });
        for (const q of this.queue) this._post(q);
        this.queue = [];
        this.dirty = true;
        this.lastPosted = -1;
      } else if (m.type === "stage-error") {
        this._emit("stageError", m);
      }
    };
    window.addEventListener("message", this._onMsg);
  }

  _post(m) {
    if (!this.stageReady) {
      if (m.type !== "time") this.queue.push(m);
      return;
    }
    this.frame.contentWindow?.postMessage(m, "*");
  }

  _syncButtons() {
    this.btnPlay.replaceChildren(this.playing ? svgPath("M7 5h4v14H7zM13 5h4v14h-4z") : svgPath("M8 5v14l11-7z"));
    this.btnMute.replaceChildren(this.muted ? svgPath("M4 9v6h4l5 4V5L8 9H4ZM17 9l4 6M21 9l-4 6", true) : svgPath("M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6", true));
    this.el.classList.toggle("paused", !this.playing);
    this.el.classList.toggle("ready", this.scenes.length > 0);
  }

  // ---------- content ----------
  setLecture(lec) {
    this.pause();
    this.lectureId = lec.id || null;
    this.loadMusic(this.lectureId);
    this.t = 0;
    this.ended = false;
    this.lastPosted = -1;
    this.aspect = lec.aspect || this.aspect;
    this.theme = lec.theme || this.theme;
    this.scenes = [];
    this.meta = {};
    (lec.scenes || []).forEach((sc, si) => this._putScene(si, sc));
    this.tl = TL.build(this._timelineScenes());
    this._post({ type: "config", aspect: this.aspect, theme: this.theme });
    this.overlay.classList.add("hidden");
    this.dirty = true;
    this._syncButtons();
  }

  _putScene(si, sc) {
    this.scenes[si] = sceneShape(sc);
    sc.beats.forEach((b, bi) => {
      if (b.visualOnly) this.meta[`${si}:${bi}`] = { dur: b.dur, silent: true };
      else if (b.url && b.dur) this.meta[`${si}:${bi}`] = { url: b.url, dur: b.dur };
    });
  }

  // Live: a completed scene arrived.
  addScene(si, sc) {
    this._putScene(si, sc);
    this.dirty = true;
    this._syncButtons();
  }

  // Replace one scene (IDE edits). Keeps audio unless narration changed.
  updateScene(si, sc) {
    const old = this.scenes[si];
    this.scenes[si] = sceneShape(sc);
    sc.beats.forEach((b, bi) => {
      const key = `${si}:${bi}`;
      if (b.visualOnly) this.meta[key] = { dur: b.dur, silent: true };
      else if (b.url && b.dur) this.meta[key] = { url: b.url, dur: b.dur };
      else if (!old || old.beats[bi]?.text !== b.text) delete this.meta[key];
    });
    this.dirty = true;
  }

  setAllScenes(scenes) {
    this.loadMusic(this.lectureId);
    this.scenes = [];
    this.meta = {};
    scenes.forEach((sc, si) => this._putScene(si, sc));
    this._stopAudio();
    this.dirty = true;
    this._syncButtons();
  }

  setBeatAudio(si, bi, url, dur) {
    this.meta[`${si}:${bi}`] = { url, dur };
    this._audioFor(url); // preload
    this.dirty = true;
  }
  setBeatFailed(si, bi) {
    this.meta[`${si}:${bi}`] = { failed: true };
    this.dirty = true;
  }

  liveStatus(title, sub) {
    if (title != null) this.ovTitle.textContent = title;
    if (sub != null) this.ovSub.textContent = sub;
  }
  liveLine(text) {
    this.ovLines.textContent = text;
  }

  endLive() {
    this.loadMusic(this.lectureId);
    this.generating = false;
    this.dirty = true;
  }

  setConfig({ aspect, theme }) {
    if (aspect) this.aspect = aspect;
    if (theme) this.theme = theme;
    this.el.classList.toggle("portrait", this.aspect === "9:16");
    this.el.classList.toggle("square", this.aspect === "1:1");
    this._post({ type: "config", aspect: this.aspect, theme: this.theme });
  }

  // ---------- transport ----------
  play() {
    if (this.ended || this.t >= this.tl.total - 0.05) {
      if (!this.generating) this.t = 0;
    }
    this.ended = false;
    this.playing = true;
    this._last = performance.now();
    this._syncButtons();
    Player.active && Player.active !== this && Player.active.pause();
    Player.active = this;
    this._emit("play");
  }
  pause() {
    this.playing = false;
    this._stopAudio();
    this._syncButtons();
    this._emit("pause");
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
  seek(t) {
    this.t = Math.max(0, Math.min(t, this.tl.total));
    this.ended = false;
    this._stopAudio();
    this.lastPosted = -1;
  }
  cycleRate() {
    const i = RATES.indexOf(this.rate);
    this.setRate(RATES[(i + 1) % RATES.length]);
  }
  setRate(r) {
    this.rate = r;
    this.btnRate.textContent = r + "×";
    if (this.cur) this.cur.a.playbackRate = r;
    this._emit("rate", r);
  }
  setCaptions(on) {
    this.captions = on;
    this.btnCC.classList.toggle("on", on);
    this._post({ type: "config", captions: on });
    this._emit("captions", on);
  }
  setMuted(m) {
    this.muted = m;
    for (const a of this.audio.values()) a.muted = m;
    this._syncButtons();
  }
  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.el.requestFullscreen?.();
  }

  // ---------- audio ----------
  _audioFor(url) {
    let a = this.audio.get(url);
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      a.preservesPitch = true;
      a.muted = this.muted;
      a.src = url;
      this.audio.set(url, a);
    }
    return a;
  }
  _stopAudio() {
    if (this.cur) {
      try {
        this.cur.a.pause();
      } catch {}
    }
    this.cur = null;
  }

  // ---------- background music (metadata.json "music") ----------
  // The agent prepares the track (level, fades, length); the app plays the
  // file exactly as it is, kept in sync with the timeline. Same in exports.
  async loadMusic(lectureId) {
    const id = lectureId;
    if (!id) return this._setMusic(null);
    const base = `mylecture://app/lib/${encodeURIComponent(id)}/`;
    let spec = null;
    try {
      const r = await fetch(base + "metadata.json", { cache: "no-store" });
      if (r.ok) spec = (await r.json())?.music || null;
    } catch {}
    if (id !== this.lectureId) return; // another lecture was loaded meanwhile
    const file = typeof spec === "string" ? spec : spec?.file;
    if (typeof file !== "string" || !file.trim() || /^[a-z]+:|^\/|\.\./i.test(file)) return this._setMusic(null);
    this._setMusic(base + file.trim().replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/"));
  }
  _setMusic(url) {
    if (this.music?.src === url) return;
    if (this.music) { try { this.music.pause(); } catch {} this.music.src = ""; }
    this.music = null;
    if (!url) return;
    const a = new Audio();
    a.preload = "auto";
    a.src = url;
    this.music = a;
  }
  _syncMusic() {
    const a = this.music;
    if (!a) return;
    const len = a.duration;
    const on = this.playing && !this.waiting && Number.isFinite(len) && this.t < len;
    if (!on) {
      if (!a.paused) a.pause();
      return;
    }
    if (a.paused || Math.abs(a.currentTime - this.t) > 0.35) {
      try { a.currentTime = this.t; } catch {}
    }
    a.playbackRate = this.rate;
    a.muted = this.muted;
    if (a.paused) a.play().catch(() => {});
  }

  // ---------- main loop ----------
  _timelineScenes() {
    return this.scenes.filter(Boolean).map((sc, si) => ({
      kind: sc.kind,
      src: sc.src,
      version: sc.version,
      title: sc.title,
      html: sc.html,
      js: sc.js,
      beats: sc.beats.map((b, bi) => ({ text: b.text, dur: this.meta[`${si}:${bi}`]?.dur, segment: b.segment })),
    }));
  }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;
    if (this.dirty) {
      const scenes = this._timelineScenes();
      this.tl = TL.build(scenes);
      this._post({ type: "scenes", scenes, t: this.t });
      this._renderMarks();
      this.dirty = false;
      this.lastPosted = -1;
    }
    if (this.playing) this._step(dt);
    this._syncMusic();
    if (Math.abs(this.t - this.lastPosted) > 1e-4) {
      this._post({ type: "time", t: this.t });
      this.lastPosted = this.t;
    }
    this._ui();
  }

  _setWaiting(w, label) {
    if (this.waiting !== w || (w && label !== this._waitLabel)) {
      this.waiting = w;
      this._waitLabel = label;
      this.bufferChip.classList.toggle("on", w && this.scenes.length > 0);
      if (label) this.bufferChip.querySelector("span").textContent = label;
    }
  }

  _step(dt) {
    const tl = this.tl;
    const total = tl.total;
    if (!tl.scenes.length) {
      this._setWaiting(true, "Writing first scene…");
      return;
    }
    if (this.t >= total - 1e-3) {
      this.t = total;
      if (this.generating) {
        this._setWaiting(true, "Writing next scene…");
      } else {
        this._setWaiting(false);
        this.playing = false;
        this.ended = true;
        this._stopAudio();
        this._syncButtons();
        this._emit("ended");
      }
      return;
    }
    const loc = TL.locate(tl, this.t);
    const st = tl.scenes[loc.scene];
    const bt = st.beats[loc.beat];
    const bStart = st.start + bt.start;
    const inBeat = this.t >= bStart - 1e-6 && this.t < bStart + bt.dur;
    const key = `${loc.scene}:${loc.beat}`;
    const m = this.meta[key];

    if (inBeat && m?.url) {
      const a = this._audioFor(m.url);
      if (!this.cur || this.cur.key !== key) {
        this._stopAudio();
        this.cur = { key, a, start: bStart };
        try {
          a.currentTime = Math.max(0, this.t - bStart);
        } catch {}
        a.playbackRate = this.rate;
        a.play().catch(() => {});
      }
      if (a.ended) {
        this.t = Math.max(this.t, bStart + bt.dur);
        this._setWaiting(false);
      } else if (!a.paused && a.readyState >= 2) {
        // Audio is the master clock while a beat is speaking.
        const at = bStart + a.currentTime;
        this.t = at > this.t - 0.3 ? Math.max(this.t, Math.min(at, this.t + dt * this.rate * 2 + 0.05)) : at;
        this._setWaiting(false);
      } else {
        this._setWaiting(true, "Loading voice…");
      }
      return;
    }
    if (inBeat && !m?.failed && this.live && this.generating !== null && !m) {
      // Voice for this sentence isn't ready yet: hold here.
      this.t = bStart;
      this._setWaiting(true, "Preparing voice…");
      return;
    }
    // Gap between beats (or beat without audio): advance on the wall clock,
    // but never step into a beat whose audio is still pending.
    if (this.cur && (!inBeat || this.cur.key !== key)) this._stopAudio();
    let nt = this.t + dt * this.rate;
    const next = this._nextBeatStart(this.t);
    if (next && nt >= next.t && this.live && !this.meta[next.key]) {
      nt = next.t;
      this._setWaiting(true, "Preparing voice…");
    } else this._setWaiting(false);
    this.t = Math.min(nt, total);
  }

  _nextBeatStart(t) {
    for (let si = 0; si < this.tl.scenes.length; si++) {
      const st = this.tl.scenes[si];
      if (st.start + st.dur < t) continue;
      for (let bi = 0; bi < st.beats.length; bi++) {
        const g = st.start + st.beats[bi].start;
        if (g > t + 1e-6) return { t: g, key: `${si}:${bi}` };
      }
    }
    return null;
  }

  _renderMarks() {
    const total = this.tl.total || 1;
    this.marks.replaceChildren(...this.tl.scenes.slice(1).map((s) => h("i", { style: { left: (100 * s.start) / total + "%" } })));
  }

  _ui() {
    const total = this.tl.total;
    const p = total ? this.t / total : 0;
    this.fill.style.width = p * 100 + "%";
    this.knob.style.left = p * 100 + "%";
    this.loaded.style.width = this.generating ? "100%" : "0";
    const txt = `${fmtTime(this.t)} / ${fmtTime(total)}${this.generating ? "+" : ""}`;
    if (this.timeEl.textContent !== txt) this.timeEl.textContent = txt;
    if (this.scenes.length && !this.overlay.classList.contains("hidden")) this.overlay.classList.add("hidden");
    const loc = TL.locate(this.tl, this.t);
    const k = loc ? `${loc.scene}:${loc.beat}` : "";
    if (k !== this._lastLoc) {
      this._lastLoc = k;
      this._emit("position", loc);
    }
    this._emit("time", this.t, total);
  }

  sceneStart(si) {
    return this.tl.scenes[si]?.start ?? 0;
  }
  beatStart(si, bi) {
    const s = this.tl.scenes[si];
    return s ? s.start + (s.beats[bi]?.start ?? 0) : 0;
  }
  get total() {
    return this.tl.total;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("message", this._onMsg);
    this._stopAudio();
    this._setMusic(null);
    for (const a of this.audio.values()) a.src = "";
    this.audio.clear();
    if (Player.active === this) Player.active = null;
    this.el.remove();
  }
}
Player.active = null;

function sceneShape(sc) {
  return {
    kind: sc.kind,
    src: sc.src,
    version: sc.version,
    title: sc.title,
    html: sc.html,
    js: sc.js,
    beats: sc.beats.map((b) => ({ text: b.text, dur: b.dur, visualOnly: b.visualOnly, segment: b.segment })),
  };
}

function svgPath(d, stroke = false) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  if (stroke) {
    s.style.fill = "none";
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "2");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  }
  s.appendChild(p);
  return s;
}
