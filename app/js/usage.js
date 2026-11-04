import { h, icon, bus } from "./ui.js";

const subscriptionProviders = new Set(["antigravity", "codex", "claude-code"]);
const usageKey = settings => {
  const id = settings.engine;
  return JSON.stringify([id, settings.models?.[id] || "", settings.accountRevision?.[id] || 0,
    settings.connected?.[id]]);
};

export class UsagePanel {
  constructor({ state, compact = false }) {
    this.state = state;
    this.compact = compact;
    this.summary = h("summary", { class: "small", "aria-live": "polite", title: "Usage remaining. Click for reset times and all model groups." }, "Usage: checking...");
    this.refreshButton = h("button", { class: "btn sm", onclick: () => this.refresh() }, icon("refresh"), "Refresh");
    this.body = h("div", { class: "usage-body" });
    this.details = h("details", { class: "usage-details" + (compact ? " usage-compact" : "") },
      this.summary,
      h("div", { class: "usage-popover" }, h("div", { class: "row" }, h("b", { class: "grow" }, "Account usage remaining"), this.refreshButton,
        h("button", { class: "btn ghost sm icon", title: "Close", "aria-label": "Close usage details", onclick: () => { this.details.open = false; } }, icon("x"))), this.body));
    this.root = this.details;
    this.root.addEventListener("click", (e) => e.stopPropagation());
    this.details.addEventListener("toggle", () => { if (this.details.open) this.refresh(); });
    document.addEventListener("mousedown", (e) => { if (this.details.open && !this.details.contains(e.target)) this.details.open = false; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.details.open = false; });
    bus.on("settings-changed", () => this.refresh());
    window.ml.gen.onEvent((e) => { if (["done", "error", "cancelled"].includes(e.type)) this.refresh(); });
    window.addEventListener("focus", () => this.refresh());
    setInterval(() => { if (!document.hidden) this.refresh(); }, 60000);
    this.refresh();
  }

  async refresh() {
    const id = this.state.settings.engine;
    const model = this.state.settings.models?.[id] || "";
    const key = usageKey(this.state.settings);
    const unavailable = !id || (subscriptionProviders.has(id) && this.state.settings.connected?.[id] === false);
    if (unavailable) {
      this.request = (this.request || 0) + 1;
      this.pendingKey = null;
      this.loadedKey = null;
      this.refreshButton.disabled = false;
      const message = id ? "Connect this account to see its limits." : "Select a provider to see account limits.";
      this.summary.textContent = this.compact ? "Limits —" : "Usage unavailable";
      this.summary.title = message;
      this.summary.removeAttribute("aria-label");
      this.body.replaceChildren(h("p", { class: "muted" }, message));
      return;
    }
    if (this.pendingKey === key) return;
    const request = this.request = (this.request || 0) + 1;
    this.pendingKey = key;
    this.refreshButton.disabled = true;
    this.loadedKey = null;
    this.summary.textContent = this.compact ? "Limits …" : "Usage: checking...";
    this.summary.title = "Checking account limits...";
    this.summary.removeAttribute("aria-label");
    this.body.replaceChildren(h("p", { class: "muted" }, "Checking account limits..."));
    try {
      const result = await window.ml.engines.usage(id);
      if (request !== this.request || key !== usageKey(this.state.settings)) return;
      if (!result.available || !result.groups.length) {
        this.summary.textContent = this.compact ? "Limits —" : "Usage unavailable";
        this.summary.title = result.message || "Account limits unavailable";
        this.body.replaceChildren(h("p", { class: "muted" }, result.message || "No account limits were returned. Try refreshing."));
        return;
      }
      const selected = result.groups.find((g) => /argon/i.test(model) ? /argon/i.test(g.name)
        : /claude|gpt/i.test(model) ? /claude|gpt/i.test(g.name) : /^gemini models$/i.test(g.name)) || result.groups[0];
      const percent = (n) => n == null ? "Unavailable" : `${n.toFixed(1)}% remaining`;
      const remaining = selected.buckets.map((b) => `${b.window === "weekly" ? (this.compact ? "W" : "Weekly") : b.window === "5h" ? "5h" : b.name} ${b.remaining == null ? "—" : b.remaining.toFixed(0) + "%"}`).join(" · ");
      this.summary.textContent = remaining + (this.compact ? "" : " left");
      this.summary.setAttribute("aria-label", `Account usage remaining: ${remaining}`);
      this.summary.title = `Remaining: ${remaining}. Click for reset times and all limits.`;
      this.loadedKey = key;
      this.body.replaceChildren(
        h("p", { class: "small muted" }, "Shared account allowances, including usage outside MyLecture."),
        ...result.groups.map((g) => h("section", { class: "usage-group" },
          h("b", {}, g.name), h("p", { class: "small muted" }, g.description),
          ...g.buckets.map((b) => h("div", { class: "usage-bucket" },
            h("div", { class: "row" }, h("span", { class: "grow" }, b.name), h("b", {}, percent(b.remaining))),
            b.remaining == null ? null : h("progress", { max: "100", value: String(b.remaining), "aria-label": `${g.name}: ${b.name}, ${percent(b.remaining)}` }),
            h("div", { class: "small muted" }, b.resetsAt ? `Resets ${new Date(b.resetsAt).toLocaleString()}` : "Reset time unavailable"))))),
        h("p", { class: "small muted" }, result.description),
        result.measuredAt ? h("div", { class: "small muted" }, `Provider snapshot: ${new Date(result.measuredAt).toLocaleString()}`) : null,
        h("div", { class: "small muted" }, `Updated ${new Date(result.checkedAt).toLocaleTimeString()} · Refreshes every minute`),
      );
    } catch {
      if (request !== this.request || key !== usageKey(this.state.settings)) return;
      this.summary.textContent = this.compact ? "Limits —" : "Usage unavailable";
      this.body.replaceChildren(h("p", { class: "muted" }, "Could not load usage limits. Try Refresh."));
    } finally {
      if (request === this.request) { this.pendingKey = null; this.refreshButton.disabled = false; }
    }
  }
}
