// Create: the MyLecture local IDE inside the app — for polished videos, not
// real-time streaming. Layout and workflow follow mylecture-local-ide:
//   left   recent projects and a collapsible artifacts drawer
//   center preview (player / document / rendered MP4) + scene timeline,
//          Edit narration
//   right  Video Agent: generation settings + chat (new videos, changes, questions)
import { markdownEl, renderInline, onFileLink } from "./markdown.js";
import { connectPanel, anyConnected } from "./connect.js";
import { showApiKeyDialog } from "./api-key.js";
import { h, icon, fmtTime, fmtDate, toast, modal, popMenu, confirmBox, bus } from "./ui.js";
import { Player } from "./player.js";
import { UsagePanel } from "./usage.js";
import { AttachmentPicker, attachmentNames } from "./attachments.js";

const TL = window.MLTimeline;
const LENGTH_PRESETS = ["0:15", "0:30", "0:45", ...Array.from({ length: 10 }, (_, i) => `${i + 1}:00`)];

function parseLength(v) {
  const s = String(v || "").trim();
  if (/^\d+$/.test(s)) return `${Math.floor(+s / 60)}:${String(+s % 60).padStart(2, "0")}`;
  const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  return m ? `${+m[1]}:${m[2]}` : null;
}

export class CreateView {
  constructor(root, { state }) {
    this.root = root;
    this.state = state;
    this.projects = [];
    this.project = null; // { lecture, files }
    this.sceneIndex = 0;
    this.job = null;
    this.liveJob = null; // gen jobId while a generation is running
    this.preview = "lecture"; // lecture | doc | video
    this._build();
    window.ml.ide.onLog((m) => this._onLog(m));
    window.ml.ide.onActivity?.((a) => this._onActivity(a));
    // File links in agent messages open that project artifact.
    onFileLink((name) => {
      const f = this.project?.files?.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!f) return toast(`${name} is not a file of this project.`);
      this.openFile(f, /\.(md|json|log)$/.test(f.name) ? "doc" : /\.mp4$/.test(f.name) ? "video" : "scene");
    });
    window.ml.ide.onJob((j) => this._onJob(j));
    window.ml.ide.onProgress((p) => this._onProgress(p));
    window.ml.gen.onEvent((ev) => this._onGen(ev));
    bus.on("settings-changed", (settings) => this._syncSettingsSelects(settings));
    this._modelPoll = setInterval(() => {
      if (this.root.classList.contains("active") && document.visibilityState === "visible" && !this._modelsLoading &&
          ![this.modelInput, this.modelSelect, this.providerSelect].includes(document.activeElement)) this._refreshEngineOptions({ force: true });
    }, 60000);
    this._artifactPoll = setInterval(() => {
      if (this.job?.projectId && this.project?.lecture.id === this.job.projectId) this._refreshArtifacts();
    }, 2000);
  }

  onShow() {
    this.refreshProjects();
    this._refreshEngineOptions();
    this._refreshVoiceOptions();
    this._fit();
  }

  // ---------- layout ----------
  _build() {
    // Left: projects + actions + files
    this.projList = h("div", { class: "ide-projects" });
    this.fileList = h("div", { class: "ide-files" });
    this.folderTitle = h("div", { class: "ide-folder-title" }, "No project open");
    this.renderBtn = h("button", { class: "btn sm grow render-highlight", title: "Render an MP4", onclick: () => (this.job?.type === "render" ? this.stopRender() : this.render()) }, "Render");
    this.renderMenu = h("button", { class: "btn sm icon render-options-highlight", title: "Render options", onclick: (e) => this._renderOptions(e.currentTarget) }, icon("down"));
    this.artifactCount = h("span", { class: "artifact-count" }, "0");
    this.artifactToggle = h("button", { class: "artifact-toggle", "aria-expanded": "false", "aria-controls": "create-artifacts", onclick: () => this._setArtifactsOpen(!this.artifactsOpen) },
      icon("up"), h("span", { class: "grow" }, "Artifacts"), this.artifactCount);
    this.artifactBody = h("div", { class: "artifact-body", id: "create-artifacts", hidden: true },
      h("div", { class: "ide-left-head" }, this.folderTitle, h("button", { class: "btn ghost sm icon", title: "Refresh artifacts", "aria-label": "Refresh artifacts", onclick: () => this.reload() }, icon("refresh"))), this.fileList);
    this.artifactGrip = h("div", { class: "artifact-grip", title: "Drag up to expand artifacts", role: "separator", "aria-label": "Resize artifacts", tabindex: "0" });
    this.artifactDrawer = h("section", { class: "artifact-drawer" }, this.artifactGrip, this.artifactToggle, this.artifactBody);
    const left = h(
      "aside",
      { class: "ide-left" },
      h("div", { class: "ide-left-head" }, h("div", { class: "panel-title", style: { padding: 0 } }, "Recent projects"), h("div", { class: "grow" }), h("button", { class: "btn sm", onclick: () => this.newLecture() }, icon("plus"), "New")),
      this.projList,
      this.artifactDrawer,
    );
    let resizeStart = null;
    this.artifactGrip.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      resizeStart = { y: e.clientY, height: this.artifactDrawer.offsetHeight };
      this.artifactGrip.setPointerCapture(e.pointerId); e.preventDefault();
    });
    this.artifactGrip.addEventListener("pointermove", e => {
      if (!resizeStart) return;
      const height = Math.max(42, Math.min(left.clientHeight - 120, resizeStart.height + resizeStart.y - e.clientY));
      this._setArtifactsOpen(height > 80, height);
    });
    this.artifactGrip.addEventListener("pointerup", () => { resizeStart = null; });
    this.artifactGrip.addEventListener("pointercancel", () => { resizeStart = null; });
    this.artifactGrip.addEventListener("keydown", e => {
      if (["ArrowUp", "ArrowDown", "Enter", " "].includes(e.key)) {
        e.preventDefault(); this._setArtifactsOpen(e.key === "ArrowDown" ? false : e.key === "ArrowUp" ? true : !this.artifactsOpen);
      }
    });

    // Center: preview + controls + timeline
    this.player = new Player({ aspect: "16:9", theme: "default", captions: false, live: false, showErrors: true });
    this.player.on("position", (loc) => {
      if (loc && loc.scene !== this.sceneIndex) {
        this.sceneIndex = loc.scene;
        this._paintAll();
      }
    });
    this.player.on("time", (t) => this._playhead(t));
    this.docView = h("article", { class: "ide-doc", style: { display: "none" } });
    this.video = h("video", { class: "ide-video", controls: true, style: { display: "none" } });
    this.closePreviewBtn = h("button", { class: "ide-preview-close", title: "Close artifact", "aria-label": "Close artifact", hidden: true, onclick: () => { this.showPreview("lecture"); this._paintAll(); } }, icon("x"));
    this.stage = h("div", { class: "ide-stage" }, this.player.el, this.docView, this.video, this.closePreviewBtn);
    new ResizeObserver(() => this._fit()).observe(this.stage);
    this.curFile = h("div", { class: "ide-curfile" }, "No file selected");
    this.videoTitle = h("h2", { class: "ide-video-title", hidden: true });
    this.renderBarFill = h("div", { class: "render-bar-fill" });
    this.renderInfo = h("div", { class: "render-info", hidden: true });
    this.renderDone = h("div", { class: "render-done", hidden: true });
    this.renderBar = h("div", { class: "render-bar", hidden: true, role: "progressbar", "aria-label": "Render progress", "aria-valuemin": "0", "aria-valuemax": "100" }, this.renderBarFill);
    const controls = h(
      "div",
      { class: "ide-controls" },
      this.renderBar,
      this.renderInfo,
      this.renderDone,
      this.curFile,
      h("div", { class: "grow" }),
      h("button", { class: "btn sm", title: "Re-record all narration with another voice", onclick: () => this.changeVoice() }, "Change voice"),
      h("button", { class: "btn sm", title: "View and edit narration for every beat", onclick: () => this.editNarration() }, icon("mic"), "Edit narration"),
      h("button", { class: "btn sm", title: "Video info", onclick: () => this.info() }, "Info"),
      h("div", { class: "ide-split" }, this.renderBtn, this.renderMenu),
    );
    this.timeline = h("div", { class: "ide-timeline" });
    this.playheadEl = h("div", { class: "ide-playhead" }, h("div", { class: "ide-playhead-handle" }));
    this.ruler = h("div", { class: "ide-ruler", role: "slider", tabindex: "0", "aria-label": "Lecture timeline", "aria-valuemin": "0", "aria-valuenow": "0" });
    this.timelineContent = h("div", { class: "ide-tl-content" }, this.ruler, this.timeline, this.playheadEl);
    this.timelineScroll = h("div", { class: "ide-tl-scroll" }, this.timelineContent);
    this.timecode = h("span", { class: "ide-timecode" }, "0:00.00");
    const timelineWrap = h("div", { class: "ide-timeline-wrap" }, h("div", { class: "ide-timeline-head" }, h("span", {}, "Scenes"), this.timecode), this.timelineScroll);
    let dragging = false;
    const seek = (e) => {
      if (!this._tlTotal) return;
      const x = e.clientX - this.timelineContent.getBoundingClientRect().left;
      this.showPreview("lecture");
      this.player.seek(Math.max(0, Math.min(this._tlTotal, x / this._secWidth)));
      this._playhead(this.player.t);
    };
    for (const target of [this.ruler, this.playheadEl]) {
      target.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); dragging = true; target.setPointerCapture(e.pointerId); seek(e);
      });
      target.addEventListener("pointermove", e => { if (dragging) seek(e); });
      target.addEventListener("pointerup", () => { dragging = false; });
      target.addEventListener("pointercancel", () => { dragging = false; });
    }
    this.ruler.addEventListener("keydown", e => {
      const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!delta && !["Home", "End"].includes(e.key)) return;
      e.preventDefault();
      this.player.seek(e.key === "Home" ? 0 : e.key === "End" ? this._tlTotal || 0 : this.player.t + delta);
      this._playhead(this.player.t);
    });
    new ResizeObserver(() => {
      const width = this.timelineScroll.clientWidth;
      if (width && width !== this._timelineWidth) { this._timelineWidth = width; this._paintTimeline(); }
    }).observe(this.timelineScroll);
    const center = h("main", { class: "ide-center" }, this.videoTitle, this.stage, controls, timelineWrap);

    // Right: agent
    this.chat = h("div", { class: "ide-chat", role: "log", "aria-label": "Video Agent conversation" });
    this.lenInput = h("input", { class: "input sm", value: "1:00", title: "Length (m:ss)", onchange: () => {
      const v = parseLength(this.lenInput.value);
      this.lenInput.value = v || "1:00";
      const i = LENGTH_PRESETS.indexOf(this.lenInput.value);
      if (i >= 0) this.lenRange.value = String(i);
    } });
    this.lenRange = h("input", { type: "range", min: "0", max: String(LENGTH_PRESETS.length - 1), step: "1", value: String(LENGTH_PRESETS.indexOf("1:00")), class: "ide-range", "aria-label": "Target video length", "aria-valuetext": "1:00", oninput: () => {
      this.lenInput.value = LENGTH_PRESETS[+this.lenRange.value];
      this.lenRange.setAttribute("aria-valuetext", this.lenInput.value);
    } });
    this.arSelect = h("select", { class: "select sm", "aria-label": "Video aspect", title: "Aspect ratio", onchange: e => { this._fit(); this._saveAgentSettings({ aspect: e.target.value }); } }, [["16:9", "Landscape"], ["9:16", "Portrait"], ["1:1", "Square"]].map(([v, label]) => h("option", { value: v, title: label }, v)));
    const styles = this.state.info?.styles || { themes: [], teachingStyles: [] };
    this.themeSelect = h("select", { class: "select sm", "aria-label": "Video theme", title: "Visual theme", onchange: e => this._saveAgentSettings({ lgTheme: e.target.value }) }, styles.themes.map((o) => h("option", { value: o.id, title: o.description }, o.name)));
    this.teachSelect = h("select", { class: "select sm", "aria-label": "Teaching style", title: "Teaching style", onchange: e => this._saveAgentSettings({ lgTeachingStyle: e.target.value }) }, styles.teachingStyles.map((o) => h("option", { value: o.id, title: o.description }, o.name)));
    this._syncSettingsSelects();
    this.input = h("textarea", { class: "ide-input", rows: 2, "aria-label": "Message the Video Agent", placeholder: "What video do you want to make? What do you want to teach?" });
    this.attachments = new AttachmentPicker(this.input);
    this.input.addEventListener("input", () => {
      this.input.style.height = "auto";
      this.input.style.height = Math.min(this.input.scrollHeight, 180) + "px";
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    this.sendBtn = h("button", { class: "agent-send", title: "Send message (Enter)", "aria-label": "Send message", onclick: () => this.send() }, icon("up"));
    this.stopBtn = h("button", { class: "agent-send agent-stop", title: "Stop current job", "aria-label": "Stop current job", style: { display: "none" }, onclick: () => window.ml.ide.stop() }, icon("stop"));
    this.agentStatus = h("span", { class: "agent-status" }, "Ready");
    this.modeNote = h("div", { class: "small faint ide-mode-note" });
    const field = (label, ctl, cls = "") => h("label", { class: "ide-field " + cls }, h("span", {}, label), ctl);
    this.voiceSelect = h("select", { class: "select sm", "aria-label": "Video voice", title: "Narration voice", onchange: () => {
      const [engine, ...parts] = this.voiceSelect.value.split(":");
      const voice = parts.join(":");
      this._saveAgentSettings({ voiceEngine: engine, ...(engine === "kokoro" ? { voice } : { omnivoiceVoice: voice }) });
    } });
    this.voiceSelect.hidden = true;
    this.voiceButton = h("button", { class: "select sm voice-picker-button", "aria-label": "Choose voice", "aria-haspopup": "menu", onclick: () => this._voiceMenu() }, "Voice");
    this.videoControls = h("div", { class: "agent-video-controls" },
      h("label", { class: "agent-length-row" }, h("span", {}, "Target length"), this.lenRange, this.lenInput),
      h("div", { class: "agent-video-selects" }, this.arSelect, this.themeSelect, this.teachSelect, h("div", { class: "voice-control" }, this.voiceButton, this.voiceSelect)));
    this.engineLabel = h("button", { class: "agent-option agent-provider", title: "Provider", "aria-label": "Choose provider", onclick: () => this._providerMenu() });
    this.agentName = h("span", { class: "agent-name" });
    this.modelName = h("button", { class: "agent-option agent-model-name", "aria-label": "Choose model", onclick: () => this._modelMenu() });
    this.engineLabel.append(this.agentName);
    this.thinkingLabel = h("button", { class: "agent-option agent-thinking", title: "Reasoning effort", "aria-label": "Choose reasoning effort", onclick: () => this._reasoningMenu() }, "Default");
    this.usage = new UsagePanel({ state: this.state, compact: true });
    this.providerSelect = h("select", { class: "select sm", "aria-label": "Agent provider", onchange: () => {
      const [engine, provider] = this.providerSelect.value.split(":");
      this._saveAgentSettings(provider ? { engine, api: { provider, model: this.engineCatalog.apiProviders[provider]?.defaultModel || "", baseUrl: "" } } : { engine });
    } });
    this.modelSuggestions = h("datalist", { id: "agent-model-suggestions" });
    this.modelInput = h("input", { class: "input sm", list: "agent-model-suggestions", "aria-label": "Custom model ID", placeholder: "Enter a model ID", hidden: true, onchange: () => {
      const s = this.state.settings;
      this._saveAgentSettings(s.engine === "api" ? { api: { model: this.modelInput.value.trim() } } : { models: { [s.engine]: this.modelInput.value.trim() } });
    } });
    this.modelSelect = h("select", { class: "select sm", "aria-label": "Agent model", onchange: () => {
      const value = this.modelSelect.value;
      this.modelInput.hidden = value !== "__custom";
      if (value === "__custom") { this.modelInput.focus(); return; }
      const s = this.state.settings;
      this._saveAgentSettings(s.engine === "api" ? { api: { model: value } } : { models: { [s.engine]: value } });
    } });
    this.effortSelect = h("select", { class: "select sm", "aria-label": "Thinking level", onchange: () => this._setThinking(this.effortSelect.value) });
    this.modelStatus = h("p", { class: "agent-model-status small faint", role: "status", "aria-live": "polite" }, "Loading provider models…");
    this.refreshModelsBtn = h("button", { class: "agent-tool", title: "Refresh provider models and reasoning levels", "aria-label": "Refresh provider models", onclick: () => this._refreshEngineOptions({ force: true }) }, icon("refresh"));
    this.apiKeyInput = h("input", { class: "input sm", type: "password", placeholder: "API key (leave blank to keep saved key)", "aria-label": "Provider API key" });
    this.apiBaseInput = h("input", { class: "input sm", placeholder: "Optional custom base URL", "aria-label": "API base URL" });
    this.apiControls = h("div", { class: "agent-api-controls" }, field("API key", this.apiKeyInput), field("Base URL", this.apiBaseInput),
      h("button", { class: "btn sm", onclick: async () => {
        try {
          if (this.apiKeyInput.value.trim()) await window.ml.settings.setSecret(`api:${this.state.settings.api.provider}`, this.apiKeyInput.value.trim());
          this.apiKeyInput.value = "";
          if (await this._saveAgentSettings({ api: { baseUrl: this.apiBaseInput.value.trim() } })) toast("Connection saved", { kind: "good" });
        } catch (e) { toast(friendly(e), { kind: "bad" }); }
      } }, "Save connection"));
    this.enginePanel = h("div", { class: "agent-options agent-model-options", hidden: true },
      h("div", { class: "agent-options-head" }, h("b", { class: "grow" }, "Agent"), this.refreshModelsBtn, h("button", { class: "agent-tool", title: "Close agent settings", "aria-label": "Close agent settings", onclick: () => this._toggleEngineOptions(false) }, icon("x"))),
      field("Provider", this.providerSelect), field("Model", h("div", {}, this.modelSelect, this.modelInput, this.modelSuggestions)), field("Thinking level", this.effortSelect), this.modelStatus, this.apiControls,
      h("p", { class: "small faint" }, "Applies to the next request."));
    this._syncEngineLabel();
    const right = h(
      "aside",
      { class: "ide-right", "data-drop-label": "Drop files to attach" },
      h("div", { class: "ide-right-head" }, h("span", { class: "agent-mark" }, icon("sparkles")), h("b", { class: "grow" }, "Video Agent"), this.agentStatus, h("button", { class: "agent-tool", title: "New video", "aria-label": "New video", onclick: () => this.newLecture() }, icon("plus"))),
      this.chat,
      h(
        "div",
        { class: "ide-compose" },
        this.enginePanel,
        this.modeNote,
        h("div", { class: "agent-box" },
          this.attachments.list,
          h("div", { class: "agent-prompt-row" }, this.attachments.controls, this.input, this.stopBtn, this.sendBtn),
          this.videoControls,
          h("div", { class: "agent-toolbar" }, this.engineLabel, this.modelName, this.thinkingLabel, this.usage.root)),
      ),
    );

    this.attachments.dropTarget(right);
    this.root.append(left, center, right);
    document.addEventListener("pointerdown", (e) => {
      if (!this.enginePanel.hidden && !this.enginePanel.contains(e.target) && !this.engineLabel.contains(e.target) && !this.thinkingLabel.contains(e.target)) this._toggleEngineOptions(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.enginePanel.hidden) { this._toggleEngineOptions(false); this.engineLabel.focus(); }
    });
    this.newLecture();
  }

  _syncSettingsSelects(s = this.state.settings) {
    if (s.lgTheme) this.themeSelect.value = s.lgTheme;
    if (s.lgTeachingStyle) this.teachSelect.value = s.lgTeachingStyle;
    this._syncEngineLabel(s);
    if (this.voiceSelect) this._refreshVoiceOptions();
    if (this.engineCatalog) this._refreshEngineOptions();
  }

  _setArtifactsOpen(open, height) {
    this.artifactsOpen = open;
    this.artifactBody.hidden = !open;
    this.artifactDrawer.classList.toggle("open", open);
    this.artifactToggle.setAttribute("aria-expanded", String(open));
    this.artifactDrawer.style.height = open ? `${height || this.artifactHeight || 280}px` : "";
    if (open && height) this.artifactHeight = height;
  }

  async _refreshArtifacts() {
    const id = this.project?.lecture.id;
    if (!id || this._artifactsLoading) return;
    this._artifactsLoading = true;
    try {
      const project = await window.ml.ide.get(id);
      if (this.project?.lecture.id === id) { this.project.files = project.files; this._paintFiles(); }
    } catch {} finally { this._artifactsLoading = false; }
  }

  _syncEngineLabel(s = this.state.settings) {
    if (!this.engineLabel) return;
    const names = { "claude-code": "Claude", codex: "GPT", antigravity: "Gemini", api: { gemini: "Gemini API", compatible: "LiteLLM" }[s.api?.provider] || "API key" };
    const configured = s.engine === "api" ? s.api?.model : s.models?.[s.engine];
    const key = s.engine === "api" ? `api:${s.api.provider}` : s.engine;
    const models = this._agentModels?.[key]?.models || [];
    const native = models.find(m => m.id === configured || (configured && m.resolvedModel === configured)) ||
      (!configured && models.find(m => m.isDefault || m.id === "default"));
    const model = native ? modelLabel(native, models) : configured || (models.length ? modelLabel(defaultModel(models), models) : "");
    const provider = names[s.engine] || s.engine || "Choose AI";
    this.agentName.textContent = provider;
    this.modelName.textContent = model || (s.engine ? "Loading models…" : "Choose a model");
    this.modelName.title = configured || native?.resolvedModel || native?.id || model || "";
    const effort = s.engine === "antigravity" ? native?.effort : s.codexEffort || native?.defaultEffort;
    this.thinkingLabel.textContent = effort ? cap(effort) : "Standard";
    this.thinkingLabel.title = `Reasoning effort: ${effort || "standard"}`;
  }

  _toggleEngineOptions(open = this.enginePanel.hidden) {
    this.enginePanel.hidden = true;
  }

  async _providerMenu() {
    try {
      this.engineCatalog ||= await window.ml.engines.list();
      const s = this.state.settings;
      const subs = this.engineCatalog.engines.filter(e => e.id !== "api");
      popMenu(this.engineLabel, [{ label: "Provider" },
        ...subs.map(e => ({ text: `${e.name}${s.engine === e.id ? "  ✓" : ""}`, run: () => s.connected?.[e.id] ? this._saveAgentSettings({ engine: e.id }) : this._connectFirst(e.name) })),
        "-",
        { text: `Use with API key…${s.engine === "api" ? "  ✓" : ""}`, run: () => showApiKeyDialog(this.state, { onDone: () => this._refreshEngineOptions({ force: true }) }) }]);
    } catch (e) { toast(friendly(e), { kind: "bad" }); }
  }

  _connectFirst(name) {
    toast(`Connect ${name} first: Settings → Connect.`, { actions: [{ label: "Open Settings", run: () => bus.emit("navigate", { view: "settings" }) }] });
  }

  async _modelMenu() {
    await this._refreshEngineOptions();
    const s = this.state.settings;
    const key = s.engine === "api" ? `api:${s.api.provider}` : s.engine;
    const models = this._agentModels?.[key]?.models || [];
    const choose = model => this._saveAgentSettings(s.engine === "api" ? { api: { model } } : { models: { [s.engine]: model } });
    const def = defaultModel(models);
    popMenu(this.modelName, [{ label: "Model" },
      ...models.filter(m => m.id !== "default" || !models.some(x => x !== m && x.id === m.resolvedModel)).map(m => ({ text: modelLabel(m, models), run: () => choose(m === def ? "" : m.id) })).map((x, i, all) => all.findIndex((y) => y.text === x.text) === i ? x : null).filter(Boolean), "-",
      { text: "Refresh models", run: async () => { await this._refreshEngineOptions({ force: true }); this._modelMenu(); } },
      { label: this.modelStatus.textContent }]);
  }

  async _reasoningMenu() {
    await this._refreshEngineOptions();
    popMenu(this.thinkingLabel, [{ label: "Reasoning effort" }, ...Array.from(this.effortSelect.options).map(o => ({ text: o.textContent, run: () => this._setThinking(o.value) })),
      ...(this.effortSelect.disabled ? [{ label: "Provider has not advertised additional levels" }] : [])]);
  }

  async _refreshVoiceOptions() {
    if (!this.voiceSelect) return;
    try {
      this._voiceCatalog ||= await window.ml.tts.voices();
      const s = this.state.settings;
      const group = (engine, label, voices) => h("optgroup", { label }, voices.map(([id, name]) => h("option", { value: `${engine}:${id}` }, name)));
      this.voiceSelect.replaceChildren(
        group("kokoro", "Kokoro · Fast · Local", this._voiceCatalog.kokoro || []),
        group("omnivoice", "OmniVoice · Higher quality · Local", this._voiceCatalog.omnivoice || []));
      const voice = s.voiceEngine === "omnivoice" ? s.omnivoiceVoice || "maruf" : s.voice || "af_heart";
      this.voiceSelect.value = `${s.voiceEngine === "omnivoice" ? "omnivoice" : "kokoro"}:${voice}`;
      this.voiceSelect.title = `${s.voiceEngine === "omnivoice" ? "OmniVoice" : "Kokoro"} · ${this.voiceSelect.selectedOptions[0]?.textContent || voice}`;
      this.voiceButton.textContent = this.voiceSelect.selectedOptions[0]?.textContent || voice;
      this.voiceButton.title = this.voiceSelect.title;
    } catch (e) { toast(friendly(e), { kind: "bad" }); }
  }

  async _voiceMenu() {
    await this._refreshVoiceOptions();
    const menu = popMenu(this.voiceButton, []);
    menu.classList.add("voice-menu");
    menu.setAttribute("role", "menu");
    for (const [engine, label, quality] of [["kokoro", "Kokoro", "Fast"], ["omnivoice", "OmniVoice", "Higher quality"]]) {
      menu.append(h("div", { class: "menu-label voice-group-label" }, label, h("span", { class: "voice-quality" }, quality), h("span", { class: "badge" }, "Local")));
      for (const [id, name] of this._voiceCatalog[engine] || []) {
        const key = `${engine}:${id}`;
        const pick = h("button", { class: "voice-pick", role: "menuitem", onclick: () => {
          this.voiceSelect.value = key;
          this.voiceSelect.dispatchEvent(new Event("change"));
          menu.remove();
        } }, name);
        const play = h("button", { class: "voice-demo", title: `Play ${name} demo`, "aria-label": `Play ${name} demo`, onclick: async () => {
          const request = this._voiceDemoRequest = (this._voiceDemoRequest || 0) + 1;
          this._voiceDemoAudio?.pause();
          play.disabled = true; play.replaceChildren(h("span", { class: "spin" }));
          try {
            const result = await window.ml.tts.preview("Hello! This is my voice. Let's learn something new together.", { engine, voice: id, speed: 1 });
            if (request !== this._voiceDemoRequest) return;
            this._voiceDemoAudio = new Audio(result.url);
            await this._voiceDemoAudio.play();
          } catch (e) { toast(friendly(e), { kind: "bad" }); }
          finally { play.disabled = false; play.replaceChildren(icon("play")); }
        } }, icon("play"));
        menu.append(h("div", { class: "voice-menu-row" + (this.voiceSelect.value === key ? " selected" : "") }, pick, play));
      }
    }
    // Reposition after adding the voice rows so the dropdown fits the viewport.
    const anchor = this.voiceButton.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    menu.style.top = Math.max(8, anchor.top - rect.height - 6) + "px";
    menu.style.left = Math.max(8, Math.min(anchor.right - rect.width, innerWidth - rect.width - 8)) + "px";
  }

  async _saveAgentSettings(patch) {
    try {
      const s = this.state.settings;
      const targetEngine = patch.engine || s.engine;
      const key = targetEngine === "api" ? `api:${patch.api?.provider || s.api.provider}` : targetEngine;
      if (patch.engine) patch = { ...patch, codexEffort: s.engineEfforts?.[key] ?? "" };
      else if (patch.codexEffort !== undefined) patch = { ...patch, engineEfforts: { [key]: patch.codexEffort } };
      await window.ml.settings.set(patch);
      this.state.settings = await window.ml.settings.get();
      bus.emit("settings-changed", this.state.settings);
      return true;
    } catch (e) { toast(friendly(e), { kind: "bad" }); return false; }
  }

  async _refreshEngineOptions({ force = false } = {}) {
    if (!this.providerSelect) return;
    const revision = this._engineRevision = (this._engineRevision || 0) + 1;
    try {
      this.engineCatalog ||= await window.ml.engines.list();
      const s = this.state.settings, id = s.engine;
      this.providerSelect.replaceChildren(
        ...this.engineCatalog.engines.filter(e => e.id !== "api").map(e => h("option", { value: e.id }, e.name)),
        ...Object.entries(this.engineCatalog.apiProviders).map(([key, v]) => h("option", { value: `api:${key}` }, `${v.label} API`)));
      this.providerSelect.value = id === "api" ? `api:${s.api.provider}` : id;
      const current = id === "api" ? s.api.model || "" : s.models?.[id] || "";
      if (document.activeElement !== this.modelInput) this.modelInput.value = current;
      this.apiControls.hidden = id !== "api";
      this.apiBaseInput.value = s.api?.baseUrl || "";
      this._agentModels ||= {};
      const cacheKey = id === "api" ? `${id}:${s.api.provider}` : id;
      if (this._displayedModelKey !== cacheKey) {
        this._displayedModelKey = cacheKey;
        this.modelSelect.replaceChildren(h("option", { value: current }, current || "Loading models…"), h("option", { value: "__custom" }, "Custom model ID…"));
        this.modelSuggestions.replaceChildren();
        this.effortSelect.replaceChildren(h("option", { value: "" }, "Standard"));
        this.effortSelect.disabled = true;
      }
      const cached = this._agentModels[cacheKey];
      const shouldFetch = force || !cached || Date.now() - cached.fetchedAt >= 60000;
      if (shouldFetch) {
        this._modelsLoading = true;
        this.refreshModelsBtn.disabled = true;
        this.modelStatus.textContent = "Checking provider models and reasoning levels…";
        this.modelStatus.classList.remove("error");
        this.modelSelect.disabled = true;
        this.effortSelect.disabled = true;
      }
      const models = shouldFetch ? await window.ml.engines.models(id) : cached.models;
      if (revision !== this._engineRevision) return;
      const fetchedAt = shouldFetch ? Date.now() : cached.fetchedAt;
      this._agentModels[cacheKey] = { models, fetchedAt };
      this._syncEngineLabel();
      this.modelSuggestions.replaceChildren(...models.filter(m => m.id).map(m => h("option", { value: m.id }, m.label || m.id)));
      const def = defaultModel(models);
      this.modelSelect.replaceChildren(...[h("option", { value: "" }, def ? modelLabel(def, models) : "Loading models…"),
        ...models.filter(m => m.id && m.id !== "default" && m !== def && modelLabel(m, models) !== modelLabel(def, models)).map(m => h("option", { value: m.id }, modelLabel(m, models))),
        current && !models.some(m => m.id === current) ? h("option", { value: current }, `${current} (saved)`): null,
        h("option", { value: "__custom" }, "Custom model ID…")].filter(Boolean));
      this.modelSelect.value = current === "default" ? "" : current;
      this.modelInput.hidden = true;
      const model = models.find(m => m.id === current) || models.find(m => current && m.resolvedModel === current) || (!current && models.find(m => m.isDefault || m.id === "default"));
      const values = model?.efforts || [];
      const selected = id === "antigravity" ? model?.effort || "" : s.codexEffort || "";
      this.effortSelect.replaceChildren(...(id === "antigravity" && model?.effort ? [] : [h("option", { value: "" }, model?.defaultEffort ? cap(model.defaultEffort) : "Standard")]), ...values.filter(v => !(v === model?.defaultEffort && !(id === "antigravity" && model?.effort))).map(v => h("option", { value: v }, cap(v))));
      const effective = selected && values.includes(selected) ? selected : "";
      this.effortSelect.value = effective;
      this.effortSelect.disabled = !values.length;
      this.effortSelect.title = values.length ? "Supported levels reported by this provider" : "The provider has not advertised reasoning levels for this model";
      this.modelStatus.textContent = `${models.length} models · ${model?.source || models[0]?.source || "Provider catalog"} · checked ${new Date(fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${values.length ? "" : " · reasoning levels not advertised"}`;
      this.modelStatus.classList.remove("error");
      if (id !== "antigravity" && effective !== (s.codexEffort || "")) await this._saveAgentSettings({ codexEffort: effective });
    } catch (e) {
      if (revision !== this._engineRevision) return;
      this.modelStatus.textContent = `Could not refresh: ${friendly(e)}`;
      this.modelStatus.classList.add("error");
    } finally {
      if (revision === this._engineRevision) { this._modelsLoading = false; this.refreshModelsBtn.disabled = false; this.modelSelect.disabled = false; }
    }
  }

  _setThinking(level) {
    const s = this.state.settings;
    if (s.engine === "antigravity") {
      const current = s.models?.antigravity || "";
      const models = this._agentModels.antigravity?.models || [];
      const model = models.find(m => m.id === current);
      const next = model?.effortVariants?.find(v => v.level === level)?.model;
      if (next) this._saveAgentSettings({ models: { antigravity: next } });
      else if (!level) this._saveAgentSettings({ models: { antigravity: "" } });
    } else this._saveAgentSettings({ codexEffort: level });
  }

  _fit() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const a = this.project?.lecture?.aspect || this.arSelect?.value;
    const ar = a === "9:16" ? 9 / 16 : a === "1:1" ? 1 : 16 / 9;
    let w = r.width - 24,
      hh = r.height - 24;
    if (w / hh > ar) w = hh * ar;
    else hh = w / ar;
    for (const el of [this.player.el, this.video]) {
      el.style.width = Math.max(0, w) + "px";
      el.style.height = Math.max(0, hh) + "px";
    }
  }

  // ---------- projects ----------
  async refreshProjects() {
    try {
      this.projects = await window.ml.ide.list();
    } catch {
      this.projects = [];
    }
    this._paintProjects();
  }

  _paintProjects() {
    const cur = this.project?.lecture?.id;
    this.projList.replaceChildren(
      ...(this.projects.length
        ? this.projects.map((p) =>
            h(
              "div",
              { class: "ide-proj" + (p.id === cur ? " active" : ""), onclick: () => this.open(p.id), title: p.question },
              h("div", { class: "grow" }, h("div", { class: "ide-proj-title" }, p.title || "Untitled"), h("div", { class: "small faint" }, `${p.scenes} scenes · ${fmtTime(p.duration)} · ${fmtDate(p.updatedAt)}`)),
              h("button", { class: "btn ghost sm icon ide-x", title: "Delete project", onclick: async (e) => {
                e.stopPropagation();
                if (!(await confirmBox("Delete project?", `“${p.title}” and its files will be removed.`))) return;
                await window.ml.ide.remove(p.id);
                if (cur === p.id) this.newLecture();
                this.refreshProjects();
              } }, icon("trash")),
            ),
          )
        : [h("div", { class: "small faint", style: { padding: "6px 4px" } }, "Your video projects will appear here.")]),
    );
  }

  async open(id, { keepScene = false } = {}) {
    if (this.job && id !== this.job.projectId) return toast("Stop the current job before opening another project.");
    if (!keepScene) this._hideRenderDone();
    try {
      this.project = await window.ml.ide.get(id);
    } catch (e) {
      toast(friendly(e), { kind: "bad" });
      return;
    }
    if (!keepScene) this.sceneIndex = 0;
    if (this._chatFor !== id) {
      this._chatFor = id;
      this._showChat(this.project.lecture);
    }
    this._loadPlayer();
    this.showPreview("lecture");
    this._paintAll();
  }

  async reload() {
    if (this.project?.lecture?.id && !this.liveJob) await this.open(this.project.lecture.id, { keepScene: true });
    this.refreshProjects();
  }

  _applyProject(p) {
    const t = this.player.t;
    this.project = p;
    this._loadPlayer();
    this.player.seek(Math.min(t, this.player.total));
    this.showPreview("lecture");
    this._paintAll();
    this.refreshProjects();
  }

  _loadPlayer() {
    const lec = this.project.lecture;
    this.player.setLecture(lec);
    this.player.setConfig({ aspect: lec.aspect || "16:9", theme: lec.theme });
    this.player.endLive();
    this._fit();
  }

  newLecture() {
    if (this.job) return toast("Stop the current job before starting another lecture.");
    this.project = null;
    this.liveJob = null;
    this.sceneIndex = 0;
    this.player.setLecture({ scenes: [], aspect: this.arSelect.value });
    this.showPreview("lecture");
    if (this.work) clearInterval(this.work.timer);
    this.work = null;
    this._chatFor = null;
    this.chat.replaceChildren();
    this.welcome = h("div", { class: "agent-welcome" },
      h("div", { class: "agent-welcome-mark" }, icon("sparkles")),
      h("h2", {}, "What video do you want to make next?"),
      h("p", {}, "Teach a concept, explain how something works, demo a product, or tell a story. Describe it, and the agent writes, animates and narrates it. Then shape every scene together."),
      h("div", { class: "agent-suggestions" }, [
        ["Teach a concept", "Make a video teaching "],
        ["Explain how it works", "Make a video explaining how "],
        ["Demo a product", "Make a short product demo video for "],
        ["Tell a story", "Make a short animated story about "],
      ].map(([label, start]) => h("button", { onclick: () => {
        this.input.value = start;
        this.input.focus();
      } }, label))),
    );
    this.chat.append(this.welcome);
    this._paintAll();
    // Nothing connected yet: offer the accounts right here.
    const welcome = this.welcome;
    anyConnected(this.state).then((ok) => {
      const chosen = this.state.settings.engine;
      if ((ok && chosen) || !welcome.isConnected || chosen === "api") return;
      const panel = connectPanel(this.state, { compact: true, onChange: () => this._refreshEngineOptions?.({ force: true }) });
      const box = h("div", { class: "agent-connect" }, h("div", { class: "agent-connect-title" }, "Connect your AI to start"), panel.el);
      welcome.append(box);
      const done = setInterval(async () => {
        if (!welcome.isConnected) return clearInterval(done), panel.stop();
        // Gone once anything is in use: a connected subscription or an API key.
        if (this.state.settings.engine === "api" || (this.state.settings.engine && (await anyConnected(this.state)))) {
          clearInterval(done);
          panel.stop();
          box.remove();
          this._refreshEngineOptions?.({ force: true });
        }
      }, 1500);
    });
  }

  _paintAll() {
    this._paintProjects();
    this._paintFiles();
    this._paintTimeline();
    const lec = this.project?.lecture;
    this.folderTitle.textContent = lec ? lec.title || lec.question : "No project open";
    this.videoTitle.textContent = lec?.title || "";
    this.videoTitle.title = this.videoTitle.textContent;
    this.videoTitle.hidden = !this.videoTitle.textContent;
    const busy = !!this.job;
    this.voiceSelect.disabled = busy;
    this.voiceButton.disabled = busy;
    const rendering = this.job?.type === "render";
    this.renderBtn.disabled = rendering ? false : !lec?.scenes?.length || busy;
    this.renderMenu.disabled = !lec?.scenes?.length || busy;
    this.renderBtn.textContent = rendering ? "■ Stop render" : "Render";
    this.renderBtn.title = rendering ? "Stop rendering" : "Render an MP4";
    this.renderBtn.classList.toggle("render-stop", rendering);
    this.sendBtn.title = busy ? "Send to the agent while it works (Enter)" : "Send message (Enter)";
    this.stopBtn.style.display = busy ? "" : "none";
    this.agentStatus.textContent = busy ? "Working" : "Ready";
    this.agentStatus.className = "agent-status" + (busy ? " working" : "");
    const sc = lec?.scenes?.[this.sceneIndex];
    this.modeNote.textContent = lec?.narrationPending ? "Narration is incomplete. Ask the AI to finish this video." : lec && !this.liveJob && sc ? `Viewing scene ${this.sceneIndex + 1}` : "";
    this.input.placeholder = lec && !this.liveJob ? "Ask for a change, ask about this video, or start something new…" : "What video do you want to make? What do you want to teach?";
    if (this.preview === "lecture") this.curFile.textContent = sc ? `${sc.file} · ${sc.title || ""}` : lec ? "No scenes yet" : "No file selected";
  }

  // ---------- files ----------
  _paintFiles() {
    const files = this.project?.files || [];
    this.artifactCount.textContent = String(files.length);
    const curFile = this.project?.lecture?.scenes?.[this.sceneIndex]?.file;
    this.fileList.replaceChildren(
      ...(files.length
        ? files.map((f) => {
            const kind = /\.(md|json|log)$/.test(f.name) ? "doc" : /\.mp4$/.test(f.name) ? "video" : "scene";
            const active = (this.preview === "lecture" && kind === "scene" && f.name === curFile) || (this.preview !== "lecture" && this._previewName === f.name);
            return h(
              "div",
              { class: "ide-file" + (active ? " active" : ""), onclick: () => this.openFile(f, kind) },
              icon(kind === "doc" ? "text" : kind === "video" ? "film" : "play"),
              h("span", { class: "grow" }, f.name),
              kind === "video" && f.path
                ? h("button", { class: "btn ghost sm icon", title: "Show file", onclick: (e) => {
                    e.stopPropagation();
                    window.ml.shell.showItem(f.path);
                  } }, icon("folder"))
                : null,
            );
          })
        : [h("div", { class: "small faint", style: { padding: "6px 12px" } }, this.project ? "No files yet." : "Open or create a project.")]),
    );
  }

  async openFile(f, kind) {
    if (kind === "scene") {
      const i = this.project.lecture.scenes.findIndex((s) => s.file === f.name);
      this.showPreview("lecture");
      if (i >= 0) this.selectScene(i);
      return;
    }
    this._previewName = f.name;
    if (kind === "video") {
      this.showPreview("video");
      this.video.src = f.url;
      this.curFile.textContent = f.name;
      this.video.play().catch(() => {});
    } else {
      this.showPreview("doc");
      try {
        const text = await window.ml.ide.readFile(this.project.lecture.id, f.name);
        this.docView.replaceChildren(renderDoc(f.name, text));
      } catch (e) {
        this.docView.replaceChildren(h("div", { class: "empty" }, friendly(e)));
      }
      this.curFile.textContent = f.name;
    }
    this._paintFiles();
  }

  showPreview(kind) {
    this.preview = kind;
    if (kind !== "video") this.video.pause();
    this.player.el.style.display = kind === "lecture" ? "" : "none";
    this.docView.style.display = kind === "doc" ? "" : "none";
    this.video.style.display = kind === "video" ? "" : "none";
    if (kind !== "lecture") this.player.pause();
    if (kind === "lecture") this._previewName = null;
    this.closePreviewBtn.hidden = kind === "lecture";
  }

  // ---------- timeline ----------
  _paintTimeline() {
    const scenes = this.project?.lecture?.scenes?.filter(Boolean) || [];
    if (!scenes.length) {
      this._tlTotal = 0;
      this.timeline.replaceChildren(h("div", { class: "small faint", style: { padding: "8px 2px" } }, "No scenes detected."));
      this.ruler.replaceChildren();
      this.playheadEl.style.display = "none";
      this.timelineContent.style.width = "100%";
      this.timecode.textContent = "0:00.00";
      this.ruler.setAttribute("aria-valuemax", "0");
      return;
    }
    this.playheadEl.style.display = "";
    const tl = TL.build(scenes);
    const total = tl.total || 1;
    this._tlTotal = total;
    this._secWidth = Math.max(3, ((this.timelineScroll.clientWidth || 600) - 24) / total);
    this.timelineContent.style.width = total * this._secWidth + "px";
    this.ruler.setAttribute("aria-valuemax", String(total));
    this.timeline.replaceChildren(
      ...scenes.map((sc, i) => {
        const st = tl.scenes[i];
        return h(
          "button",
          {
            class: "ide-scene" + (i === this.sceneIndex ? " active" : ""),
            style: { left: st.start * this._secWidth + "px", width: Math.max(1, st.dur * this._secWidth - 2) + "px" },
            title: `Scene ${i + 1}`,
            onclick: () => this.selectScene(i),
          },
          h("b", {}, `Scene ${i + 1}`),
        );
      }),
    );
    const step = total > 900 ? 60 : total > 300 ? 30 : total > 120 ? 10 : 5;
    const marks = [];
    for (let t = 0; t <= total; t += step) marks.push(h("i", { class: "ide-ruler-tick major", style: { left: t * this._secWidth + "px" } }, h("span", {}, fmtTime(t))));
    this.ruler.replaceChildren(...marks);
    this._playhead(this.player.t);
  }

  _playhead(t) {
    if (!this._tlTotal) return;
    const time = Math.max(0, Math.min(t, this._tlTotal));
    const left = time * this._secWidth;
    this.playheadEl.style.left = left + "px";
    this.timecode.textContent = fmtTime(time) + "." + String(Math.floor((time % 1) * 100)).padStart(2, "0");
    this.ruler.setAttribute("aria-valuenow", time.toFixed(2));
    this.ruler.setAttribute("aria-valuetext", this.timecode.textContent);
    if (this.player.playing && (left < this.timelineScroll.scrollLeft || left > this.timelineScroll.scrollLeft + this.timelineScroll.clientWidth - 40)) {
      this.timelineScroll.scrollLeft = Math.max(0, left - this.timelineScroll.clientWidth / 2);
    }
  }

  selectScene(i) {
    this.sceneIndex = i;
    this.player.seek(this.player.sceneStart(i));
    this._paintAll();
  }

  // ---------- agent chat ----------
  _msg(cls, ...children) {
    this.welcome?.remove();
    const el = h("div", { class: "ide-msg " + cls }, ...children);
    // Job events can arrive before the send request returns. Keep the user's
    // prompt before the work view even when progress has already started.
    if (cls === "user" && this.work?.el.parentNode === this.chat) this.chat.insertBefore(el, this.work.el);
    else this.chat.appendChild(el);
    this.chat.scrollTop = this.chat.scrollHeight;
    return el;
  }
  _sys(text) {
    return this._msg("sys", text);
  }
  _onLog(m) {
    if (this.project && m.projectId && m.projectId !== this.project.lecture.id) return;
    if (m.kind === "error") return void this._msg("err", m.text);
    // Render steps stay out of the agent chat (a toast reports the result).
    if (this.job?.type === "render") {
      if (m.kind !== "reply" && m.kind !== "done" && m.kind !== "stopped") this.agentStatus.textContent = m.text;
      return;
    }
    if (m.kind === "stopped") {
      this._workFinish("");
      return void this._msg("log", m.text);
    }
    // A job's closing line is its answer: shown as the agent's message, under "Worked for …".
    if (m.kind === "reply" || m.kind === "done") return this._workFinish(m.text);
    this._workPush(`🔧 ${m.text}`);
  }

  _onActivity(a) {
    if (this.project && a.projectId && a.projectId !== this.project.lecture.id) return;
    this._workSet(a.items);
  }

  // ---------- Super Agent-style work view ----------
  // While a job runs: "Working for 12s · GPT" over a live timeline of what
  // the agent says (Markdown) and what it does (compact tool steps). When it
  // ends, that collapses into "Worked for 1m 46s ›" and the agent's final
  // message follows as its own reply.
  // Replies and live work are always labeled as the product, never the
  // underlying provider or model.
  _who() {
    return "MyLecture Engine";
  }
  _workStart() {
    if (this.work) return this.work;
    this.welcome?.remove();
    const head = h("div", { class: "work-head shimmer" }, "Working");
    const tl = h("div", { class: "timeline" });
    const el = h("div", { class: "work" }, head, tl);
    this.chat.append(el);
    const w = (this.work = { el, head, tl, started: Date.now(), items: [], agentItems: null, pinned: true, stepAt: Date.now(), stepN: 0 });
    tl.addEventListener("scroll", () => (w.pinned = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 24));
    const tick = () => {
      head.textContent = `MyLecture Engine · Working for ${duration(Date.now() - w.started)}`;
    };
    tick();
    w.timer = setInterval(() => {
      tick();
      if (Date.now() - w.stepAt >= 5000) this._paintWork(); // elapsed time on a slow step
    }, 1000);
    this._paintWork();
    return w;
  }
  _workPush(item) {
    const w = this._workStart();
    if (w.items.at(-1) === item) return;
    w.items.push(item);
    if (!w.agentItems) this._paintWork();
  }
  _workSet(items) {
    const w = this._workStart();
    w.agentItems = items;
    this._paintWork();
  }
  _workItems(w) {
    return w.agentItems || w.items;
  }
  _paintWork() {
    const w = this.work;
    if (!w) return;
    const items = this._workItems(w);
    if (w.stepN !== items.length) (w.stepN = items.length), (w.stepAt = Date.now());
    w.tl.replaceChildren(...timelineNodes(items, { live: true, since: w.stepAt }));
    if (w.pinned) w.tl.scrollTop = w.tl.scrollHeight;
    this._scrollChat();
  }
  _workFinish(reply) {
    const w = this.work;
    if (w) {
      clearInterval(w.timer);
      this.work = null;
      const items = this._workItems(w).filter((s) => !s.startsWith("💭"));
      w.el.replaceWith(workedFor(Date.now() - w.started, items));
    }
    if (String(reply || "").trim()) this._agentMsg(reply);
    this._scrollChat(true);
  }
  _agentMsg(text, at = Date.now()) {
    this.welcome?.remove();
    const who = this._who();
    this.chat.append(
      h("div", { class: "msg agent" }, who ? h("div", { class: "who" }, h("span", { class: "who-mark" }, icon("sparkles")), h("span", {}, who)) : null, markdownEl(text), h("div", { class: "stamp" }, when(at))),
    );
  }
  _scrollChat(force) {
    const c = this.chat;
    if (force || c.scrollHeight - c.scrollTop - c.clientHeight < 160) c.scrollTop = c.scrollHeight;
  }

  // Every message goes to the Video Agent, first or not. With a CLI agent it
  // decides what the message needs (a new video, changes, or just a reply).
  // While the agent works, a message goes straight into its running session
  // (like Claude Code): it reads it at its next step and adapts.
  async send() {
    const text = this.input.value.trim() || (this.attachments.count ? "Make a video based on the attached material." : "");
    if (!text || this.sending) return;
    if (this.liveJob) return this._sendLive(text);
    return this._dispatch(text);
  }

  async _sendLive(text) {
    if (this.attachments.count) return void toast("Files can't be added while the agent is working. Send them after it finishes.");
    this.sending = true;
    try {
      await window.ml.ide.chat({ projectId: this.project?.lecture?.id || null, message: text, live: true });
      this.input.value = "";
      this.input.style.height = "";
    } catch (e) {
      toast(friendly(e), { kind: "bad" });
    } finally {
      this.sending = false;
    }
  }

  async _dispatch(text) {
    this.sending = true;
    this.input.readOnly = true;
    this.attachments.setLocked(true);
    this._toggleEngineOptions(false);
    const length = parseLength(this.lenInput.value) || "1:00";
    const aspect = this.arSelect.value;
    const projectId = this.project?.lecture?.id || null;
    try {
      const attachments = await this.attachments.serialize();
      const r = await window.ml.ide.chat({ projectId, message: text, attachments, sceneIndex: this.sceneIndex, length, aspect, theme: this.themeSelect.value, teachingStyle: this.teachSelect.value });
      this._msg("user", text, attachmentNames(attachments));
      this.input.value = "";
      this.input.style.height = "";
      this.attachments.clear();
      if (r.kind === "project") return void this._applyProject(r.project);
      this.liveJob = r.jobId;
      if (r.lectureId !== projectId) {
        // A new project: the player fills in as scenes are finished.
        this.project = { lecture: { id: r.lectureId, question: text, title: "", aspect, length, scenes: [], chat: [] }, files: [] };
        this._chatFor = r.lectureId;
        this.sceneIndex = 0;
        this.player.setLecture({ scenes: [], aspect });
        this.player.setConfig({ aspect });
        this._fit();
      }
      this._workStart();
      this._paintAll();
      this.refreshProjects();
    } catch (e) {
      this._msg("err", friendly(e));
    } finally {
      this.sending = false;
      this.input.readOnly = false;
      this.attachments.setLocked(false);
    }
  }

  // The project's conversation, when switching to it.
  _showChat(lec) {
    if (this.work) clearInterval(this.work.timer);
    this.work = null;
    this.chat.replaceChildren();
    for (const m of lec.chat || []) {
      if (m.role === "user") this._msg("user", m.text, attachmentNames(m.attachments));
      else if (m.role === "error") this._msg("err", m.text);
      else this._agentMsg(m.text, m.at);
    }
    this._scrollChat(true);
  }

  _onGen(ev) {
    if (!this.liveJob || ev.jobId !== this.liveJob || !this.project) return;
    const lec = this.project.lecture;
    switch (ev.type) {
      case "activity":
        this._workSet(ev.items);
        break;
      case "status":
        this._workPush(`🔧 ${String(ev.message).replace(/…$/, "")}`);
        break;
      case "title":
        lec.title = ev.title;
        this._paintAll();
        break;
      case "scene":
        lec.scenes[ev.index] = ev.scene;
        this.player.addScene(ev.index, ev.scene);
        this._workPush(`🔧 Ready Scene ${ev.index + 1} · ${fmtTime(ev.scene.beats.reduce((a, b) => a + (b.dur || 0), 0))}`);
        this._paintTimeline();
        break;
      case "error":
        this._msg(ev.aborted ? "log" : "err", ev.aborted ? "Stopped." : friendly(ev.message));
        break;
      case "done":
        this.liveJob = null;
        this._workFinish(ev.reply || (ev.lecture.status === "ready" && ev.lecture.scenes.length ? `Your video is ready: **${ev.lecture.scenes.length} scenes**, ${fmtTime(ev.lecture.duration || 0)}.` : ""));
        if (ev.lecture.status !== "ready") this._msg("err", `${cap(ev.lecture.status)} · ${ev.lecture.scenes.length} scenes.`);
        this.open(ev.lectureId);
        this.refreshProjects();
        break;
    }
  }

  _onJob(j) {
    // Render is local (no AI): its progress lives in the header status, not
    // in the agent's "Working · Claude" chat block.
    if (j.type === "render") this._renderBar(j.state === "running" ? 0 : null);
    if (j.state === "running" && j.type !== "render") this._workStart();
    else if (j.state !== "running" && this.work && !this.liveJob) this._workFinish("");    this.job = j.state === "running" ? { type: j.type, projectId: j.projectId } : null;
    this._paintAll();
  }

  _onProgress(p) {
    if (!this.job) return;
    if (this.job.type === "render") {
      if (p.progress != null) this._renderBar(p.progress);
      this._renderLabel(p);
    }
    const pct = p.progress != null ? ` ${Math.round(p.progress * 100)}%` : "";
    // Progress (e.g. rendering) shows in the header status next to the title.
    this.agentStatus.textContent = `${cap(p.phase || this.job.type)}${pct}`;
  }

  // ---------- render ----------
  // After a render: "✓ Video ready · Watch · Show in folder" in the controls row.
  _showRenderDone(file) {
    const name = file.split(/[\\/]/).pop();
    this.renderDone.replaceChildren(
      h("span", { class: "render-done-label", title: file }, "✓ Video ready", h("span", { class: "render-done-name" }, name)),
      h("button", { class: "btn sm render-done-btn", title: "Play the video", onclick: () => window.ml.shell.openPath(file) }, "▶ Watch"),
      h("button", { class: "btn sm", title: "Show the file in its folder", onclick: () => window.ml.shell.showItem(file) }, "Show in folder"),
      h("button", { class: "btn ghost sm icon", title: "Dismiss", "aria-label": "Dismiss", onclick: () => this._hideRenderDone() }, icon("x")),
    );
    this.renderDone.hidden = false;
    this.curFile.hidden = true;
  }
  _hideRenderDone() {
    if (this.renderDone.hidden) return;
    this.renderDone.hidden = true;
    this.curFile.hidden = false;
  }
  // "Rendering 1920×1080 · 30 fps · frame 120/900 (14 fps) · 42% · ETA 0:55"
  _renderLabel(p) {
    const o = this._renderOpts();
    const res = p.width && p.height ? `${p.width}×${p.height}` : `${o.height}p`;
    const parts = [p.phase === "audio" ? "Preparing narration" : "Rendering", res, `${p.fps || o.fps} fps`];
    if (p.frames) parts.push(`frame ${p.frame}/${p.frames}` + (p.speed ? ` (${p.speed.toFixed(1)} fps)` : ""));
    if (p.progress != null && p.phase !== "audio") parts.push(`${Math.round(p.progress * 100)}%`);
    if (p.phase === "done") parts.push("finishing…");
    else parts.push(p.eta != null ? `ETA ${duration(p.eta * 1000)}` : "ETA calculating…");
    this.renderInfo.textContent = parts.join(" · ");
    this.renderInfo.hidden = false;
    this.curFile.hidden = true;
  }
  // Thin bar on the top edge of the controls row; null hides it.
  _renderBar(frac) {
    this.renderBar.hidden = frac == null;
    if (frac == null) {
      this.renderInfo.hidden = true;
      this.curFile.hidden = false;
      return;
    }
    if (frac === 0) {
      this._hideRenderDone();
      this._renderLabel({});
    }
    const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    this.renderBarFill.style.width = pct + "%";
    this.renderBar.setAttribute("aria-valuenow", String(pct));
  }
  _renderOpts() {
    return (this._rdo ||= { fps: 30, height: 1080, captions: false });
  }
  _renderOptions(anchor) {
    const o = this._renderOpts();
    popMenu(anchor, [
      { label: "Frame rate" },
      ...[24, 30, 60].map((v) => ({ text: `${v} fps${o.fps === v ? "  ✓" : ""}`, run: () => (o.fps = v) })),
      "-",
      { label: "Resolution" },
      ...[
        [1080, "1080p"],
        [720, "720p"],
      ].map(([v, l]) => ({ text: `${l}${o.height === v ? "  ✓" : ""}`, run: () => (o.height = v) })),
      "-",
      { text: `${o.captions ? "✓ " : ""}Embed captions`, run: () => (o.captions = !o.captions) },
    ]);
  }
  stopRender() {
    this._renderStopped = true;
    this.renderBtn.disabled = true;
    this.renderBtn.textContent = "Stopping…";
    window.ml.ide.stop();
  }
  async render() {
    const o = this._renderOpts();
    this._renderStopped = false;
    try {
      const r = await window.ml.ide.render(this.project.lecture.id, { fps: o.fps, height: o.height, captions: o.captions });
      this.project.files = r.files;
      this._paintFiles();
      if (this._renderStopped) return;
      this._showRenderDone(r.file);
      bus.emit("library-changed");
    } catch (e) {
      if (this._renderStopped || /cancel|abort/i.test(String(e?.message || e))) return void toast("Render stopped");
      this._msg("err", friendly(e));
    }
  }

  // ---------- dialogs ----------
  // Re-record every beat of the open project with another voice (engine,
  // voice and speed). Visuals and narration text stay as they are.
  async changeVoice() {
    const lec = this.project?.lecture;
    if (!lec?.scenes?.length || this.liveJob || this.job) return toast("Open a finished project first.");
    let voices, comps;
    try { [voices, comps] = await Promise.all([window.ml.tts.voices(), window.ml.components.status().catch(() => [])]); }
    catch (e) { return toast(friendly(e), { kind: "bad" }); }
    const s = this.state.settings;
    const omniReady = comps.find((c) => c.id === "omnivoice")?.installed !== false;
    const engineSel = h("select", { class: "select" },
      h("option", { value: "kokoro", selected: s.voiceEngine !== "omnivoice" }, "Kokoro"),
      h("option", { value: "omnivoice", selected: s.voiceEngine === "omnivoice", disabled: !omniReady }, omniReady ? "OmniVoice" : "OmniVoice (install it in Settings)"));
    const voiceSel = h("select", { class: "select" });
    const fillVoices = () => {
      const engine = engineSel.value;
      const current = engine === "omnivoice" ? s.omnivoiceVoice || "maruf" : s.voice;
      voiceSel.replaceChildren(...(voices[engine] || []).map(([id, label]) => h("option", { value: id, selected: id === current }, label)));
    };
    engineSel.onchange = fillVoices;
    fillVoices();
    const speed = h("input", { type: "range", min: "0.7", max: "1.4", step: "0.05", value: String(s.voiceSpeed || 1) });
    const speedLbl = h("span", { class: "small muted" }, `${Number(speed.value).toFixed(2)}×`);
    speed.oninput = () => { speedLbl.textContent = `${Number(speed.value).toFixed(2)}×`; };
    const row = (label, ...ctl) => h("label", { style: { display: "grid", gridTemplateColumns: "90px 1fr auto", gap: "10px", alignItems: "center", margin: "8px 0" } }, h("span", {}, label), ...ctl);
    modal({
      title: "Change voice",
      width: "440px",
      body: h("div", {},
        h("p", { class: "muted small", style: { marginTop: 0 } }, "Re-records all narration in this video with the voice you pick. Visuals and narration text don't change."),
        row("Engine", engineSel), row("Voice", voiceSel), row("Speed", speed, speedLbl)),
      actions: [
        { label: "Cancel" },
        { label: "Change voice", primary: true, run: async () => {
          const voiceEngine = engineSel.value, voice = voiceSel.value, voiceSpeed = Number(speed.value);
          // New narration (and later per-beat edits) use this voice from now on.
          this.state.settings = await window.ml.settings.set(voiceEngine === "omnivoice" ? { voiceEngine, omnivoiceVoice: voice, voiceSpeed } : { voiceEngine, voice, voiceSpeed });
          bus.emit("settings-changed", this.state.settings);
          toast("Re-recording narration with the new voice…", { timeout: 4000 });
          window.ml.ide.resolve(lec.id, { voiceEngine, voice, speed: voiceSpeed })
            .then((p) => { if (this.project?.lecture.id === lec.id) this._applyProject(p); toast("Voice changed."); })
            .catch((e) => toast(friendly(e), { kind: "bad", timeout: 9000 }));
        } },
      ],
    });
  }

  async editNarration() {
    const lec = this.project?.lecture;
    if (!lec?.scenes?.length || this.liveJob || this.job) return toast("Open a finished project first.");
    let entries;
    try { entries = await window.ml.ide.narration(lec.id); }
    catch (e) { return toast(friendly(e), { kind: "bad" }); }
    if (!entries.length) return toast("This project has no narration.");
    const body = h("div", { class: "narration-list" });
    const buttons = [];
    let sceneIndex = -1, saving = false;
    for (const entry of entries) {
      if (entry.sceneIndex !== sceneIndex) {
        sceneIndex = entry.sceneIndex;
        body.append(h("h3", { class: "narration-scene" }, `Scene ${sceneIndex + 1}`));
      }
      let original = entry.spokenText;
      const spoken = h("textarea", { class: "textarea narration-spoken", rows: 1, spellcheck: true,
        readOnly: !entry.sectionId, "aria-label": `Scene ${entry.sceneIndex + 1}, beat ${entry.beatIndex + 1} narration` });
      // A textarea's text must be set as a property; a value attribute is ignored.
      spoken.value = original || "";
      const fit = () => { if (!spoken.style) return; spoken.style.height = "auto"; spoken.style.height = spoken.scrollHeight + 2 + "px"; };
      spoken.addEventListener("input", fit);
      setTimeout(fit, 0);
      // Only show the on-screen caption when it differs from what is spoken.
      const caption = entry.caption && entry.caption.trim() !== (original || "").trim() ? h("div", { class: "narration-caption" }, entry.caption) : null;
      const regenerate = h("button", { class: "btn sm", disabled: true, onclick: async () => {
        if (saving) return;
        saving = true;
        for (const { button } of buttons) button.disabled = true;
        regenerate.textContent = "Regenerating…";
        spoken.readOnly = true;
        try {
          const p = await window.ml.ide.editNarration(lec.id, { sceneIndex: entry.sceneIndex, sectionId: entry.sectionId, text: entry.caption, ttsText: spoken.value });
          const beat = p.lecture.scenes[entry.sceneIndex].beats[entry.beatIndex];
          original = beat.spokenText ?? spoken.value;
          spoken.value = original;
          this._applyProject(p);
        } catch (e) { toast(friendly(e), { kind: "bad" }); }
        finally {
          saving = false;
          spoken.readOnly = !entry.sectionId;
          regenerate.textContent = "Regenerate";
          for (const { button, changed } of buttons) { button.disabled = !changed(); button.hidden = !changed(); }
        }
      } }, "Regenerate");
      const changed = () => !!entry.sectionId && !!spoken.value.trim() && spoken.value !== original;
      buttons.push({ button: regenerate, changed });
      regenerate.hidden = true;
      spoken.addEventListener("input", () => { regenerate.disabled = saving || !changed(); regenerate.hidden = !changed() && !saving; });
      body.append(h("div", { class: "narration-beat" }, h("div", { class: "narration-row" }, spoken, entry.sectionId ? regenerate : null), caption));
    }
    modal({ title: "Edit narration", width: "min(820px, 92vw)", body, actions: [{ label: "Done" }] });
  }

  async editVisual() {
    const lec = this.project?.lecture;
    const sc = lec?.scenes?.[this.sceneIndex];
    if (!sc || this.liveJob) return toast("Open a finished project and select a scene first.");
    let tab = "prompt";
    const prompt = h("textarea", { class: "textarea", rows: 5, spellcheck: true, placeholder: "For example: Center the three-node timeline horizontally in the frame. Keep its size, content, and animation unchanged." });
    const candidates = await window.ml.ide.visualCandidates(lec.id, this.sceneIndex).catch(() => []);
    const find = h("input", { class: "input", placeholder: "Exact current wording" });
    const pick = h("select", { class: "select", onchange: () => (find.value = pick.value) }, h("option", { value: "" }, "Choose text from this scene"), candidates.map((c) => h("option", { value: c }, c.slice(0, 90))));
    const repl = h("textarea", { class: "textarea", rows: 3, placeholder: "New wording, or leave empty to delete" });
    const promptPane = h("div", {}, h("div", { class: "field" }, h("label", {}, "Change request"), prompt), h("p", { class: "small muted" }, "A fresh editor sees only this scene and this request. Narration, audio, timing, and other scenes are protected."));
    const exactPane = h(
      "div",
      { style: { display: "none" } },
      h("div", { class: "field" }, h("label", {}, "Visible text"), pick),
      h("div", { class: "field" }, h("label", {}, "Text to replace"), find),
      h("div", { class: "field" }, h("label", {}, "Replacement"), repl),
      h("p", { class: "small muted" }, "The exact match is changed in this scene and in script.md when present. No model is used."),
    );
    const seg = h(
      "div",
      { class: "seg", style: { marginBottom: "12px" } },
      [
        ["prompt", "Prompt model"],
        ["exact", "Exact text"],
      ].map(([v, l]) =>
        h("button", { class: v === tab ? "on" : "", onclick: (e) => {
          tab = v;
          seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
          promptPane.style.display = v === "prompt" ? "" : "none";
          exactPane.style.display = v === "exact" ? "" : "none";
        } }, l),
      ),
    );
    modal({
      title: `Edit visual · ${sc.file}`,
      body: h("div", {}, seg, promptPane, exactPane),
      actions: [
        { label: "Cancel" },
        {
          label: "Apply",
          primary: true,
          run: async () => {
            try {
              if (tab === "exact") {
                const p = await window.ml.ide.editVisualText(lec.id, { sceneIndex: this.sceneIndex, oldText: find.value, newText: repl.value });
                this._applyProject(p);
              } else {
                const instruction = prompt.value.trim();
                if (!instruction) return false;
                this._msg("user", `Edit visual (${sc.file}): ${instruction}`);
                window.ml.ide
                  .editScene(lec.id, { sceneIndex: this.sceneIndex, instruction, scope: "visual" })
                  .then((p) => this._applyProject(p))
                  .catch((e) => this._msg("err", friendly(e)));
              }
            } catch (e) {
              toast(friendly(e), { kind: "bad" });
              return false;
            }
          },
        },
      ],
    });
  }

  info() {
    const lec = this.project?.lecture;
    if (!lec) return;
    const row = (k, v) => [h("dt", {}, k), h("dd", {}, v)];
    modal({
      title: "Video info",
      body: h(
        "dl",
        { class: "ide-info" },
        ...row("Title", lec.title || ""),
        ...row("Request", lec.question || ""),
        ...row("Length", `${fmtTime(lec.duration || 0)} (requested ${lec.length || "-"})`),
        ...row("Aspect", lec.aspect || "16:9"),
        ...row("Theme", lec.theme || "default"),
        ...row("Teaching style", lec.teachingStyle || "default"),
        ...row("Scenes", String((lec.scenes || []).length)),
        ...row("Engine", `${lec.engine || ""} ${lec.model || ""}`),
        ...row("Created", fmtDate(lec.createdAt)),
      ),
      actions: [{ label: "Close" }],
    });
  }
}

