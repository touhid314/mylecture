// Install progress popup for every optional component: Claude, GPT (Codex),
// Gemini (Antigravity), the Kokoro voice and OmniVoice. The install runs in
// the main process (electron/components.js); closing the popup does not stop
// it, and opening it again shows the live progress.
import { h, modal, toast } from "./ui.js";

const friendly = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const ABOUT = {
  "claude-code": { intro: "Installing Claude Code with Anthropic's official installer.", time: "1 to 3 minutes" },
  codex: { intro: "Installing Codex with OpenAI's official package.", time: "2 to 5 minutes" },
  antigravity: { intro: "Installing the Antigravity CLI with Google's official installer.", time: "1 to 3 minutes" },
  hermes: { title: "Getting ready", intro: "Downloading the necessary things to make videos with your API key.", time: "1 to 3 minutes", done: "All set.", quiet: true },
  kokoro: { intro: "Downloading the Kokoro voice model. It runs on your computer.", time: "1 to 4 minutes" },
  omnivoice: {
    intro: "OmniVoice is a high-quality, expressive voice that runs on your computer. It uses your NVIDIA graphics card if you have one; otherwise it runs slower on the processor.",
    time: "5 to 20 minutes",
    confirm: true,
  },
};

const elapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export async function componentInstalled(id) {
  try {
    return !!(await window.ml.components.status()).find((c) => c.id === id)?.installed;
  } catch { return false; }
}

// Opens the popup for component `id`. Starts the install right away unless the
// component asks for confirmation first (OmniVoice, a 6 GB download) or is
// already installing. Resolves when the popup closes.
export async function showInstaller(id, { onDone } = {}) {
  const list = await window.ml.components.status().catch(() => []);
  const info = list.find((c) => c.id === id) || { id, title: id };
  const about = ABOUT[id] || { intro: "", time: "a few minutes" };

  const step = h("div", { class: "install-step" });
  const fill = h("div", { class: "omni-dl-fill" });
  const bar = h("div", { class: "omni-dl-bar" }, fill);
  const meta = h("div", { class: "install-meta small muted" });
  const log = h("pre", { class: "install-log", hidden: true });
  const body = h("div", { class: "install-dlg" },
    about.intro ? h("p", { style: { marginTop: 0 } }, about.intro) : null,
    h("p", { class: "small muted", style: { margin: "0 0 12px" } }, `Download: ${info.size || "a few hundred MB"}. This usually takes ${about.time}. You can close this window; the installation continues.`),
    bar, step, meta, log);

  let state = null, startedAt = 0, lines = [], tick = 0, done = false, go = null;
  const render = () => {
    const p = state;
    if (!p) { bar.hidden = true; step.textContent = ""; meta.textContent = ""; return; }
    const busy = p.state === "installing";
    bar.hidden = !(busy || p.state === "done");
    bar.classList.toggle("busy", busy && p.percent == null);
    fill.style.width = p.state === "done" ? "100%" : p.percent != null ? `${p.percent}%` : "";
    step.style.color = p.state === "error" ? "var(--bad)" : "";
    step.textContent = p.state === "done" ? about.done || `${info.title} is installed.` : p.message || "";
    const pctText = p.percent != null && !String(p.message || "").includes(`${p.percent}%`) ? `${p.percent}% · ` : "";
    meta.textContent = busy && startedAt ? `${pctText}${elapsed(Date.now() - startedAt)} elapsed` : "";
    log.hidden = about.quiet || !busy || !lines.length;
    log.textContent = lines.join("\n");
    if (go) {
      go.style.display = p.state === "done" || (busy && !about.confirm) ? "none" : "";
      go.disabled = busy;
      go.textContent = busy ? "Installing…" : p.state === "error" ? "Try again" : about.confirm ? "Download" : "Install";
    }
  };
  const apply = (p) => {
    if (!p) return;
    if (p.state === "installing" && state?.state !== "installing") lines = [];
    if (p.startedAt) startedAt = p.startedAt;
    if (p.detail && p.detail !== lines.at(-1)) { lines.push(p.detail); lines = lines.slice(-6); }
    state = { ...state, ...p };
    render();
    if (p.state === "done" && !done) { done = true; onDone?.(); }
  };

  const unsubscribe = window.ml.components.onProgress((p) => { if (p.id === id) apply(p); });
  const start = async () => {
    startedAt = Date.now();
    apply({ state: "installing", message: "Starting…", percent: null });
    try {
      await window.ml.components.install(id);
    } catch (e) {
      apply({ state: "error", message: friendly(e) });
      toast(`${about.title || info.title}: ${friendly(e)}`, { kind: "bad", timeout: 9000 });
    }
  };

  return new Promise((resolve) => {
    const { el } = modal({
      title: about.title || `Install ${info.title}`,
      width: "500px",
      body,
      actions: [{ label: "Close" }, { label: about.confirm ? "Download" : "Install", primary: true, run: () => { void start(); return false; } }],
      onClose: () => { unsubscribe?.(); clearInterval(tick); resolve(done); },
    });
    go = el.querySelector(".modal-foot .btn.primary");
    tick = setInterval(render, 1000);
    if (info.installed) apply({ state: "done" });
    else if (info.progress?.state === "installing") apply(info.progress);
    else if (info.progress?.state === "error") apply(info.progress);
    else if (!about.confirm) void start();
    render();
  });
}
