// "Connect your AI": ChatGPT, Google Gemini and Claude subscriptions, each
// with live status and the one next step (install, sign in, use it).
// Used by the first-run welcome and by Create when nothing is connected.
import { h, toast, bus } from "./ui.js";

const ORDER = ["codex", "antigravity", "claude-code"];
let servicesCache = null;

async function services() {
  return (servicesCache ||= await window.ml.connect.services());
}

export async function anyConnected() {
  const st = await Promise.all(ORDER.map((id) => window.ml.engines.status(id).catch(() => ({}))));
  return st.some((s) => s.ready);
}

async function useEngine(state, id) {
  const s = await window.ml.settings.set({ engine: id });
  state.settings = s;
  bus.emit("settings-changed", s);
  return s;
}

// Returns { el, refresh, stop }. Polls status while mounted.
export function connectPanel(state, { compact = false, onChange } = {}) {
  const el = h("div", { class: "connect" + (compact ? " compact" : "") });
  const cards = {};
  let timer = null;
  let busy = false;
  let alive = true;

  const paint = (svc, id, st) => {
    const c = cards[id];
    const selected = state.settings.engine === id;
    const chip = st == null ? ["checking", "Checking…"] : st.ready ? ["good", "Connected"] : st.installed ? ["warn", "Not signed in"] : ["muted", "Not installed"];
    c.chip.className = `connect-chip ${chip[0]}`;
    c.chip.textContent = chip[1];
    c.el.classList.toggle("ready", !!st?.ready);
    c.el.classList.toggle("selected", selected && !!st?.ready);
    const act = (label, action, primary = true) =>
      h("button", { class: `btn sm${primary ? " primary" : ""}`, onclick: async () => {
        try {
          await window.ml.connect.run(id, action);
          if (action !== "signup") toast(action === "install" ? `Follow the setup, then come back. MyLecture notices when ${svc.title} is ready.` : `Sign in in the window that opened. MyLecture notices when you're connected.`, { timeout: 7000 });
        } catch (e) {
          toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), { kind: "bad", timeout: 9000 });
        }
      } }, label);
    const buttons = [];
    if (!st) buttons.push();
    else if (st.ready) {
      buttons.push(
        selected
          ? h("span", { class: "connect-using" }, "✓ In use")
          : h("button", { class: "btn sm primary", onclick: async () => {
              await useEngine(state, id);
              refresh();
              onChange?.(id);
            } }, `Use ${svc.title}`),
      );
    } else if (st.installed) buttons.push(act("Sign in", "login"));
    else buttons.push(act("Set up", "install"));
    if (st && !st.ready) buttons.push(h("button", { class: "btn sm ghost", onclick: () => window.ml.connect.run(id, "signup") }, "Get a subscription"));
    c.actions.replaceChildren(...buttons);
  };

  const refresh = async () => {
    if (busy || !alive) return;
    busy = true;
    try {
      const list = await services();
      const all = await Promise.all(ORDER.map((id) => window.ml.engines.status(id).catch(() => ({ installed: false, ready: false }))));
      const byId = Object.fromEntries(ORDER.map((id, i) => [id, all[i]]));
      // The selected engine isn't connected but another one is: use that one.
      const current = state.settings.engine;
      if (current !== "api" && !byId[current]?.ready) {
        const ready = ORDER.find((id) => byId[id].ready);
        if (ready) {
          await useEngine(state, ready);
          onChange?.(ready);
        }
      }
      if (alive) for (const id of ORDER) paint(list[id], id, byId[id]);
    } finally {
      busy = false;
    }
  };

  services().then((list) => {
    for (const id of ORDER) {
      const svc = list[id];
      const chip = h("span", { class: "connect-chip checking" }, "Checking…");
      const actions = h("div", { class: "connect-actions" });
      const card = h(
        "div",
        { class: "connect-card" },
        h("div", { class: "connect-head" }, h("b", {}, svc.title), chip),
        compact ? null : h("div", { class: "connect-sub" }, `Uses your ${svc.plan}.`),
        actions,
      );
      cards[id] = { el: card, chip, actions };
      el.append(card);
    }
    refresh();
    timer = setInterval(() => document.visibilityState === "visible" && el.isConnected && refresh(), 4000);
  });
  window.addEventListener("focus", refresh);
  const stop = () => {
    alive = false;
    clearInterval(timer);
    window.removeEventListener("focus", refresh);
  };
  return { el, refresh, stop };
}

// First run: a full-screen welcome that connects an account before anything else.
export function showWelcome(state, { onDone } = {}) {
  const panel = connectPanel(state, { onChange: () => update() });
  const start = h("button", { class: "btn primary welcome-start", disabled: true, onclick: () => finish() }, "Start creating");
  const later = h("button", { class: "btn ghost", onclick: () => finish() }, "Skip for now");
  const apiLink = h("button", { class: "btn ghost", onclick: () => finish("settings") }, "Use an API key instead");
  const overlay = h(
    "div",
    { class: "welcome-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Welcome to MyLecture" },
    h(
      "div",
      { class: "welcome-box" },
      h("img", { class: "welcome-logo", src: "assets/icon.png", alt: "" }),
      h("h1", {}, "Welcome to MyLecture"),
      h("p", { class: "welcome-lead" }, "Make any video, from lessons and explainers to product demos and stories, with the AI subscription you already have."),
      h("h3", {}, "Connect your AI"),
      panel.el,
      h("p", { class: "small muted" }, "You sign in with your provider in a window MyLecture opens for you. Your password never passes through MyLecture."),
      h("div", { class: "welcome-foot" }, apiLink, h("div", { class: "grow" }), later, start),
    ),
  );
  document.body.append(overlay);

  async function update() {
    const st = await window.ml.engines.status(state.settings.engine).catch(() => ({}));
    start.disabled = !st.ready;
  }
  const poll = setInterval(update, 4000);
  update();

  async function finish(goto) {
    clearInterval(poll);
    panel.stop();
    const s = await window.ml.settings.set({ onboarded: true });
    state.settings = s;
    bus.emit("settings-changed", s);
    overlay.remove();
    onDone?.(goto);
  }
}
