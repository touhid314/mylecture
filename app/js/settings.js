import { connectPanel } from "./connect.js";
import { showApiKeyDialog } from "./api-key.js";
import { h, icon, toast, bus } from "./ui.js";
import { showLiveLog } from "./logs.js";

const ENGINE_INFO = {
  codex: { title: "GPT", sub: "Uses your ChatGPT subscription." },
  antigravity: { title: "Gemini", sub: "Uses your Google account and Gemini plan." },
  "claude-code": { title: "Claude", sub: "Uses your Claude subscription." },
  api: { title: "Use with API key", sub: "Your own Gemini API or LiteLLM key, with MyLecture's built-in pipeline." },
};

export function engineLabel(s) {
  const base = ENGINE_INFO[s.engine]?.title || s.engine;
  const model = s.engine === "api" ? s.api?.model || s.api?.provider : s.models?.[s.engine];
  return model ? `${base} · ${model}` : base;
}

export class SettingsView {
  constructor(root, { state }) {
    this.root = root;
    this.state = state;
    this.statusCache = {};
    this.modelsCache = {};
    this.accountRevisions = { ...state.settings?.accountRevision };
    this.wrap = h("div", { class: "settings" });
    root.appendChild(this.wrap);
    window.ml.tts.onStatus((st) => this._ttsStatus(st));
    this.rendered = false;
  }

  async onShow() {
    this.state.settings = await window.ml.settings.get();
    if (!this.engines) this.engines = await window.ml.engines.list();
    this.voices = await window.ml.tts.voices();
    this.render();
    for (const e of this.engines.engines) this._checkEngine(e.id);
    this._ttsStatus(await window.ml.tts.status());
  }

  async save(patch) {
    this.state.settings = await window.ml.settings.set(patch);
    const full = await window.ml.settings.get();
    this.state.settings = full;
    bus.emit("settings-changed", full);
  }

  render() {
    this._syncAccountCaches();
    const s = this.state.settings;
    this.wrap.replaceChildren(
      h("h2", {}, "Settings"),
      h("div", { class: "muted" }, "MyLecture is free and open source. It runs on your computer and uses the AI engine you choose."),

      h("h3", {}, "AI engine"),
      this._connectCards(),
      this._engineDetails(),

      h("h3", {}, "Voice"),
      this._voiceCard(),

      h("h3", {}, "Lessons"),
      this._lessonCard(),

      h("h3", {}, "App"),
      this._appCard(),
    );
  }

  // GPT, Gemini and Claude: connect / use, exactly as on the welcome screen;
  // plus the API-key option.
  _connectCards() {
    this._connect?.stop();
    this._connect = connectPanel(this.state, { manageAccounts: true, onChange: () => this.render() });
    const s = this.state.settings;
    const api = h("div", { class: `engine-card ${s.engine === "api" ? "on" : ""}`, style: { marginTop: "10px" }, onclick: () => showApiKeyDialog(this.state, { onDone: () => this.render() }) },
      h("div", { class: "ec-head" }, h("span", { class: "grow" }, ENGINE_INFO.api.title), s.engine === "api" ? h("span", { class: "badge good" }, "In use") : null),
      h("div", { class: "ec-sub" }, ENGINE_INFO.api.sub));
    return h("div", {}, this._connect.el, api);
  }

  _engineCards() {
    const s = this.state.settings;
    this.engineStatusEls = {};
    return h(
      "div",
      { class: "engines" },
      this.engines.engines.map((e) => {
        const info = ENGINE_INFO[e.id] || { title: e.name, sub: "" };
        const st = h("span", { class: "badge" }, h("span", { class: "spin", style: { width: "10px", height: "10px" } }), "checking");
        this.engineStatusEls[e.id] = st;
        return h(
          "div",
          { class: `engine-card ${s.engine === e.id ? "on" : ""}`, onclick: async () => {
            await this.save({ engine: e.id });
            this.render();
            for (const x of this.engines.engines) this._paintStatus(x.id);
          } },
          h("div", { class: "ec-head" }, h("span", { class: "grow" }, info.title)),
          h("div", { class: "ec-sub" }, info.sub),
          h("div", { class: "row" }, st),
        );
      }),
    );
  }

