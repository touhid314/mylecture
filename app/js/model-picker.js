// Provider, model and thinking buttons for an AI toolbar: Create's video agent
// and Study's tutor use the same picker. Each screen has its own settings (a
// "scope"); the provider catalog and model lists are shared, so opening both
// screens starts a provider's tool for its model list only once.
import { h, toast, popMenu, bus } from "./ui.js";
import { showApiKeyDialog } from "./api-key.js";

const friendly = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const API_NAMES = { gemini: "Gemini API", compatible: "LiteLLM" };
export const providerName = (engine, s) => ({ "claude-code": "Claude", codex: "GPT", antigravity: "Gemini" }[engine] || (engine === "api" ? API_NAMES[s.api?.provider] || "API key" : engine));

export function defaultModel(models) {
  return models.find((m) => m.isDefault) || models.find((m) => m.id === "default") || models[0] || null;
}
// Claude's "default" entry points at a real model (resolvedModel): use that model's name.
export function modelLabel(m, models = []) {
  if (!m) return "";
  if (m.id !== "default") return m.label || m.id;
  const real = models.find((x) => x.id !== "default" && (x.id === m.resolvedModel || x.resolvedModel === m.resolvedModel));
  return real ? real.label || real.id : prettyModelId(m.resolvedModel) || m.label;
}
function prettyModelId(id) {
  if (!id) return "";
  return id.replace(/^claude-/, "").split("-").map((p, i, a) => (/^\d+$/.test(p) && /^\d+$/.test(a[i - 1] || "") ? "." + p : (i ? " " : "") + p.charAt(0).toUpperCase() + p.slice(1))).join("");
}

// Shared by every picker. Ten minutes: each fetch starts the provider's tool
// (Gemini's may ask to sign in).
const MODELS_TTL = 600000;
const cache = new Map(); // key -> { models, fetchedAt }
const inflight = new Map(); // key -> Promise<models>
let catalog = null;
const modelsKey = (engine, s) => (engine === "api" ? `api:${s.api?.provider}` : engine);
const canList = (engine, s) => !!engine && (engine === "api" || !!s.connected?.[engine]);

async function saveSettings(state, patch) {
  try {
    await window.ml.settings.set(patch);
    state.settings = await window.ml.settings.get();
    bus.emit("settings-changed", state.settings);
    return true;
  } catch (e) { toast(friendly(e), { kind: "bad" }); return false; }
}

// How each screen stores its choice.
const SCOPES = {
  // The video agent: engine, models[engine] (or api.model) and the provider's
  // own reasoning levels (remembered per provider).
  create: {
    engine: (s) => s.engine || "",
    model: (s, engine) => (engine === "api" ? s.api?.model || "" : s.models?.[engine] || ""),
    setEngine(state, engine) {
      const s = state.settings;
      return saveSettings(state, { engine, codexEffort: s.engineEfforts?.[modelsKey(engine, s)] ?? "" });
    },
    setModel(state, engine, model, isDefault) {
      const id = isDefault ? "" : model.id;
      return saveSettings(state, engine === "api" ? { api: { model: id } } : { models: { [engine]: id } });
    },
    // Levels the provider reports for this model; Gemini's are separate model ids.
    thinking(s, engine, model) {
      const values = model?.efforts || [];
      if (engine === "antigravity") {
        const current = model?.effort || "";
        return { current, label: current ? cap(current) : "Standard", items: [...(model?.effort ? [] : [{ value: "", text: model?.defaultEffort ? cap(model.defaultEffort) : "Standard" }]), ...values.filter((v) => v !== model?.defaultEffort || model?.effort).map((v) => ({ value: v, text: cap(v) }))] };
      }
      const current = s.codexEffort && values.includes(s.codexEffort) ? s.codexEffort : "";
      const shown = current || model?.defaultEffort;
      return { current, label: shown ? cap(shown) : "Standard", items: [{ value: "", text: model?.defaultEffort ? cap(model.defaultEffort) : "Standard" }, ...values.filter((v) => v !== model?.defaultEffort).map((v) => ({ value: v, text: cap(v) }))], advertised: values.length > 0 };
    },
    setThinking(state, engine, model, level) {
      const s = state.settings;
      if (engine === "antigravity") {
        const next = model?.effortVariants?.find((v) => v.level === level)?.model;
        if (next) return saveSettings(state, { models: { antigravity: next } });
        if (!level) return saveSettings(state, { models: { antigravity: "" } });
        return Promise.resolve(false);
      }
      return saveSettings(state, { codexEffort: level, engineEfforts: { [modelsKey(engine, s)]: level } });
    },
    // A remembered level this model doesn't offer is dropped.
    reconcile(state, engine, model) {
      const s = state.settings;
      if (engine === "antigravity" || !s.codexEffort) return;
      if (!(model?.efforts || []).includes(s.codexEffort)) saveSettings(state, { codexEffort: "", engineEfforts: { [modelsKey(engine, s)]: "" } });
    },
  },
  // The tutor: its own engine and model (or the same as Create's), and how
  // long it may think before it starts talking.
  tutor: {
    engine: (s) => s.tutorEngine || s.engine || "",
    model: (s, engine) => (s.tutorEngine && s.tutorModel ? s.tutorModel : engine === "api" ? s.api?.model || "" : s.models?.[engine] || ""),
    sameAsCreate: (s) => !s.tutorEngine,
    setEngine: (state, engine) => saveSettings(state, { tutorEngine: engine, tutorModel: "" }),
    setModel(state, engine, model, isDefault) {
      // "default" is Claude's alias: the tutor stores the real model it means.
      const id = isDefault && model.id === "default" ? model.resolvedModel || "" : model.id;
      return saveSettings(state, { tutorEngine: engine, tutorModel: id });
    },
    thinking(s) {
      const levels = [["low", "Fast", "Fast (recommended)"], ["medium", "Balanced", "Balanced"], ["high", "Thorough", "Thorough (slower to start)"]];
      const current = s.tutorEffort || "low";
      return { current, label: levels.find(([v]) => v === current)?.[1] || "Fast", items: levels.map(([value, , text]) => ({ value, text })), title: "Thinking before it speaks: faster starts talking sooner" };
    },
    setThinking: (state, engine, model, level) => saveSettings(state, { tutorEffort: level }),
    reconcile() {},
  },
};

