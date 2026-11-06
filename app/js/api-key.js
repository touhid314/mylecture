// "Use with API key": pick a provider, enter the key, check it really works
// (model list + one short generation), choose the model, save and use.
// API keys run MyLecture's fixed generation pipeline.
import { h, modal, toast, bus } from "./ui.js";
import { showInstaller, componentInstalled } from "./install-dialog.js";

const friendly = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export async function showApiKeyDialog(state, { onDone } = {}) {
  const { apiProviders: P } = await window.ml.engines.list();
  const s = state.settings;
  const ids = Object.keys(P);
  let provider = s.engine === "api" && P[s.api?.provider] ? s.api.provider : ids[0];
  let verified = null; // { provider, models, model }

  const providerPick = h("div", { class: "apikey-providers", role: "radiogroup", "aria-label": "API provider" });
  const keyInput = h("input", { class: "input", type: "password", autocomplete: "off", spellcheck: false, "aria-label": "API key" });
  const keyLink = h("a", { class: "small", href: "#", onclick: (e) => (e.preventDefault(), P[provider].keyUrl && window.open(P[provider].keyUrl, "_blank")) }, "Get a key");
  const baseInput = h("input", { class: "input", placeholder: "https://your-litellm-server", spellcheck: false, "aria-label": "LiteLLM server address" });
  const baseRow = h("label", { class: "apikey-field" }, h("span", {}, "Server address"), baseInput);
  const modelSelect = h("select", { class: "select", disabled: true, "aria-label": "Model" }, h("option", {}, "Check the key to load models"));
  const result = h("div", { class: "apikey-result small" });
  const checkBtn = h("button", { class: "btn", onclick: () => check() }, "Check");

  const paintProvider = () => {
    providerPick.replaceChildren(
      ...ids.map((id) =>
        h("button", { class: `apikey-provider${id === provider ? " on" : ""}`, role: "radio", "aria-checked": String(id === provider), onclick: () => { provider = id; reset(); } },
          h("b", {}, P[id].label), h("span", {}, P[id].hint || "")),
      ),
    );
    const saved = s.apiKeys?.[provider];
    keyInput.placeholder = saved ? "Saved key (leave blank to keep it)" : "Paste your API key";
    keyLink.hidden = !P[provider].keyUrl;
    baseRow.hidden = !P[provider].needsBaseUrl;
    baseInput.value = provider === s.api?.provider ? s.api?.baseUrl || "" : "";
  };
  const reset = () => {
    verified = null;
    keyInput.value = "";
    modelSelect.replaceChildren(h("option", {}, "Check the key to load models"));
    modelSelect.disabled = true;
    result.textContent = "";
    result.className = "apikey-result small";
    paintProvider();
    syncSave();
  };

  async function check() {
    checkBtn.disabled = true;
    result.className = "apikey-result small";
    result.replaceChildren(h("span", { class: "spin", style: { display: "inline-block", verticalAlign: "middle", marginRight: "6px" } }), "Checking the key with a short request…");
    try {
      const r = await window.ml.api.verify({ provider, apiKey: keyInput.value.trim(), baseUrl: baseInput.value.trim() });
      verified = { provider, ...r };
      modelSelect.replaceChildren(...r.models.map((m) => h("option", { value: m.id }, m.label || m.id)));
      modelSelect.value = provider === s.api?.provider && r.models.some((m) => m.id === s.api?.model) ? s.api.model : r.model;
      modelSelect.disabled = false;
      result.className = "apikey-result small good";
      result.textContent = `Works. ${r.models.length} models available; ${r.model} answered.`;
    } catch (e) {
      verified = null;
      result.className = "apikey-result small bad";
      result.textContent = friendly(e);
    } finally {
      checkBtn.disabled = false;
      syncSave();
    }
  }

  const body = h(
    "div",
    { class: "apikey" },
    h("p", { class: "small muted", style: { margin: "0 0 12px" } }, "Use your own API key instead of a subscription. Videos are made by Hermes Agent, an open-source AI agent that runs on your computer."),
    providerPick,
    h("label", { class: "apikey-field" }, h("span", {}, "API key ", keyLink), keyInput),
    baseRow,
    h("div", { class: "apikey-check" }, checkBtn, result),
    h("label", { class: "apikey-field" }, h("span", {}, "Model"), modelSelect),
  );
  let saveBtn;
  const syncSave = () => saveBtn && (saveBtn.disabled = !verified || verified.provider !== provider);
  const dlg = modal({
    title: "Use with API key",
    body,
    width: "560px",
    actions: [
      { label: "Cancel" },
      {
        label: "Save and use",
        primary: true,
        run: async () => {
          if (!verified) return false;
          try {
            if (keyInput.value.trim()) await window.ml.settings.setSecret(`api:${provider}`, keyInput.value.trim());
            await window.ml.settings.set({ engine: "api", api: { provider, model: modelSelect.value, baseUrl: P[provider].needsBaseUrl ? baseInput.value.trim() : "" } });
            state.settings = await window.ml.settings.get();
            bus.emit("settings-changed", state.settings);
            toast(`Using ${P[provider].label} with your API key.`);
            onDone?.();
            // Videos made with an API key run in Hermes Agent: offer to install it.
            if (!(await componentInstalled("hermes"))) void showInstaller("hermes");
          } catch (e) {
            toast(friendly(e), { kind: "bad" });
            return false;
          }
        },
      },
    ],
  });
  saveBtn = [...dlg.el.querySelectorAll(".modal-foot .btn")].find((b) => b.textContent === "Save and use");
  keyInput.addEventListener("input", () => { verified = null; syncSave(); });
  baseInput.addEventListener("input", () => { verified = null; syncSave(); });
  keyInput.addEventListener("keydown", (e) => e.key === "Enter" && check());
  paintProvider();
  syncSave();
  return dlg;
}
