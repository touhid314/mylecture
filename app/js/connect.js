// "Connect your AI": GPT, Gemini and Claude subscriptions.
// A service counts as connected only once the user connects it in MyLecture
// (settings.connected) and its sign-in is valid. Tools that happen to be
// signed in on the computer are not connected until the user chooses so.
// Used by the first-run welcome and by Create while nothing is connected.
import { h, toast, bus, confirmBox } from "./ui.js";
import { showInstaller } from "./install-dialog.js";
import { showApiKeyDialog } from "./api-key.js";

export const SERVICE_ORDER = ["codex", "antigravity", "claude-code"];
let servicesCache = null;
const accountOperations = new Set();

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

// Engine installs in progress (id -> latest message), shared by every panel.
// Progress text updates in place without re-checking every engine.
const installs = new Map();
globalThis.window?.ml?.components?.onProgress((p) => {
  if (!installs.has(p.id)) return;
  installs.set(p.id, p.message || "Installing…");
  for (const el of document.querySelectorAll(`[data-install-progress="${p.id}"]`)) el.textContent = installs.get(p.id);
});

const friendly = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

// Returns { el, refresh, stop }. Polls status while mounted.
export function connectPanel(state, { compact = false, manageAccounts = false, onChange } = {}) {
  const el = h("div", { class: "connect" + (compact ? " compact" : "") });
  const cards = {};
  const pending = new Set(); // services the user asked to connect; done once signed in
  const revisions = new Map();
  let timer = null;
  let busy = false;
  let alive = true;

  const connect = async (id) => {
    if (!alive || state.settings.accountSwitch?.[id] || (revisions.has(id) && revisions.get(id) !== (state.settings.accountRevision?.[id] ?? 0))) return;
    const revision = state.settings.accountRevision?.[id] ?? 0;
    const settings = await window.ml.connect.run(id, "connect-account", { revision });
    state.settings = settings;
    bus.emit("settings-changed", settings);
    pending.delete(id);
    onChange?.(id);
  };
  const accountAction = async (id, action, options) => {
    if (accountOperations.has(id)) return;
    accountOperations.add(id);
    try {
    pending.delete(id);
    revisions.delete(id);
    const settings = await window.ml.connect.run(id, action, options);
    state.settings = settings;
    bus.emit("settings-changed", settings);
    onChange?.(id);
    if (alive) refresh();
    } finally { accountOperations.delete(id); }
  };

  const paint = (svc, id, st) => {
    const c = cards[id];
    const connected = isConnected(state.settings, id, st);
    const selected = connected && state.settings.engine === id;
    const switching = !!state.settings.accountSwitch?.[id];
    const waiting = pending.has(id) || switching;
    const chip = st == null ? ["checking", "Checking…"] : connected ? ["good", "Connected"] : switching && st.ready ? ["good", "Sign-in ready"] : waiting ? ["warn", "Waiting for sign-in…"] : ["muted", "Not connected"];
    c.chip.className = `connect-chip ${chip[0]}`;
    c.chip.textContent = chip[1];
    const acct = st?.ready && st.account?.email ? [st.account.email, st.account.plan].filter(Boolean).join(" · ") : "";
    c.account.textContent = acct ? `${connected ? "Signed in as" : "Signed in on this computer as"} ${acct}` : st && st.installed && !st.ready && st.message && st.message !== "Not signed in" ? st.message : "";
    c.account.hidden = !c.account.textContent;
    c.el.classList.toggle("ready", connected);
    c.el.classList.toggle("selected", selected);
    const buttons = [];
    const button = (label, run, primary = true) => h("button", { class: `btn sm${primary ? " primary" : ""}`, disabled: accountOperations.has(id), onclick: () => run().catch((e) => toast(friendly(e), { kind: "bad", timeout: 9000 })) }, label);
    if (!st) {
      // still checking
    } else if (switching) {
      buttons.push(button("Use this account", async () => {
        const revision = state.settings.accountRevision?.[id];
        const live = await window.ml.engines.status(id, { fresh: true });
        if (!alive || revision !== state.settings.accountRevision?.[id]) return;
        if (!live.ready) return toast("Finish signing in in the provider window, then try again.", { kind: "bad" });
        const email = live.account?.email || "";
        if (alive) await accountAction(id, "complete-account", { revision, email });
      }));
      buttons.push(button("Cancel", async () => accountAction(id, "remove-account"), false));
    } else if (connected) {
      buttons.push(selected ? h("span", { class: "connect-using" }, "✓ In use") : button(`Use ${svc.title}`, async () => {
        await saveSettings(state, { engine: id });
        refresh();
        onChange?.(id);
      }));
    } else if (!st.installed) {
      if (installs.has(id)) buttons.push(h("span", { class: "connect-account", "data-install-progress": id }, installs.get(id)), button("Show progress", () => showInstaller(id)));
      else buttons.push(button("Set up", async () => {
        installs.set(id, "Starting…");
        paint(svc, id, st);
        try {
          const install = window.ml.components.install(id);
          void showInstaller(id);
          await install;
        } finally {
          installs.delete(id);
          if (alive) refresh();
        }
        toast(`${svc.title} is installed. Click Connect to sign in.`, { timeout: 8000 });
      }));
    } else {
      buttons.push(button(waiting ? "Open sign-in again" : "Connect", async () => {
        const revision = state.settings.accountRevision?.[id] ?? 0;
        const live = await window.ml.engines.status(id, { fresh: true }).catch(() => st);
        if (!alive || revision !== (state.settings.accountRevision?.[id] ?? 0)) return;
        if (live.ready && !waiting) {
          // Already signed in on this computer: connect right away.
          await connect(id);
          toast(`${svc.title} connected.`);
          return refresh();
        }
        await window.ml.connect.run(id, "login");
        if (!alive || revision !== (state.settings.accountRevision?.[id] ?? 0)) return;
        pending.add(id);
        revisions.set(id, revision);
        toast(`Sign in to ${svc.title} in the window that opened. MyLecture connects it as soon as you're signed in.`, { timeout: 8000 });
        refresh();
      }));
    }
    if (manageAccounts && st?.installed && !switching) {
      buttons.push(button("Add new account", async () => {
        if (!await confirmBox(`Add a ${svc.title} account`, `This replaces the ${svc.title} account used by its command-line tool, including outside MyLecture. Only one account per provider can be active. Continue to sign in with another account?${id === "antigravity" ? " In the Gemini window, enter /logout, then sign in with the other Google account." : ""}`, "Continue")) return;
        if (alive) await accountAction(id, "switch-account");
      }, false));
    }
    if (manageAccounts && !switching && (state.settings.connected?.[id] || pending.has(id))) buttons.push(button("Remove account", async () => {
      await accountAction(id, "remove-account");
      toast(`${svc.title} removed from MyLecture. Its command-line sign-in is unchanged.`);
    }, false));
    if (st && !connected) buttons.push(h("button", { class: "btn sm ghost", onclick: () => window.ml.connect.run(id, "signup") }, "Get a subscription"));
    c.actions.replaceChildren(...buttons);
  };

  const refresh = async () => {
    if (busy || !alive) return;
    busy = true;
    try {
      const list = await services();
      const all = await Promise.all(SERVICE_ORDER.map((id) => window.ml.engines.status(id, { fresh: pending.has(id) || !!state.settings.accountSwitch?.[id] }).catch(() => ({ installed: false, ready: false }))));
      if (!alive) return;
      const byId = Object.fromEntries(SERVICE_ORDER.map((id, i) => [id, all[i]]));
      // The replacement identity is now signed in: finish without another
      // confirmation. Never accept the old account while its login is pending.
      for (const id of SERVICE_ORDER) {
        const previous = state.settings.accountSwitchFrom?.[id];
        const email = byId[id].account?.email;
        if (alive && state.settings.accountSwitch?.[id] && byId[id].ready && previous && email && previous.toLowerCase() !== email.toLowerCase()) {
          await accountAction(id, "complete-account", { revision: state.settings.accountRevision?.[id], email, automatic: true });
        }
      }
      if (!alive) return;
      // Finish connections the user started once their sign-in is valid.
      for (const id of [...pending]) if (alive && byId[id].ready && !state.settings.accountSwitch?.[id]) await connect(id);
      if (!alive) return;
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
    if (!alive) return;
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
  const apiLink = h("button", { class: "btn ghost", onclick: () => showApiKeyDialog(state, { onDone: () => finish() }) }, "Use an API key instead");
  const overlay = h(
    "div",
    { class: "welcome-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Welcome to MyLecture" },
    h(
      "div",
      { class: "welcome-box" },
      h("img", { class: "welcome-logo", src: "assets/icon.png", alt: "" }),
      h("h1", {}, "Welcome to MyLecture"),
      h("p", { class: "welcome-lead" }, "Make any video, from lessons and explainers to stories, with the AI subscription you already have."),
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
