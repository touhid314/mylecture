// MyLecture stage runtime. Mounts one scene at a time and renders it for any
// time t. It is driven by the app (postMessage "time") during playback and by
// the exporter (window.__ML.seek) during MP4 rendering.
(function () {
  const TL = window.MLTimeline;
  const stage = document.getElementById("stage");
  const root = document.getElementById("scene-root");
  const fallback = document.getElementById("fallback");
  const caption = document.getElementById("caption");
  const captionSpan = caption.querySelector("span");
  const errBadge = document.createElement("div");
  errBadge.id = "err-badge";
  stage.appendChild(errBadge);

  const ASPECTS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };
  let W = 1920,
    H = 1080;
  let scenes = [];
  let tl = TL.build([]);
  let mounted = { index: -1, key: "", render: null };
  let lastT = 0;
  let showErrors = true;

  // ---------- helpers exposed to scene code ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = {
    linear: (p) => clamp(p),
    inOut: (p) => {
      p = clamp(p);
      return p * p * (3 - 2 * p);
    },
    out: (p) => {
      p = clamp(p);
      return 1 - Math.pow(1 - p, 3);
    },
    in: (p) => {
      p = clamp(p);
      return p * p * p;
    },
    back: (p) => {
      p = clamp(p);
      const c1 = 1.70158,
        c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
    elastic: (p) => {
      p = clamp(p);
      if (p === 0 || p === 1) return p;
      return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    },
  };
  const each = (el, fn) => {
    if (!el) return;
    if (el instanceof Element) fn(el);
    else if (typeof el.length === "number") for (const e of el) e && fn(e);
  };
  const dashCache = new WeakMap();

  const ML = {
    clamp,
    lerp,
    ease,
    range: (t, t0, t1) => clamp((t - t0) / (t1 - t0 || 1e-6)),
    $: (sel) => root.querySelector(sel),
    $$: (sel) => Array.from(root.querySelectorAll(sel)),
    show(el, p, o = {}) {
      p = clamp(p);
      const y = o.y ?? 30,
        x = o.x ?? 0,
        sc = o.scale ?? 1;
      each(el, (e) => {
        e.style.opacity = String(p);
        const s = lerp(sc, 1, p);
        e.style.transform = `translate(${(1 - p) * x}px, ${(1 - p) * y}px)` + (s !== 1 ? ` scale(${s})` : "");
        e.style.visibility = p <= 0.001 ? "hidden" : "visible";
      });
    },
    draw(el, p) {
      p = clamp(p);
      each(el, (e) => {
        let len = dashCache.get(e);
        if (len == null) {
          try {
            len = e.getTotalLength ? e.getTotalLength() : 1000;
          } catch {
            len = 1000;
          }
          if (!len) len = 1000;
          dashCache.set(e, len);
        }
        e.style.strokeDasharray = `${len} ${len}`;
        e.style.strokeDashoffset = String(len * (1 - p));
        e.style.visibility = p <= 0.001 ? "hidden" : "visible";
      });
    },
    // Pen-style reveal from left to right (works for text, KaTeX, SVG groups).
    write(el, p) {
      p = clamp(p);
      each(el, (e) => {
        e.style.clipPath = p >= 0.999 ? "none" : `inset(-10% ${((1 - p) * 100).toFixed(2)}% -10% -2%)`;
        e.style.visibility = p <= 0.001 ? "hidden" : "visible";
      });
    },
    // Emphasis: scale 1 -> 1+amount -> 1 as p goes 0..1.
    pulse(el, p, amount = 0.1) {
      const k = 1 + amount * Math.sin(Math.PI * clamp(p));
      each(el, (e) => {
        e.style.transform = k === 1 ? "" : `scale(${k.toFixed(4)})`;
        if (!e.style.transformOrigin) e.style.transformOrigin = "center";
        if (e instanceof SVGElement) e.style.transformBox = "fill-box";
      });
    },
    type(el, text, p) {
      each(el, (e) => {
        const s = String(text ?? "");
        e.textContent = s.slice(0, Math.round(s.length * clamp(p)));
      });
    },
    count(el, from, to, p, decimals = 0) {
      each(el, (e) => {
        e.textContent = lerp(from, to, clamp(p)).toFixed(decimals);
      });
    },
    plot(path, fn, o = {}, p = 1) {
      if (!path) return;
      const [x0, x1] = o.x || [-5, 5];
      const [y0, y1] = o.y || [-5, 5];
      const w = o.w || 800,
        h = o.h || 500,
        n = o.samples || 160;
      const end = clamp(p);
      let d = "";
      let pen = false;
      for (let i = 0; i <= n * end; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        let y;
        try {
          y = fn(x);
        } catch {
          y = NaN;
        }
        if (!isFinite(y)) {
          pen = false;
          continue;
        }
        const px = ((x - x0) / (x1 - x0)) * w;
        const py = h - ((y - y0) / (y1 - y0)) * h;
        d += (pen ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1) + " ";
        pen = true;
      }
      path.setAttribute("d", d || "M0 0");
    },
    svg(tag, attrs = {}, parent) {
      const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(e);
      return e;
    },
    tex(el, latex, display = false) {
      each(el, (e) => {
        try {
          window.katex.render(String(latex), e, { displayMode: !!display, throwOnError: false });
        } catch {
          e.textContent = latex;
        }
      });
    },
  };
  window.ML = ML;

  // ---------- scene mounting ----------
  function decorate() {
    root.querySelectorAll("[data-tex]").forEach((el) => {
      ML.tex(el, el.getAttribute("data-tex"), el.hasAttribute("data-display"));
    });
    root.querySelectorAll("pre[data-code]").forEach((pre) => {
      const lang = pre.getAttribute("data-code");
      const src = pre.textContent.replace(/^\n/, "").replace(/\s+$/, "");
      const code = document.createElement("code");
      try {
        const res = lang && window.hljs.getLanguage(lang) ? window.hljs.highlight(src, { language: lang }) : window.hljs.highlightAuto(src);
        code.innerHTML = res.value;
      } catch {
        code.textContent = src;
      }
      code.className = "hljs";
      pre.textContent = "";
      pre.appendChild(code);
    });
  }

  function sceneKey(sc) {
    if (sc && sc.kind === "html") return "html:" + sc.src + "#" + (sc.version || "");
    return (sc.html || "").length + ":" + (sc.js || "").length + ":" + hash((sc.html || "") + (sc.js || ""));
  }
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  function reportError(index, err) {
    const msg = String((err && err.message) || err);
    if (showErrors) {
      errBadge.textContent = `Scene ${index + 1}: ${msg.slice(0, 90)}`;
      errBadge.style.display = "block";
    }
    parent.postMessage({ type: "stage-error", scene: index, message: msg }, "*");
  }

  function unmountAll() {
    htmlFrame?.dispose?.();
    htmlFrame = null;
    mounted = { index: -1, key: "", render: null };
    root.innerHTML = "";
  }
  function mount(index) {
    const sc = scenes[index];
    htmlFrame?.dispose?.();
    htmlFrame = null;
    errBadge.style.display = "none";
    mounted = { index, key: sc ? sceneKey(sc) : "", render: null };
    root.innerHTML = "";
    fallback.classList.remove("on");
    if (!sc) return;
    if (!sc.html || !sc.html.trim()) {
      fallback.innerHTML = `<div class="fb-title"></div><div class="fb-text"></div>`;
      fallback.querySelector(".fb-title").textContent = sc.title || "";
      fallback.classList.add("on");
    }
    try {
      root.innerHTML = sc.html || "";
      decorate();
    } catch (e) {
      reportError(index, e);
    }
    if (sc.js && sc.js.trim()) {
      try {
        const fn = new Function("ML", "root", "scene", `"use strict";\n${sc.js}\n;return typeof render === "function" ? render : null;`);
        mounted.render = fn(ML, root, sc);
      } catch (e) {
        reportError(index, e);
      }
    }
  }

  // ---------- LectureGen HTML scenes (original contract documents) ----------
  // Each scene is a complete index*.html document. It runs in its own frame and
  // is driven exactly like the original resolved runtime:
  // invokeRenderSection(window, item, localTime, globalTime-within-file).
  const EXPORT_CSS = "*,*::before,*::after{animation:none!important;transition:none!important}";
  const docCache = new Map();
  let htmlFrame = null; // { key, iframe, win, ready: Promise }
  async function loadDoc(src) {
    if (!docCache.has(src)) docCache.set(src, fetch(src, { cache: "no-store" }).then((r) => (r.ok ? r.text() : Promise.reject(new Error("Scene file missing: " + src)))));
    return docCache.get(src);
  }
  function prepareDoc(text, src, token) {
    const base = src.slice(0, src.lastIndexOf("/") + 1);
    const inject = `<base href="${base}"><script>window.__PLAYER_CONTROLLED__=true;<\/script><style>${EXPORT_CSS}</style>`;
    const bridge = `<script>(${sceneBridge.toString()})(${JSON.stringify(token)}, ${EXPORTING});<\/script>`;
    return (/<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (m) => m + inject + bridge) : inject + bridge + text);
  }
  // Each sandboxed document has its own opaque origin. Communicate through
  // postMessage so the preview keeps its sandbox and the exporter uses the
  // same renderer without accessing another document's globals.
  // The exporter loads the stage with ?export=1 and seeks frame by frame.
  const EXPORTING = new URLSearchParams(location.search).has("export");
  function sceneBridge(token, exporting) {
    const send = (type, extra = {}) => parent.postMessage({ type, token, ...extra }, "*");
    // <video> elements follow the scene clock automatically (opt out with
    // data-ml-manual; data-ml-start="2" starts a clip 2 s into the scene).
    // Export: exact seek per frame, and the frame waits for the seek. Player:
    // play normally, correct drift, match the playback rate, pause when the
    // timeline stops. Sound comes from the app's mix, so videos are muted.
    let lastT = null, lastWall = 0, rate = 1, idle = 0;
    const videos = () => [...document.querySelectorAll("video:not([data-ml-manual])")];
    const pauseAll = () => { for (const v of videos()) if (!v.paused) v.pause(); };
    const syncVideos = (t) => {
      const now = performance.now();
      const dt = lastT == null ? 0 : t - lastT, dw = (now - lastWall) / 1000;
      const moving = !exporting && dt > 0 && dt < 0.5 && dw > 0;
      if (moving) rate += (Math.min(4, Math.max(0.25, dt / dw)) - rate) * 0.2;
      lastT = t; lastWall = now;
      const waits = [];
      for (const v of videos()) {
        v.muted = true; v.playsInline = true;
        const start = parseFloat(v.dataset.mlStart) || 0;
        const d = v.duration;
        let want = Math.max(0, t - start);
        const known = Number.isFinite(d) && d > 0;
        if (known) want = v.loop ? want % d : Math.min(want, d - 0.001);
        const ended = known && !v.loop && t - start >= d - 0.05;
        if (!exporting && moving && t >= start && !ended) {
          v.playbackRate = Math.round(rate * 20) / 20;
          if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
          if (v.paused) v.play().catch(() => {});
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - want) > (exporting ? 0.0005 : 0.05)) v.currentTime = want;
        }
        if (exporting && (v.seeking || v.readyState < 2)) waits.push(new Promise((resolve) => {
          const done = () => resolve();
          v.addEventListener("seeked", done, { once: true });
          v.addEventListener("loadeddata", done, { once: true });
          setTimeout(done, 5000);
        }));
      }
      if (!exporting) { clearTimeout(idle); idle = setTimeout(pauseAll, 250); }
      return Promise.all(waits);
    };
    addEventListener("error", (e) => send("ml-scene-error", { message: e.message }));
    addEventListener("message", (e) => {
      const m = e.data;
      if (e.source !== parent || m?.token !== token || m.type !== "ml-scene-render") return;
      try {
        const html = window.__HTML_RENDER_SECTION__, ai = window.__AI_RENDER_SECTION__;
        if (typeof html === "function" && typeof ai === "function") {
          ai(m.segment, m.local, m.global); html(m.segment, m.local, m.global);
        } else {
          const render = window.__RENDER_SECTION__ || ai || html;
          if (typeof render !== "function") throw new Error("Scene has no renderer");
          render(m.segment, m.local, m.global);
        }
        syncVideos(m.global).then(() => send("ml-scene-rendered", { seq: m.seq }));
      } catch (e) { send("ml-scene-error", { message: String(e.message || e), seq: m.seq }); }
    });
    addEventListener("load", async () => {
      if (document.fonts) await document.fonts.ready;
      const until = Date.now() + 4000;
      while (window.__ML_TEXT_READY__ === false && Date.now() < until) await new Promise(r => setTimeout(r, 30));
      send("ml-scene-ready");
    });
  }
  function mountHtml(index) {
    const sc = scenes[index];
    const key = sc.src + "#" + (sc.version || "");
    mounted = { index, key: sceneKey(sc), render: null, html: true };
    root.innerHTML = "";
    fallback.classList.remove("on");
    errBadge.style.display = "none";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("scrolling", "no");
    iframe.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;border:0;display:block;background:transparent`;
    root.appendChild(iframe);
    const token = "scene-" + Math.random().toString(36).slice(2);
    const frame = { key, iframe, loaded: false, ready: null, pending: new Map(), seq: 0 };
    let loaded;
    const ready = new Promise(resolve => { loaded = resolve; });
    const onMessage = (ev) => {
      const m = ev.data;
      if (ev.source !== iframe.contentWindow || m?.token !== token) return;
      if (m.type === "ml-scene-ready") { frame.loaded = true; loaded(); }
      if (m.type === "ml-scene-error") { frame.error = m.message; reportError(index, m.message); }
      if (m.seq != null) { frame.pending.get(m.seq)?.(); frame.pending.delete(m.seq); }
    };
    window.addEventListener("message", onMessage);
    htmlFrame?.dispose?.();
    frame.dispose = () => {
      window.removeEventListener("message", onMessage);
      for (const resolve of frame.pending.values()) resolve();
      frame.pending.clear();
      loaded();
    };
    frame.render = (segment, local, global) => {
      const seq = ++frame.seq;
      // A frame removed from the stage has no window; skip it (it is remounted).
      if (!iframe.isConnected || !iframe.contentWindow) return Promise.resolve();
      const done = new Promise(resolve => frame.pending.set(seq, resolve));
      iframe.contentWindow.postMessage({ type: "ml-scene-render", token, seq, segment, local, global }, "*");
      return done;
    };
    frame.ready = (async () => {
      if (sc.version) docCache.delete(sc.src);
      const text = await loadDoc(sc.src);
      iframe.srcdoc = prepareDoc(text, sc.src, token);
      let timer;
      try {
        await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Scene load timed out")), 30000); })]);
      } finally { clearTimeout(timer); }
    })().catch((e) => { frame.error = String(e.message || e); reportError(index, e); });
    htmlFrame = frame;
    frame.ready.then(() => {
      if (htmlFrame === frame) renderAt(lastT);
    });
  }
  function renderHtml(loc, sc, st) {
    const frame = htmlFrame;
    if (!frame || !frame.loaded) return;
    const b = sc.beats[loc.beat];
    const seg = b && b.segment;
    if (!seg) return;
    const item = Object.assign({}, seg, { resolvedDuration: st.beats[loc.beat].dur });
    try {
      return frame.render(item, Math.max(0, loc.bt), loc.local);
    } catch (e) {
      reportError(loc.scene, e);
    }
  }

  function renderAt(t) {
    lastT = t;
    if (!tl.scenes.length) {
      unmountAll();
      captionSpan.textContent = "";
      return;
    }
    const loc = TL.locate(tl, t);
    const sc = scenes[loc.scene];
    const st = tl.scenes[loc.scene];
    if (sc && sc.kind === "html") {
      const attached = htmlFrame && htmlFrame.iframe.isConnected;
      if (!attached || mounted.index !== loc.scene || mounted.key !== sceneKey(sc)) mountHtml(loc.scene);
      const rendered = renderHtml(loc, sc, st);
      root.style.opacity = "1";
      const beat = sc.beats[loc.beat];
      captionSpan.textContent = beat ? beat.text || "" : "";
      return rendered;
    }
    if (mounted.index !== loc.scene || mounted.key !== sceneKey(sc)) mount(loc.scene);
    const beats = st.beats;
    const s = {
      t: loc.local,
      dur: st.dur,
      beat: loc.beat,
      bt: loc.bt,
      p: clamp(loc.local / st.dur),
      W,
      H,
      beats,
      index: loc.scene,
      at(i, delay = 0, len = 0.8) {
        const b = beats[Math.max(0, Math.min(beats.length - 1, i | 0))];
        return ease.inOut((loc.local - (b.start + delay)) / (len || 1e-6));
      },
    };
    if (mounted.render) {
      try {
        mounted.render(s);
      } catch (e) {
        reportError(loc.scene, e);
      }
    }
    if (fallback.classList.contains("on")) {
      fallback.querySelector(".fb-text").textContent = (sc.beats[loc.beat] || {}).text || "";
    }
    // Scene transitions: quick fade in, and fade out unless it's the last scene.
    const fin = ease.out(loc.local / 0.3);
    const isLast = loc.scene === tl.scenes.length - 1;
    const fout = isLast ? 1 : clamp((st.dur - loc.local) / 0.25);
    const o = Math.min(fin, fout);
    root.style.opacity = String(o);
    fallback.style.opacity = String(o);
    const beat = sc.beats[loc.beat];
    const inBeat = beat && loc.bt <= (beats[loc.beat].dur + 0.25);
    captionSpan.textContent = inBeat ? beat.text : "";
  }

  // ---------- configuration ----------
  const LIGHT_THEMES = ["light", "hand-drawn", "research"];
  let theme = "dark";
  let aspectKey = "16x9";
  function configure(cfg) {
    if (cfg.aspect && ASPECTS[cfg.aspect]) {
      [W, H] = ASPECTS[cfg.aspect];
      aspectKey = cfg.aspect.replace(":", "x");
    }
    stage.style.width = W + "px";
    stage.style.height = H + "px";
    if (cfg.theme) theme = cfg.theme;
    stage.className = "theme-" + theme + " aspect-" + aspectKey;
    if (cfg.theme) {
      const link = document.getElementById("hljs-theme");
      link.href = "../vendor/hljs/styles/" + (LIGHT_THEMES.includes(theme) ? "atom-one-light.min.css" : "atom-one-dark.min.css");
    }
    if (typeof cfg.captions === "boolean") caption.classList.toggle("on", cfg.captions);
    if (typeof cfg.showErrors === "boolean") showErrors = cfg.showErrors;
    fit();
  }

  function fit() {
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const s = Math.min(vw / W, vh / H);
    stage.style.transform = `translate(${(vw - W * s) / 2}px, ${(vh - H * s) / 2}px) scale(${s})`;
  }
  window.addEventListener("resize", fit);

  function setScenes(list) {
    scenes = list || [];
    tl = TL.build(scenes);
    // Keep the mounted scene if its code is unchanged (only timings moved).
  }

  window.addEventListener("message", (ev) => {
    const m = ev.data || {};
    switch (m.type) {
      case "config":
        configure(m);
        renderAt(lastT);
        break;
      case "scenes":
        setScenes(m.scenes);
        renderAt(m.t ?? lastT);
        break;
      case "scene": {
        scenes[m.index] = m.scene;
        tl = TL.build(scenes);
        if (mounted.index === m.index) mounted.key = "";
        renderAt(lastT);
        break;
      }
      case "time":
        renderAt(m.t);
        break;
    }
  });

  // Exporter API (used in an offscreen window without postMessage).
  window.__ML = {
    load(lecture, opts = {}) {
      configure({ aspect: lecture.aspect, theme: lecture.theme || "dark", captions: !!opts.captions, showErrors: false });
      setScenes(lecture.scenes);
      return tl.total;
    },
    async seek(t) {
      if (document.fonts && document.fonts.status !== "loaded") await document.fonts.ready;
      renderAt(t);
      if (htmlFrame && htmlFrame.ready && mounted.html) {
        await htmlFrame.ready;
        if (htmlFrame.error) throw new Error(htmlFrame.error);
        await renderAt(t);
        if (htmlFrame.error) throw new Error(htmlFrame.error);
      }
      return true;
    },
    total: () => tl.total,
    // Make sure the theme's web fonts are loaded before frames are captured.
    async fonts() {
      if (!document.fonts) return true;
      const cs = getComputedStyle(stage);
      const fams = ["--sans", "--serif", "--mono"].map((v) => cs.getPropertyValue(v).split(",")[0].trim()).filter(Boolean);
      const loads = [];
      for (const f of fams) for (const w of ["400", "700"]) loads.push(document.fonts.load(`${w} 40px ${f}`).catch(() => {}));
      await Promise.all(loads);
      await document.fonts.ready;
      return true;
    },
  };

  configure({});
  parent.postMessage({ type: "stage-ready" }, "*");
})();