  _syncAccountCaches() {
    const revisions = this.state.settings.accountRevision || {};
    for (const id of new Set([...Object.keys(this.accountRevisions || {}), ...Object.keys(revisions)])) {
      if ((this.accountRevisions?.[id] ?? 0) !== (revisions[id] ?? 0)) {
        delete this.statusCache[id];
        delete this.modelsCache[id];
      }
    }
    this.accountRevisions = { ...revisions };
  }

  async _checkEngine(id) {
    const revision = this.state.settings.accountRevision?.[id] ?? 0;
    const status = await window.ml.engines.status(id);
    if (revision !== (this.state.settings.accountRevision?.[id] ?? 0)) return;
    this.statusCache[id] = status;
    this._paintStatus(id);
  }

  _paintStatus(id) {
    const el = this.engineStatusEls?.[id];
    const st = this.statusCache[id];
    if (!el || !st) return;
    el.className = `badge ${st.ready ? "good" : st.installed ? "warn" : "bad"}`;
    el.replaceChildren(st.ready ? "Ready" : st.installed ? "Needs sign-in" : "Not installed");
    el.title = st.message || "";
    if (id === this.state.settings.engine && this.engineMsg) this.engineMsg.textContent = st.message + (st.version ? ` · ${st.version}` : "");
  }

