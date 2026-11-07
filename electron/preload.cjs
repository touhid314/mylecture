const { contextBridge, ipcRenderer } = require("electron");
window.addEventListener("error", event => ipcRenderer.send("logs:renderer", { kind: "error", message: String(event.message || "Renderer error"), stack: String(event.error?.stack || ""), line: event.lineno }));
window.addEventListener("unhandledrejection", event => ipcRenderer.send("logs:renderer", { kind: "unhandledrejection", message: String(event.reason?.message || event.reason || "Unhandled rejection"), stack: String(event.reason?.stack || "") }));

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, fn) => {
  const l = (_e, p) => fn(p);
  ipcRenderer.on(ch, l);
  return () => ipcRenderer.removeListener(ch, l);
};

contextBridge.exposeInMainWorld("ml", {
  logs: {
    info: () => invoke("logs:info"),
    read: () => invoke("logs:read"),
    openFolder: () => invoke("logs:openFolder"),
    onEntry: fn => on("logs:entry", fn),
    reportError: entry => ipcRenderer.send("logs:renderer", entry),
  },
  info: () => invoke("app:info"),
  onFullscreen: (fn) => on("window:fullscreen", fn),
  components: {
    status: () => invoke("components:status"),
    install: (id) => invoke("components:install", id),
    onProgress: (fn) => on("components:progress", fn),
    onSetupDone: (fn) => on("components:setup-done", fn),
  },
  updates: {
    state: () => invoke("update:state"),
    install: (options) => invoke("update:install", options),
    openTerminal: () => invoke("update:openTerminal"),
    onState: (fn) => on("update:state", fn),
  },
  videos: { list: () => invoke("videos:list") },
  settings: { get: () => invoke("settings:get"), set: (p) => invoke("settings:set", p), setSecret: (n, v) => invoke("secret:set", n, v) },
  api: {
    verify: (req) => invoke("api:verify", req),
  },
  connect: {
    services: () => invoke("connect:services"),
    run: (id, action, options) => invoke("connect:run", id, action, options),
  },
  engines: {
    list: () => invoke("engines:list"),
    status: (id, opts) => invoke("engines:status", id, opts),
    usage: (id) => invoke("engines:usage", id),
    models: (id) => invoke("engines:models", id),
    test: (id) => invoke("engines:test", id),
  },
  tts: {
    status: () => invoke("tts:status"),
    voices: () => invoke("tts:voices"),
    addVoice: (input) => invoke("tts:addVoice", input),
    demo: (engine, voice) => invoke("tts:demo", engine, voice),
    removeVoice: (id) => invoke("tts:removeVoice", id),
    preview: (t, o) => invoke("tts:preview", t, o),
    synth: (t, o) => invoke("tts:synth", t, o),
    retry: () => invoke("tts:retry"),
    onStatus: (fn) => on("tts:status", fn),
  },
  gen: {
    start: (req) => invoke("gen:start", req),
    cancel: (id) => invoke("gen:cancel", id),
    editScene: (req) => invoke("gen:editScene", req),
    onEvent: (fn) => on("gen:event", fn),
    onEditDelta: (fn) => on("edit:delta", fn),
  },
  lectures: {
    list: () => invoke("lectures:list"),
    get: (id) => invoke("lectures:get", id),
    save: (l) => invoke("lectures:save", l),
    create: (init) => invoke("lectures:create", init),
    duplicate: (id) => invoke("lectures:duplicate", id),
    remove: (id) => invoke("lectures:remove", id),
  },
  study: {
    turn: (req) => invoke("study:turn", req),
    cancel: (turnId) => invoke("study:cancel", turnId),
    engine: () => invoke("study:engine"),
    list: () => invoke("study:list"),
    get: (id) => invoke("study:get", id),
    save: (s) => invoke("study:save", s),
    remove: (id) => invoke("study:remove", id),
    newId: () => invoke("study:newId"),
    image: (query) => invoke("study:image", query),
    attach: (sessionId, files) => invoke("study:attach", { sessionId, files }),
    onEvent: (fn) => on("study:event", fn),
  },
  stt: {
    warm: () => invoke("stt:warm"),
    status: () => invoke("stt:status"),
    transcribe: (pcm) => invoke("stt:transcribe", pcm),
    onStatus: (fn) => on("stt:status", fn),
  },
  sessions: {
    list: () => invoke("sessions:list"),
    get: (id) => invoke("sessions:get", id),
    create: () => invoke("sessions:new"),
    remove: (id) => invoke("sessions:remove", id),
    rename: (id, t) => invoke("sessions:rename", id, t),
  },
  exporter: {
    start: (o) => invoke("export:start", o),
    cancel: (id) => invoke("export:cancel", id),
    onProgress: (fn) => on("export:progress", fn),
  },
  shell: {
    showItem: (p) => invoke("shell:showItem", p),
    openPath: (p) => invoke("shell:openPath", p),
    openExternal: (u) => invoke("shell:openExternal", u),
    openExports: () => invoke("shell:openExports"),
  },
  dialog: { importHtml: () => invoke("dialog:importHtml") },
  ide: {
    list: () => invoke("ide:list"),
    get: (id) => invoke("ide:get", id),
    readFile: (id, name) => invoke("ide:readFile", id, name),
    narration: (id) => invoke("ide:narration", id),
    remove: (id) => invoke("ide:remove", id),
    exportProject: id => invoke("ide:exportProject", id),
    importProject: () => invoke("ide:importProject"),
    generate: (req) => invoke("ide:generate", req),
    chat: (req) => invoke("ide:chat", req),
    stop: () => invoke("ide:stop"),
    resolve: (id, o) => invoke("ide:resolve", id, o),
    render: (id, o) => invoke("ide:render", id, o),
    editNarration: (id, o) => invoke("ide:editNarration", id, o),
    visualCandidates: (id, i) => invoke("ide:visualCandidates", id, i),
    editVisualText: (id, o) => invoke("ide:editVisualText", id, o),
    editScene: (id, o) => invoke("ide:editScene", id, o),
    onLog: (fn) => on("ide:log", fn),
    onActivity: (fn) => on("ide:activity", fn),
    onJob: (fn) => on("ide:job", fn),
    onProgress: (fn) => on("ide:progress", fn),
  },
});