export class ModelPicker {
  constructor({ state, scope = "create", classes = { provider: "agent-option agent-provider", model: "agent-option agent-model-name", thinking: "agent-option agent-thinking" } }) {
    this.state = state;
    this.scope = SCOPES[scope];
    this.status = "";
    this.providerBtn = h("button", { class: classes.provider, title: "Provider", "aria-label": "Choose provider", "aria-haspopup": "menu", onclick: () => this.providerMenu() });
    this.modelBtn = h("button", { class: classes.model, "aria-label": "Choose model", "aria-haspopup": "menu", onclick: () => this.modelMenu() });
    this.thinkingBtn = h("button", { class: classes.thinking, title: "Reasoning effort", "aria-label": "Choose reasoning effort", "aria-haspopup": "menu", onclick: () => this.thinkingMenu() });
    this.buttons = [this.providerBtn, this.modelBtn, this.thinkingBtn];
    bus.on("settings-changed", () => {
      this.sync();
      // A new provider or account: its models, if this screen is open.
      if (this.visible() && this._listedKey !== this._key()) this.refresh();
    });
    this.sync();
  }

  visible() { return this.providerBtn.isConnected && this.providerBtn.offsetParent !== null; }
  _engine() { return this.scope.engine(this.state.settings); }
  _key() { const s = this.state.settings; return `${modelsKey(this._engine(), s)}|${s.connected?.[this._engine()] ? 1 : 0}|${s.accountRevision?.[this._engine()] || 0}`; }
  _models() { return cache.get(modelsKey(this._engine(), this.state.settings))?.models || []; }

  // The configured model, as an entry of the provider's list when it is one.
  current() {
    const s = this.state.settings, engine = this._engine();
    const configured = this.scope.model(s, engine);
    const models = this._models();
    const entry = models.find((m) => m.id === configured || (configured && m.resolvedModel === configured)) || (!configured ? models.find((m) => m.isDefault || m.id === "default") : null);
    return { engine, configured, models, entry };
  }

  sync() {
    const s = this.state.settings;
    const { engine, configured, models, entry } = this.current();
    this.providerBtn.textContent = engine ? providerName(engine, s) : "Choose AI";
    this.providerBtn.title = `Provider: ${this.providerBtn.textContent}${this.scope.sameAsCreate?.(s) ? " (same as Create)" : ""}`;
    const label = entry ? modelLabel(entry, models) : configured || (models.length ? modelLabel(defaultModel(models), models) : "");
    this.modelBtn.textContent = label || (!engine ? "Choose a model" : canList(engine, s) ? "Loading models…" : "Default model");
    this.modelBtn.title = configured || entry?.resolvedModel || entry?.id || label || "";
    const t = this.scope.thinking(s, engine, entry);
    this.thinkingBtn.textContent = t.label;
    this.thinkingBtn.title = t.title || `Reasoning effort: ${t.current || "standard"}`;
  }