  _engineDetails() {
    const s = this.state.settings;
    const id = s.engine;
    const e = this.engines.engines.find((x) => x.id === id);
    const card = h("div", { class: "card", style: { marginTop: "12px" } });
    this.engineMsg = null;
    if (!id || !e || (id !== "api" && !s.connected?.[id])) {
      const prompt = id && e && ENGINE_INFO[id] ? `Connect ${ENGINE_INFO[id].title} above to choose its model.` : "Connect GPT, Gemini or Claude, or use an API key, to choose a model.";
      card.append(h("p", { class: "small muted" }, prompt));
      return card;
    }
    this.engineMsg = h("span", { class: "small muted" }, "");
    const testOut = h("span", { class: "small muted" });
    const testBtn = h("button", { class: "btn sm", onclick: async () => {
      testBtn.disabled = true;
      testOut.replaceChildren(h("span", { class: "spin", style: { display: "inline-block", verticalAlign: "middle", marginRight: "6px" } }), "Testing…");
      try {
        const r = await window.ml.engines.test(id);
        testOut.textContent = r.ok ? `✓ Connected — first token in ${(r.firstTokenMs / 1000).toFixed(1)}s` : `Unexpected reply: ${r.text}`;
        testOut.style.color = r.ok ? "var(--good)" : "var(--warn)";
      } catch (err) {
        testOut.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        testOut.style.color = "var(--bad)";
      }
      testBtn.disabled = false;
    } }, icon("bolt"), "Test connection");

    if (id === "api") {
      const prov = s.api.provider;
      const P = this.engines.apiProviders;
      const keyInput = h("input", { class: "input", type: "password", placeholder: s.apiKeys?.[prov] ? "•••••••• (saved — type to replace)" : "Paste your API key" });
      const modelInput = h("input", { class: "input", value: s.api.model || "", placeholder: P[prov]?.defaultModel || "model name" });
      const baseInput = h("input", { class: "input", value: s.api.baseUrl || "", placeholder: prov === "compatible" ? "http://localhost:11434/v1" : "optional custom base URL" });
      card.append(
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Provider")), h("div", { class: "set-ctl" },
          h("select", { class: "select", onchange: async (ev) => {
            await this.save({ api: { provider: ev.target.value } });
            this.render();
          } }, Object.entries(P).map(([k, v]) => h("option", { value: k, selected: k === prov }, v.label))))),
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "API key"), h("span", {}, "Stored encrypted on this computer. ", P[prov]?.keyUrl ? h("a", { href: P[prov].keyUrl, target: "_blank" }, "Get a key") : "")),
          h("div", { class: "set-ctl" }, keyInput, h("button", { class: "btn sm", onclick: async () => {
            await window.ml.settings.setSecret(`api:${prov}`, keyInput.value.trim());
            keyInput.value = "";
            await this.save({});
            toast("API key saved", { kind: "good", timeout: 2000 });
            this.render();
            this._checkEngine("api");
          } }, "Save"))),
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Model"), h("span", {}, "Fast models give the most real-time experience.")), h("div", { class: "set-ctl" }, modelInput)),
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Base URL"), h("span", {}, "For OpenAI-compatible servers, proxies, or gateways.")), h("div", { class: "set-ctl" }, baseInput)),
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, testOut), h("div", { class: "set-ctl" }, h("button", { class: "btn sm", onclick: async () => {
          await this.save({ api: { model: modelInput.value.trim(), baseUrl: baseInput.value.trim() } });
          toast("Saved", { kind: "good", timeout: 1500 });
        } }, icon("save"), "Save"), testBtn)),
      );
    } else {
      const sel = h("select", { class: "select", onchange: (ev) => this.save({ models: { [id]: ev.target.value } }) }, h("option", { value: s.models?.[id] || "" }, s.models?.[id] || "Default model"));
      const loadModels = async () => {
        const revision = this.state.settings.accountRevision?.[id] ?? 0;
        const list = this.modelsCache[id] || await window.ml.engines.models(id);
        if (revision !== (this.state.settings.accountRevision?.[id] ?? 0)) return;
        this.modelsCache[id] = list;
        const cur = s.models?.[id] ?? "";
        sel.replaceChildren(h("option", { value: "" }, "Default model"), ...list.filter((m) => m.id).map((m) => h("option", { value: m.id, selected: m.id === cur }, m.label || m.id)));
        if (cur && !list.find((m) => m.id === cur)) sel.appendChild(h("option", { value: cur, selected: true }, cur));
      };
      loadModels().catch(error => { testOut.textContent = String(error.message || error); });
      card.append(
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Status"), this.engineMsg), h("div", { class: "set-ctl" }, h("button", { class: "btn sm ghost", onclick: () => this._checkEngine(id) }, icon("refresh"), "Re-check"))),
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Model"), h("span", {}, id === "antigravity" ? "Flash (Low) is the fastest and keeps lessons real-time. Bigger models look better but start slower." : "Smaller/faster models start playing sooner.")), h("div", { class: "set-ctl" }, sel)),
        id === "codex"
          ? h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Reasoning effort"), h("span", {}, "Low keeps latency down.")), h("div", { class: "set-ctl" },
              h("select", { class: "select", onchange: (ev) => this.save({ codexEffort: ev.target.value }) }, ["low", "medium", "high"].map((v) => h("option", { value: v, selected: s.codexEffort === v }, v)))))
          : null,
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Setup"), h("span", {}, e?.installHint || "")), h("div", { class: "set-ctl" }, testBtn)),
        h("div", { class: "set-row" }, h("div", { class: "set-label" }, testOut)),
      );
      this._paintStatus(id);
    }
    return card;
  }

  _voiceCard() {
    const s = this.state.settings;
    const voiceEngine = s.voiceEngine === "omnivoice" ? "omnivoice" : "kokoro";
    this.ttsBar = h("i");
    this.ttsMsg = h("span", {}, "");
    const voiceSel = h(
      "select",
      { class: "select", onchange: (e) => this.save({ voice: e.target.value }) },
      (this.voices?.kokoro || []).map(([id, label]) => h("option", { value: id, selected: s.voice === id }, label)),
    );
    const omniSel = h("select", { class: "select", "aria-label": "OmniVoice reference voice", onchange: e => this.save({ omnivoiceVoice: e.target.value }) },
      (this.voices?.omnivoice || []).map(([id, label]) => h("option", { value: id, selected: (s.omnivoiceVoice || "maruf") === id }, label)));
    const python = h("input", { class: "input", value: s.omnivoicePython || "", placeholder: "Auto-detect Python environment", "aria-label": "OmniVoice Python executable" });
    const speed = h("input", { type: "range", min: "0.7", max: "1.4", step: "0.05", value: String(s.voiceSpeed || 1), style: { width: "160px" } });
    const speedLbl = h("span", { class: "small muted", style: { width: "40px" } }, (s.voiceSpeed || 1).toFixed(2) + "×");
    speed.oninput = () => (speedLbl.textContent = Number(speed.value).toFixed(2) + "×");
    speed.onchange = () => this.save({ voiceSpeed: Number(speed.value) });
    const preview = h("button", { class: "btn sm", onclick: async () => {
      preview.disabled = true;
      try {
        const r = await window.ml.tts.preview("Hi! I'm your MyLecture tutor. Ask me anything, and I'll explain it with pictures.");
        const a = new Audio(r.url);
        a.play();
      } finally {
        preview.disabled = false;
      }
    } }, icon("volume"), "Preview");
    return h(
      "div",
      { class: "card" },
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Voice engine"), h("span", {}, "Kokoro and OmniVoice run locally. OmniVoice uses reference voices and supports GPU acceleration.")),
        h("div", { class: "set-ctl" }, h("div", { class: "seg" }, [["kokoro", "Kokoro", "Fast"], ["omnivoice", "OmniVoice", "Higher quality"]].map(([v, l, quality]) =>
          h("button", { class: voiceEngine === v ? "on" : "", onclick: async () => {
            await this.save({ voiceEngine: v });
            this.render();
            this._ttsStatus(await window.ml.tts.status());
          } }, l, " ", h("span", { class: "badge" }, quality), " ", h("span", { class: "badge" }, "Local")))))),
      voiceEngine === "kokoro"
        ? h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Neural voice"), this.ttsMsg, h("div", { class: "progress", style: { marginTop: "6px", width: "260px" } }, this.ttsBar)), h("div", { class: "set-ctl" }, voiceSel))
        : h("div", {},
              h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Reference voice"), this.ttsMsg, h("div", { class: "progress", style: { marginTop: "6px", width: "260px" } }, this.ttsBar)), h("div", { class: "set-ctl" }, omniSel)),
              h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "OmniVoice Python"), h("span", {}, "Python environment with omnivoice and PyTorch installed. Leave blank to use the existing local setup.")), h("div", { class: "set-ctl" }, python, h("button", { class: "btn sm", onclick: () => this.save({ omnivoicePython: python.value.trim() }) }, "Save")))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Speaking speed")), h("div", { class: "set-ctl" }, speed, speedLbl, preview)),
    );
  }

  _ttsStatus(st) {
    if (!this.ttsMsg || !st) return;
    const omni = this.state.settings.voiceEngine === "omnivoice";
    const k = (omni ? st.omnivoice : st.kokoro) || {};
    if (k.state === "error") {
      this.ttsMsg.replaceChildren(
        h("span", { style: { color: "var(--bad)", display: "block", marginBottom: "6px" } }, "Error: " + k.message),
        h("button", {
          class: "btn sm",
          onclick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = "Retrying...";
            await window.ml.tts.retry();
          },
        }, omni ? "Retry OmniVoice" : "Retry Download")
      );
      this.ttsBar.style.width = "0%";
      return;
    }
    const label = {
      idle: "Not loaded",
      loading: "Loading...",
      downloading: k.message,
      ready: omni ? k.message : "Ready - running locally on your CPU",
    }[k.state] || k.message;
    this.ttsMsg.textContent = label || "Not loaded";
    this.ttsBar.style.width = Math.round((k.state === "ready" ? 1 : k.progress || 0) * 100) + "%";
  }

  _lessonCard() {
    const s = this.state.settings;
    const seg = (key, opts) =>
      h("div", { class: "seg" }, opts.map(([v, l]) => h("button", { class: s[key] === v ? "on" : "", onclick: async (e) => {
        await this.save({ [key]: v });
        e.target.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
      } }, l)));
    const pick = (key, listName) => {
      const list = this.state.info?.styles?.[listName] || [];
      const hint = h("div", { class: "small muted", style: { marginTop: "4px" } });
      const sel = h("select", { class: "select", onchange: async () => {
        await this.save({ [key]: sel.value });
        hint.textContent = list.find((o) => o.id === sel.value)?.description || "";
      } }, list.map((o) => h("option", { value: o.id }, o.name)));
      sel.value = s[key] || list[0]?.id || "";
      hint.textContent = list.find((o) => o.id === sel.value)?.description || "";
      return h("div", {}, sel, hint);
    };
    const sw = (key) => {
      const i = h("input", { type: "checkbox", checked: s[key] !== false, onchange: (e) => this.save({ [key]: e.target.checked }) });
      return h("label", { class: "switch" }, i, h("span"));
    };
    const lang = h("input", { class: "input", value: s.language || "", placeholder: "Auto (same as your question)", onchange: (e) => this.save({ language: e.target.value.trim() }) });
    return h(
      "div",
      { class: "card" },
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Default length")), h("div", { class: "set-ctl" }, seg("length", [["quick", "1 min"], ["standard", "2 min"], ["deep", "5 min"]]))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Visual theme"), h("span", {}, "Colors, fonts, type scale and motion style of the lesson.")), h("div", { class: "set-ctl" }, pick("lgTheme", "themes"))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Teaching style"), h("span", {}, "How the tutor structures and narrates the lesson.")), h("div", { class: "set-ctl" }, pick("lgTeachingStyle", "teachingStyles"))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Language"), h("span", {}, "Narration and on-screen labels.")), h("div", { class: "set-ctl" }, lang)),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Captions"), h("span", {}, "Show narration subtitles on lessons.")), h("div", { class: "set-ctl" }, sw("captions"))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Autoplay"), h("span", {}, "Start playing as soon as the first scene is ready.")), h("div", { class: "set-ctl" }, sw("autoplay"))),
    );
  }

  _appCard() {
    const s = this.state.settings;
    return h(
      "div",
      { class: "card" },
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Appearance")), h("div", { class: "set-ctl" },
        h("div", { class: "seg" }, [["dark", "Dark"], ["light", "Light"]].map(([v, l]) => h("button", { class: s.uiTheme === v ? "on" : "", onclick: async () => {
          await this.save({ uiTheme: v });
          this.render();
        } }, l))))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Exported videos"), h("span", {}, this.state.info?.exportsDir || "")), h("div", { class: "set-ctl" }, h("button", { class: "btn sm", onclick: () => window.ml.shell.openExports() }, icon("folder"), "Open folder"))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "App data"), h("span", {}, this.state.info?.userData || "")), h("div", { class: "set-ctl" }, h("button", { class: "btn sm", onclick: () => window.ml.shell.openPath(this.state.info.userData) }, icon("folder"), "Open"))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "Diagnostics"), h("span", {}, "Live local logs for app activity and errors. Credentials and private content are redacted.")), h("div", { class: "set-ctl" },
        h("button", { class: "btn sm", onclick: () => showLiveLog() }, "View live log"),
        h("button", { class: "btn sm", onclick: async () => {
          try { await window.ml.logs.openFolder(); }
          catch { toast("Could not open the logs folder.", { kind: "bad" }); }
        } }, icon("folder"), "Open logs folder"))),
      h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, "About"), h("span", {}, `MyLecture ${this.state.info?.version || ""} · MIT licensed · open source`)), h("div", { class: "set-ctl" })),
    );
  }
}