function cap(s) {
  s = String(s || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function friendly(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

// Minimal viewer for answer.md, script.md (N:/V: cues), JSON and logs.
function renderDoc(name, text) {
  const wrap = h("div", { class: "ide-doc-inner" }, h("div", { class: "ide-doc-name" }, name));
  if (/\.(json|log)$/.test(name)) {
    wrap.appendChild(h("pre", {}, text));
    return wrap;
  }
  // Markdown, with script cues (N: narration, V: visual) shown as cue rows.
  const cue = (line, probe) => {
    const m = line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?([NV]):(?:\*\*)?\s*(.*)$/i);
    if (!m) return null;
    if (probe) return true;
    const k = m[1].toUpperCase();
    return h("p", { class: k === "N" ? "doc-n" : "doc-v" }, h("b", {}, k), ...renderInline(m[2]));
  };
  wrap.appendChild(markdownEl(text, "", { lineHook: cue }));
  return wrap;
}

// ---------- Super Agent-style timeline (same item format and rendering) ----------
function duration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function when(at) {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `today ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
// Paths shown by their last two parts; anything else as is.
const shortPath = (s) => (/^([a-zA-Z]:)?[\\/]/.test(s) ? s.split(/[\\/]/).slice(-2).join("/") : s);

// The agent's words one by one; consecutive tool steps together.
function groups(items) {
  const out = [];
  items.forEach((s, i) => {
    const user = s.startsWith("👤");
    const say = user || /^(💬|🏁)/u.test(s);
    const last = out.at(-1);
    if (!say && last && !last.say) last.items.push(s);
    else out.push({ say, user, at: i, items: [s] });
  });
  return out;
}

function timelineNodes(items, { live = false, since = 0 } = {}) {
  // "Thinking…" only shows while it's happening (the last item).
  items = items.filter((s, i) => !s.startsWith("💭") || i === items.length - 1);
  if (!items.length) return [h("div", { class: "g-step now" }, h("i", {}, "Thinking…"))];
  return groups(items).map((g) =>
    g.user
      ? h("div", { class: "ide-msg user tl-user" }, g.items[0].replace(/^👤s*/u, ""))
      : g.say
      ? h("div", { class: "tl-say" }, markdownEl(g.items[0].slice(2).trim()))
      : h("div", { class: "tl-tools" }, ...g.items.map((s, j) => step(s, live && g.at + j === items.length - 1, since))),
  );
}

// One activity line: a short verb and what it acted on.
function step(text, live, since) {
  const m = /^(💭|🔧|▶|✏️|🔎|💬)\s*(.*)$/su.exec(text);
  const [ic, rest] = m ? [m[1], m[2]] : ["💬", text];
  const tool = /^(\S+(?: files| file| command)?)\s*(.*)$/s.exec(rest);
  const arg = (t) => h("span", { class: "g-arg" }, t);
  const body =
    ic === "💭" ? [h("i", {}, "Thinking…")]
    : ic === "✏️" ? [h("b", {}, "Edited"), " ", arg(rest ? rest.split(/,\s*/).map(shortPath).join(", ") : "files")]
    : ic === "▶" ? [h("b", {}, "Ran"), " ", h("code", {}, rest)]
    : ic === "🔎" ? [h("b", {}, "Searched"), " ", rest]
    : ic === "🔧" && tool ? [h("b", {}, cap(tool[1].replace(/_/g, " "))), " ", arg(shortPath(tool[2]))]
    : [h("span", { class: "g-say" }, rest.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1"))];
  const say = !["💭", "✏️", "▶", "🔎", "🔧"].includes(ic) || (ic === "🔧" && !tool);
  const long = !say && rest.length > 60;
  const ms = live && since ? Date.now() - since : 0;
  const el = h("div", { class: `g-step${live ? " now" : ""}${say ? " say" : ""}${long ? " long" : ""}`, title: long ? "Click to see all of it" : null },
    ms >= 5000 && !say ? h("span", { class: "g-elapsed" }, duration(ms)) : null, ...body);
  if (long) el.addEventListener("click", () => el.classList.toggle("open"));
  return el;
}

// A finished job's activity, collapsed above its answer: "Worked for 2m 13s ›".
function workedFor(ms, items) {
  const caret = h("span", { class: "caret" }, items.length ? "›" : "");
  const btn = h("button", { class: "worked-head", disabled: !items.length }, `Worked for ${duration(ms)}`, caret);
  const box = h("div", { class: "worked" }, btn);
  let tl = null;
  btn.addEventListener("click", () => {
    if (tl) {
      tl.remove();
      tl = null;
      caret.textContent = "›";
    } else {
      tl = h("div", { class: "timeline" }, ...timelineNodes(items));
      box.append(tl);
      caret.textContent = "▾";
    }
  });
  return box;
}

// The model a provider uses when none is chosen, and how to name it.
function defaultModel(models) {
  return models.find((m) => m.isDefault) || models.find((m) => m.id === "default") || models[0] || null;
}
// Claude's "default" entry points at a real model (resolvedModel): use that model's name.
function modelLabel(m, models = []) {
  if (!m) return "";
  if (m.id !== "default") return m.label || m.id;
  const real = models.find((x) => x.id !== "default" && (x.id === m.resolvedModel || x.resolvedModel === m.resolvedModel));
  return real ? real.label || real.id : prettyModelId(m.resolvedModel) || m.label;
}
function prettyModelId(id) {
  if (!id) return "";
  return id.replace(/^claude-/, "").split("-").map((p, i, a) => (/^\d+$/.test(p) && /^\d+$/.test(a[i - 1] || "") ? "." + p : (i ? " " : "") + p.charAt(0).toUpperCase() + p.slice(1))).join("");
}
