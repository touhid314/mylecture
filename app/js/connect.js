// "Connect your AI": GPT, Gemini and Claude subscriptions.
// A service counts as connected only once the user connects it in MyLecture
// (settings.connected) and its sign-in is valid. Tools that happen to be
// signed in on the computer are not connected until the user chooses so.
// Used by the first-run welcome and by Create while nothing is connected.
import { h, toast, bus } from "./ui.js";

export const SERVICE_ORDER = ["codex", "antigravity", "claude-code"];
let servicesCache = null;

async function services() {
  return (servicesCache ||= await window.ml.connect.services());
}

async function saveSettings(state, patch) {
  const s = await window.ml.settings.set(patch);
  state.settings = s;
  bus.emit("settings-changed", s);
  return s;
}

export const isConnected = (settings, id, status) => !!settings.connected?.[id] && !!status?.ready;

export async function anyConnected(state) {
  const st = await Promise.all(SERVICE_ORDER.map((id) => window.ml.engines.status(id).catch(() => ({}))));
  return SERVICE_ORDER.some((id, i) => isConnected(state.settings, id, st[i]));
}

const friendly = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

// Returns { el, refresh, stop }. Polls status while mounted.
export function connectPanel(state, { compact = false, onChange } = {}) {
  const el = h("div", { class: "connect" + (compact ? " compact" : "") });
  const cards = {};
  const pending = new Set(); // services the user asked to connect; done once signed in
  let timer = null;
  let busy = false;
  let alive = true;

  const connect = async (id) => {
    await saveSettings(state, { connected: { ...(state.settings.connected || {}), [id]: true }, engine: id });
    pending.delete(id);
    onChange?.(id);
  };

  const paint = (svc, id, st) => {
    const c = cards[id];
    const connected = isConnected(state.settings, id, st);
    const selected = connected && state.settings.engine === id;
    const waiting = pending.has(id);
    const chip = st == null ? ["checking", "Checking…"] : connected ? ["good", "Connected"] : waiting ? ["warn", "Waiting for sign-in…"] : ["muted", "Not connected"];
    c.chip.className = `connect-chip ${chip[0]}`;
    c.chip.textContent = chip[1];
    const acct = st?.ready && st.account?.email ? [st.account.email, st.account.plan].filter(Boolean).join(" · ") : "";
    c.account.textContent = acct ? `${connected ? "Signed in as" : "Signed in on this computer as"} ${acct}` : st && st.installed && !st.ready && st.message && st.message !== "Not signed in" ? st.message : "";
    c.account.hidden = !c.account.textContent;
    c.el.classList.toggle("ready", connected);
    c.el.classList.toggle("selected", selected);
    const buttons = [];
    const button = (label, run, primary = true) => h("button", { class: `btn sm${primary ? " primary" : ""}`, onclick: () => run().catch((e) => toast(friendly(e), { kind: "bad", timeout: 9000 })) }, label);
    if (!st) {
      // still checking
    } else if (connected) {
      buttons.push(selected ? h("span", { class: "connect-using" }, "✓ In use") : button(`Use ${svc.title}`, async () => {
        await saveSettings(state, { engine: id });
        refresh();
        onChange?.(id);
      }));
    } else if (!st.installed) {
      buttons.push(button("Set up", async () => {
        await window.ml.connect.run(id, "install");
        pending.add(id);
        toast(`Follow the setup, then sign in. MyLecture connects ${svc.title} as soon as it's ready.`, { timeout: 8000 });
        refresh();
      }));
    } else {
      buttons.push(button(waiting ? "Open sign-in again" : "Connect", async () => {
        const live = await window.ml.engines.status(id, { fresh: true }).catch(() => st);
        if (live.ready && !waiting) {
          // Already signed in on this computer: connect right away.
          await connect(id);
          toast(`${svc.title} connected.`);
          return refresh();
        }
        await window.ml.connect.run(id, "login");
        pending.add(id);
        toast(`Sign in to ${svc.title} in the window that opened. MyLecture connects it as soon as you're signed in.`, { timeout: 8000 });
        refresh();
      }));
    }
    if (st && !connected) buttons.push(h("button", { class: "btn sm ghost", onclick: () => window.ml.connect.run(id, "signup") }, "Get a subscription"));
    c.actions.replaceChildren(...buttons);
  };

  const refresh = async () => {
    if (busy || !alive) return;
    busy = true;
    try {
      const list = await services();
      const all = await Promise.all(SERVICE_ORDER.map((id) => window.ml.engines.status(id, { fresh: pending.has(id) }).catch(() => ({ installed: false, ready: false }))));
      const byId = Object.fromEntries(SERVICE_ORDER.map((id, i) => [id, all[i]]));
      // Finish connections the user started once their sign-in is valid.
      for (const id of [...pending]) if (byId[id].ready) await connect(id);
      // The chosen service stopped working but another connected one works: use that.
      const current = state.settings.engine;
      if (current && current !== "api" && !isConnected(state.settings, current, byId[current])) {
        const other = SERVICE_ORDER.find((id) => isConnected(state.settings, id, byId[id]));
        if (other) {
          await saveSettings(state, { engine: other });
          onChange?.(other);
        }
      }
      if (alive) for (const id of SERVICE_ORDER) paint(list[id], id, byId[id]);
    } finally {
      busy = false;
    }
  };

  services().then((list) => {
    for (const id of SERVICE_ORDER) {
      const svc = list[id];
      const chip = h("span", { class: "connect-chip checking" }, "Checking…");
      const actions = h("div", { class: "connect-actions" });
      const account = h("div", { class: "connect-account", hidden: true });
      const card = h(
        "div",
        { class: "connect-card" },
        h("div", { class: "connect-head" }, h("b", {}, svc.title), chip),
        compact ? null : h("div", { class: "connect-sub" }, `Uses your ${svc.plan}.`),
        account,
        actions,
      );
      cards[id] = { el: card, chip, actions, account };
      el.append(card);
    }
    refresh();
    timer = setInterval(() => document.visibilityState === "visible" && el.isConnected && refresh(), 3000);
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
    const engine = state.settings.engine;
    const st = engine ? await window.ml.engines.status(engine).catch(() => ({})) : {};
    start.disabled = !isConnected(state.settings, engine, st);
    start.title = start.disabled ? "Connect GPT, Gemini or Claude first" : "";
  }
  const poll = setInterval(update, 3000);
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