  // Lists the models of the selected provider (only a connected one: listing
  // starts its tool), while its screen is open. Cached for ten minutes unless
  // forced.
  async refresh({ force = false } = {}) {
    // Its screen isn't open: listed when it is (the screen calls refresh).
    if (!force && !this.visible()) return;
    const s = this.state.settings, engine = this._engine();
    this._listedKey = this._key();
    if (!canList(engine, s)) {
      this.status = engine ? "Connect this account in Settings to see its models." : "";
      this.sync();
      return;
    }
    const key = modelsKey(engine, s);
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < MODELS_TTL) {
      this._afterList(engine, cached);
      return;
    }
    this.status = "Checking provider models…";
    try {
      let job = !force && inflight.get(key);
      if (!job) {
        job = window.ml.engines.models(engine);
        inflight.set(key, job);
        job.finally(() => { if (inflight.get(key) === job) inflight.delete(key); }).catch(() => {});
      }
      const models = await job;
      const entry = { models, fetchedAt: Date.now() };
      cache.set(key, entry);
      if (modelsKey(this._engine(), this.state.settings) !== key) return;
      this._afterList(engine, entry);
    } catch (e) {
      this.status = `Could not refresh: ${friendly(e)}`;
      this.sync();
    }
  }

  _afterList(engine, { models, fetchedAt }) {
    this.status = `${models.length} models · ${models[0]?.source || "Provider catalog"} · checked ${new Date(fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    this.sync();
    this.scope.reconcile(this.state, engine, this.current().entry);
  }

  async providerMenu() {
    try {
      catalog ||= await window.ml.engines.list();
      const s = this.state.settings, engine = this._engine(), same = this.scope.sameAsCreate?.(s);
      const mark = (on) => (on ? "  ✓" : "");
      const subs = catalog.engines.filter((e) => e.id !== "api");
      const items = [{ label: "Provider" }];
      if (this.scope.sameAsCreate) items.push({ text: `Same as Create (${s.engine ? providerName(s.engine, s) : "none"})${mark(same)}`, run: () => saveSettings(this.state, { tutorEngine: "", tutorModel: "" }) }, "-");
      items.push(...subs.map((e) => ({ text: `${e.name}${mark(!same && engine === e.id)}`, run: () => (s.connected?.[e.id] ? this.scope.setEngine(this.state, e.id) : this._connectFirst(e.name)) })), "-");
      const apiReady = s.engine === "api" || !!s.apiKeys?.[s.api?.provider];
      if (this.scope.sameAsCreate && apiReady) items.push({ text: `${providerName("api", s)} (your API key)${mark(!same && engine === "api")}`, run: () => this.scope.setEngine(this.state, "api") });
      items.push({ text: `Use with API key…${!this.scope.sameAsCreate ? mark(engine === "api") : ""}`, run: () => showApiKeyDialog(this.state, { onDone: () => (this.scope.sameAsCreate ? this.scope.setEngine(this.state, "api") : this.refresh({ force: true })) }) });
      popMenu(this.providerBtn, items);
    } catch (e) { toast(friendly(e), { kind: "bad" }); }
  }

  _connectFirst(name) {
    toast(`Connect ${name} first: Settings → Connect.`, { actions: [{ label: "Open Settings", run: () => bus.emit("navigate", { view: "settings" }) }] });
  }

  async modelMenu() {
    await this.refresh();
    const { engine, models, entry } = this.current();
    const def = defaultModel(models);
    const shown = models.filter((m) => m.id !== "default" || !models.some((x) => x !== m && x.id === m.resolvedModel));
    const items = shown.map((m) => ({ text: `${modelLabel(m, models)}${m === entry || (!entry && m === def) ? "  ✓" : ""}`, run: () => this.scope.setModel(this.state, engine, m, m === def) }))
      .filter((x, i, all) => all.findIndex((y) => y.text.replace(/  ✓$/, "") === x.text.replace(/  ✓$/, "")) === i);
    popMenu(this.modelBtn, [{ label: "Model" }, ...items, "-",
      { text: "Refresh models", run: async () => { await this.refresh({ force: true }); this.modelMenu(); } },
      ...(this.status ? [{ label: this.status }] : [])]);
  }

  async thinkingMenu() {
    await this.refresh();
    const s = this.state.settings;
    const { engine, entry } = this.current();
    const t = this.scope.thinking(s, engine, entry);
    popMenu(this.thinkingBtn, [{ label: this.scope.sameAsCreate ? "Thinking" : "Reasoning effort" },
      ...t.items.map((o) => ({ text: `${o.text}${o.value === t.current ? "  ✓" : ""}`, run: () => this.scope.setThinking(this.state, engine, entry, o.value) })),
      ...(t.advertised === false ? [{ label: "Provider has not advertised additional levels" }] : [])]);
  }
}
