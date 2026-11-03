// An agent turn's activity, in Super Agent's item format:
//   "💬 what the agent says" (Markdown, merged per message) · "🔧 tool target" ·
//   "▶ command" · "✏️ edited file" · "🔎 query" · "💭 thinking"
// The UI shows it as a live "Working for …" timeline, then collapses it into
// "Worked for …" above the agent's final message.
export class Activity {
  constructor(onChange, { maxItems = 400, throttleMs = 200 } = {}) {
    this.items = [];
    this.sayIds = [];
    this.onChange = onChange;
    this.maxItems = maxItems;
    this.throttleMs = throttleMs;
    this._timer = null;
  }

  // Engine events: { type: "say", id, delta } | { type: "step", icon, text }
  feed(ev) {
    if (!ev) return;
    if (ev.type === "say") this.say(ev.id, ev.delta);
    else if (ev.type === "step") this.step(ev.icon, ev.text);
  }

  say(id, delta) {
    if (!delta) return;
    const last = this.items.length - 1;
    if (last >= 0 && this.sayIds[last] === id && this.items[last].startsWith("💬")) this.items[last] += delta;
    else this._push(`💬 ${delta.replace(/^\s+/, "")}`, id);
    this._changed();
  }

  step(icon, text = "") {
    // "Thinking" only matters while it's the latest thing happening.
    if (this.items.at(-1)?.startsWith("💭")) {
      this.items.pop();
      this.sayIds.pop();
    }
    const item = `${icon} ${String(text).trim()}`.trim();
    if (this.items.at(-1) === item) return;
    this._push(item, null);
    this._changed();
  }

  // The app's own steps (checking a scene, recording narration, …).
  app(text) {
    this.step("🔧", String(text).replace(/…$/, ""));
  }

  // The agent's last message: its final answer.
  lastSay() {
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].startsWith("💬")) return this.items[i].slice(2).trim();
    return "";
  }

  // Final answer out of the timeline (it is shown as the agent's own message).
  takeFinal() {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.items[i].startsWith("💬")) continue;
      const text = this.items[i].slice(2).trim();
      this.items.splice(i, 1);
      this.sayIds.splice(i, 1);
      this.flush();
      return text;
    }
    return "";
  }

  _push(item, id) {
    this.items.push(item);
    this.sayIds.push(id);
    if (this.items.length > this.maxItems) {
      this.items.shift();
      this.sayIds.shift();
    }
  }

  _changed() {
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), this.throttleMs);
  }

  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    this.onChange?.(this.items.slice());
  }
}
