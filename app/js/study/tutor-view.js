// Study: a live, full-screen tutor. The tutor talks and teaches on a
// whiteboard; the student interrupts by holding Space (voice) or typing, and
// answers the tutor's questions and practice on the board.
import { h, icon, toast, bus, confirmBox, popMenu, fmtDate } from "../ui.js";
import { Board, richHtml } from "./board.js";
import { Voice, Mic, cleanTranscript } from "./speech.js";
import { engineLabel } from "../settings.js";
import { UsagePanel } from "../usage.js";
import { AttachmentPicker, STUDY_EXTENSIONS, attachmentNames } from "../attachments.js";

// Faint, half-erased notes left on the home board, so it reads as a board at a glance.
const DOODLES = `
<span class="d d1">a² + b² = c²</span>
<span class="d d2">f'(x) = lim<sub>h→0</sub> …</span>
<span class="d d3">E = mc²</span>
<span class="d d4">why? → because…</span>
<svg class="d d5" viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M14 104 H150 M20 112 V10"/><path d="M28 96 C 60 94, 80 70, 96 50 S 130 16, 146 14"/><path d="M144 104 l6 0 -6 -4 M20 10 l-4 6 M20 10 l4 6"/></svg>
<svg class="d d6" viewBox="0 0 140 110" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 96 L126 96 L14 18 Z"/><path d="M14 84 h12 v12"/><text x="64" y="108" font-size="13" fill="currentColor" stroke="none">b</text><text x="0" y="62" font-size="13" fill="currentColor" stroke="none">a</text><text x="74" y="52" font-size="13" fill="currentColor" stroke="none">c</text></svg>
<svg class="d d7" viewBox="0 0 120 60" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 40 C 30 6, 60 6, 82 30 l-10 -2 M82 30 l2 -10"/></svg>`;

const SUGGESTIONS = [
  ["How does backpropagation work?", "Machine learning"],
  ["Teach me derivatives from scratch", "Calculus"],
  ["Why is the sky blue?", "Physics"],
  ["How do I solve quadratic equations?", "Algebra"],
  ["Explain recursion with examples", "Programming"],
  ["What is an eigenvector, intuitively?", "Linear algebra"],
  ["How does compound interest work?", "Finance"],
  ["How do vaccines train the immune system?", "Biology"],
];

// Board items that are visuals (drawn in place of where they are introduced).
const VISUAL_KINDS = new Set(["plot", "svg", "scene", "image", "flow", "table", "math", "code", "explore"]);
// A sentence that introduces a visual.
const INTRODUCES = /\b(look|see|picture|draw|drawn|sketch|diagram|graph|plot|chart|image|photo|board|here(?:'s| is| are)|this (?:triangle|curve|line|equation|formula|table|map|figure|shape|circle|scene|car|one))\b/i;
const FILLERS = ["Mm, let me think.", "Good question.", "Okay, let's see.", "Right, so.", "Ah, I see."];
const ENGINE_NAMES = { codex: "GPT", antigravity: "Gemini", "claude-code": "Claude", api: "API key" };
const LOOKAHEAD_WORDS = 140; // ask for the next segment when less speech than this is queued
const rid = () => Math.random().toString(36).slice(2, 10);
const words = (s) => (String(s).match(/\S+/g) || []).length;

function friendly(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function tutorVoice(settings) {
  const [engine, ...rest] = String(settings.tutorVoice || "omnivoice:mark-2").split(":");
  return { engine: engine === "kokoro" ? "kokoro" : "omnivoice", voice: rest.join(":") || "mark-2", speed: Number(settings.tutorSpeed) || 0.95 };
}

function voiceName(settings, catalog) {
  const { engine, voice: id } = tutorVoice(settings);
  const label = (catalog?.[engine] || []).find(([v]) => v === id)?.[1] || id.replace(/^[a-z]{2}_/, "");
  return label.replace(/\s*\(.*$/, "").replace(/\s+\d+$/, "").replace(/^\w/, (c) => c.toUpperCase());
}

function describeAnswer(r) {
  const verdict = r.correct === true ? "correct" : r.correct === false ? "incorrect" : "not auto-graded (you judge it)";
  if (r.kind === "practice") return `Practice "${r.q || r.id}" (${r.id}) finished: ${r.answer}. Overall: ${r.correct ? "every step right on the first try" : "needed retries or hints on some steps"}.`;
  return `Question ${r.id} ("${r.q || ""}") — the student answered: "${r.answer}". Auto-check: ${verdict}.`;
}

// The board's look. "auto" (the default) follows the app theme: a blackboard
// in dark mode, a whiteboard in light mode.
export function boardStyleOf(s) {
  if (s?.boardStyle === "whiteboard" || s?.boardStyle === "blackboard") return s.boardStyle;
  return s?.uiTheme === "light" ? "whiteboard" : "blackboard";
}

export class StudyView {
  constructor(root, { state, createView }) {
    this.root = root;
    this.state = state;
    this.createView = createView;
    this.voiceCatalog = null;
    root.classList.add("study-view");
    window.__mlStudy = this; // for UI checks (tests/scratch)
    this.home = h("div", { class: "st-home" });
    this.call = h("div", { class: "st-call", hidden: true });
    root.append(this.home, this.call);
    this._buildHome();
    this._buildCall();
    window.ml.study.onEvent((ev) => this.lesson?.onEvent(ev));
    window.ml.stt.onStatus((st) => this._sttStatus(st));
    bus.on("settings-changed", () => this._refreshTutorInfo());
    document.addEventListener("keydown", (e) => this._key(e), true);
    document.addEventListener("keyup", (e) => this._keyUp(e), true);
    document.addEventListener("paste", (e) => this._paste(e));
  }

  // ---------- home ----------
  _buildHome() {
    this.topicInput = h("textarea", { class: "st-topic", rows: 1, placeholder: "What do you want to learn today?" });
    this.homeAttachments = new AttachmentPicker(this.topicInput, { extensions: STUDY_EXTENSIONS });
    this.topicInput.addEventListener("input", () => {
      this.topicInput.style.height = "auto";
      this.topicInput.style.height = Math.min(160, this.topicInput.scrollHeight) + "px";
    });
    this.topicInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.startFromHome();
      }
    });
    this.homeMic = h("button", { class: "st-round ghost", title: "Hold to speak your question" }, icon("mic"));
    this._holdToTalk(this.homeMic, "home");
    this.startBtn = h("button", { class: "btn primary st-start", onclick: () => this.startFromHome() }, "Start lesson", icon("send"));
    this.tutorBtn = h("button", { class: "st-pill", onclick: () => this._tutorMenu(this.tutorBtn) });
    this.voiceBtn = h("button", { class: "st-pill", onclick: () => this._voiceMenu(this.voiceBtn) });
    this.boardBtn = h("button", { class: "st-pill", onclick: () => this._boardMenu(this.boardBtn) });
    // Remaining account limits for the tutor's own engine and model.
    this.usage = new UsagePanel({ state: this.state, compact: true, source: () => ({ id: this.engineChoice?.engine || "", model: this.engineChoice?.model || "" }) });
    this.usage.root.classList.add("st-usage");
    this.recent = h("div", { class: "st-recent" });
    this.boardLabel = h("span", {}, "whiteboard");
    // The home screen is the board itself, with the tutor waiting at it.
    const doodles = h("div", { class: "st-doodles", "aria-hidden": "true", html: DOODLES });
    const tray = h("div", { class: "st-tray", "aria-hidden": "true" }, h("i", { class: "m1" }), h("i", { class: "m2" }), h("i", { class: "m3" }), h("i", { class: "eraser" }));
    const board = h("div", { class: "st-board", "data-drop-label": "Drop files or pictures for your tutor" },
      doodles,
      h("div", { class: "st-hero" },
        h("div", { class: "st-greet" },
          h("div", { class: "st-greet-avatar" }, h("img", { src: "assets/icon.png", alt: "" })),
          h("div", { class: "st-greet-bubble" }, h("span", { class: "live-dot" }), h("b", {}, "Your tutor is here."), " What shall we learn today?")),
        h("h1", {}, "Learn anything, ", h("span", { class: "ink" }, "one-on-one.")),
        h("p", { class: "st-sub" }, "Your tutor explains on this ", this.boardLabel, ", checks your understanding and gives you practice. Interrupt any time: hold ", h("kbd", {}, "Space"), " to talk, or type."),
        h("div", { class: "st-ask" }, this.homeAttachments.list, this.topicInput, h("div", { class: "st-ask-bar" }, this.tutorBtn, this.usage.root, this.voiceBtn, this.boardBtn, h("div", { class: "grow" }), this.homeAttachments.controls, this.homeMic, this.startBtn)),
        h("div", { class: "st-chips" }, SUGGESTIONS.map(([q, tag]) => h("button", { class: "chip", onclick: () => this.start(q) }, h("span", { class: "faint" }, tag), q))),
      ),
      this.recent,
      tray,
    );
    this.homeAttachments.dropTarget(board);
    this.home.append(board);
  }

  async _refreshTutorInfo() {
    const s = this.state.settings;
    try {
      this.voiceCatalog ||= await window.ml.tts.voices();
    } catch {}
    const choice = await window.ml.study.engine().catch(() => ({ engine: s.engine, model: "" }));
    this.engineChoice = choice;
    const name = ENGINE_NAMES[choice.engine] || "No AI connected";
    this.tutorBtn.replaceChildren(icon("sparkles"), h("span", {}, "Tutor model "), h("b", {}, choice.model ? `${name} · ${choice.model}` : name));
    this.tutorName = voiceName(s, this.voiceCatalog);
    this.voice?.setVoice(tutorVoice(s));
    this.voiceBtn.replaceChildren(icon("volume"), h("span", {}, "Voice "), h("b", {}, this.tutorName));
    const style = boardStyleOf(s);
    const styleName = style === "blackboard" ? "Blackboard" : "Whiteboard";
    this.boardBtn.replaceChildren(icon("edit"), h("span", {}, "Board "), h("b", {}, styleName));
    this.tutorBtn.title = `Tutor model: ${this.tutorBtn.textContent.replace(/^Tutor model /, "")}`;
    this.voiceBtn.title = `Tutor voice: ${this.tutorName}`;
    this.boardBtn.title = `Board style: ${styleName}${s.boardStyle === "whiteboard" || s.boardStyle === "blackboard" ? "" : " (matches the app theme)"}`;
    if (this.tutorTileName) this.tutorTileName.textContent = this.tutorName;
    this.call.classList.toggle("blackboard", style === "blackboard");
    this.home.classList.toggle("blackboard", style === "blackboard");
    this.boardLabel.textContent = style;
    this.usage.refresh();
  }

  async _saveSettings(patch) {
    this.state.settings = await window.ml.settings.set(patch);
    bus.emit("settings-changed", this.state.settings);
  }

  async _tutorMenu(anchor) {
    const s = this.state.settings;
    const connected = ["claude-code", "codex", "antigravity", "api"].filter((id) => id === "api" ? s.apiKeys?.[s.api?.provider] || s.engine === "api" : s.connected?.[id]);
    const items = [{ label: "Tutor model (latency matters: faster models answer sooner)" }];
    items.push({ text: `${s.tutorEngine ? "" : "✓ "}Same as Create (${engineLabel(s)})`, run: () => this._saveSettings({ tutorEngine: "", tutorModel: "" }) });
    for (const id of connected) {
      items.push({ text: `${s.tutorEngine === id ? "✓ " : ""}${ENGINE_NAMES[id]}${s.tutorEngine === id && s.tutorModel ? ` · ${s.tutorModel}` : ""}…`, run: () => this._pickModel(anchor, id) });
    }
    items.push("-", { label: "Thinking" });
    for (const [v, label] of [["low", "Fast (recommended)"], ["medium", "Balanced"], ["high", "Thorough (slower to start)"]]) items.push({ text: `${(s.tutorEffort || "low") === v ? "✓ " : ""}${label}`, run: () => this._saveSettings({ tutorEffort: v }) });
    popMenu(anchor, items);
  }

  async _pickModel(anchor, engine) {
    const menu = popMenu(anchor, [{ label: `${ENGINE_NAMES[engine]} models` }, { label: "Loading…" }]);
    let models = [];
    try {
      models = await window.ml.engines.models(engine);
    } catch (e) {
      toast(friendly(e), { kind: "bad" });
    }
    if (!document.body.contains(menu)) return;
    const fast = (m) => /haiku|flash|mini|lite|fast|spark/i.test(m.id + (m.label || ""));
    const sorted = [...models].sort((a, b) => fast(b) - fast(a));
    popMenu(anchor, [
      { label: `${ENGINE_NAMES[engine]} models` },
      { text: "Default model", run: () => this._saveSettings({ tutorEngine: engine, tutorModel: "" }) },
      ...sorted.slice(0, 24).map((m) => ({ text: `${m.label || m.id}${fast(m) ? "  ⚡" : ""}`, run: () => this._saveSettings({ tutorEngine: engine, tutorModel: m.id }) })),
    ]);
  }

  async _voiceMenu(anchor) {
    if (!this.createView?._voiceMenu) return;
    const s = this.state.settings;
    const tv = tutorVoice(s);
    const value = `${tv.engine}:${tv.voice}`;
    const menu = await this.createView._voiceMenu({
      anchor,
      value,
      onSelect: async (key) => {
        this.voiceCatalog = null;
        await this._saveSettings({ tutorVoice: key });
      },
    });
    // The Create menu opens upward; below the button reads better here.
    if (menu && anchor.getBoundingClientRect().top < innerHeight / 2) {
      const b = anchor.getBoundingClientRect();
      menu.style.top = b.bottom + 6 + "px";
    }
  }

  _boardMenu(anchor) {
    const s = this.state.settings;
    popMenu(anchor, [
      { label: "Board" },
      { text: `${s.boardStyle !== "whiteboard" && s.boardStyle !== "blackboard" ? "✓ " : ""}Match the app theme`, run: () => this._saveSettings({ boardStyle: "auto" }) },
      { text: `${s.boardStyle === "whiteboard" ? "✓ " : ""}Whiteboard`, run: () => this._saveSettings({ boardStyle: "whiteboard" }) },
      { text: `${s.boardStyle === "blackboard" ? "✓ " : ""}Blackboard`, run: () => this._saveSettings({ boardStyle: "blackboard" }) },
    ]);
  }

  async refreshRecent() {
    const list = await window.ml.study.list().catch(() => []);
    if (!list.length) {
      this.recent.replaceChildren();
      return;
    }
    this.recent.replaceChildren(
      h("div", { class: "st-recent-head" }, h("h2", {}, "Your lessons"), h("span", { class: "faint small" }, `${list.length}`)),
      h("div", { class: "st-recent-grid" }, list.slice(0, 12).map((s) => {
        const pct = s.finished ? 100 : s.plan.length ? Math.round((100 * Math.max(0, s.section - 1)) / s.plan.length) : 0;
        const card = h("div", { class: "st-lesson-card", tabindex: 0, onclick: () => this.open(s.id), onkeydown: (e) => e.key === "Enter" && this.open(s.id) },
          h("div", { class: "st-lesson-top" }, h("b", {}, s.title || s.topic || "Lesson"),
            h("button", { class: "btn ghost sm icon", title: "Delete", onclick: async (e) => {
              e.stopPropagation();
              if (await confirmBox("Delete this lesson?", "The board and transcript are removed.")) {
                await window.ml.study.remove(s.id);
                this.refreshRecent();
              }
            } }, icon("trash"))),
          h("div", { class: "small muted st-lesson-meta" }, fmtDate(s.updatedAt), s.seconds ? ` · ${Math.max(1, Math.round(s.seconds / 60))} min` : "", s.plan.length ? ` · ${s.plan.length} parts` : ""),
          h("div", { class: "st-progress" }, h("i", { style: `width:${pct}%` })),
          h("div", { class: "small faint" }, s.finished ? "Finished" : s.plan[Math.max(0, s.section - 1)] ? `Up to: ${s.plan[Math.max(0, s.section - 1)]}` : "Started"));
        return card;
      })),
    );
  }

  onShow() {
    this._refreshTutorInfo();
    if (!this.lesson) {
      this.refreshRecent();
      setTimeout(() => this.topicInput.focus(), 30);
    }
    // Warm the speech recognizer so the first hold-to-talk is quick.
    window.ml.stt.warm().catch(() => {});
  }

  startFromHome() {
    const t = this.topicInput.value.trim();
    if (!t && !this.homeAttachments.count) return this.topicInput.focus();
    this.start(t);
  }

  // ---------- call UI ----------
  _buildCall() {
    this.board = new Board({ onAnswer: (r) => this.lesson?.answered(r), onExplore: (r) => this.lesson?.explored(r) });
    this.caption = h("div", { class: "st-caption", hidden: true });
    this.status = h("div", { class: "st-status" });
    this.title = h("div", { class: "st-title" }, "Lesson");
    this.timer = h("span", { class: "st-timer" }, "0:00");
    this.engineTag = h("span", { class: "st-engine" });
    this.liveBadge = h("button", { class: "st-live", title: "You're live", onclick: () => this.lesson?.backToLive() }, "LIVE");
    this.agenda = h("ol", { class: "st-agenda" });
    this.tutorRing = h("div", { class: "st-avatar st-logo", title: "Your tutor" }, h("img", { src: "assets/icon.png", alt: "" }));
    this.tutorTileName = h("b", {}, "Tutor");
    this.tutorState = h("span", { class: "st-tile-state" });
    this.youRing = h("div", { class: "st-avatar you" }, h("div", { class: "st-avatar-core" }, "You"));
    this.youState = h("span", { class: "st-tile-state" }, "");
    this.transcript = h("div", { class: "st-transcript" });
    this.input = h("textarea", { class: "st-input", rows: 1, placeholder: "Ask your tutor…  (or hold Space to talk)" });
    this.callAttachments = new AttachmentPicker(this.input, { extensions: STUDY_EXTENSIONS });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._sendTyped();
      }
      if (e.key === "Escape") this.input.blur();
    });
    this.input.addEventListener("input", () => {
      this.input.style.height = "auto";
      this.input.style.height = Math.min(120, this.input.scrollHeight) + "px";
    });
    this.micBtn = h("button", { class: "st-ctl mic", title: "Hold to talk (or hold Space)" }, icon("mic"));
    this._holdToTalk(this.micBtn, "call");
    this.backBtn = h("button", { class: "st-ctl", title: "Replay the last sentence (Left arrow). Shift+Left replays the last part.", onclick: (e) => this.lesson?.rewind(e.shiftKey) }, icon("rewind"), h("span", {}, "Back"));
    this.pauseBtn = h("button", { class: "st-ctl", title: "Pause / resume (P)", onclick: () => this.lesson?.togglePause() }, icon("pause"), h("span", {}, "Pause"));
    this.speedBtn = h("button", { class: "st-ctl", title: "Speaking speed", onclick: () => this._speedMenu() }, h("b", { class: "st-speed" }, "1×"), h("span", {}, "Speed"));
    this.ccBtn = h("button", { class: "st-ctl on", title: "Captions (C)", onclick: () => this._toggleCaptions() }, icon("cc"), h("span", {}, "Captions"));
    this.fsBtn = h("button", { class: "st-ctl", title: "Full screen (F11)", onclick: () => this._toggleFullscreen() }, icon("expand"), h("span", {}, "Full screen"));
    this.endBtn = h("button", { class: "st-ctl end", title: "End lesson", onclick: () => this.leave() }, icon("x"), h("span", {}, "End"));
    this.sendBtn = h("button", { class: "st-send", title: "Send (Enter)", onclick: () => this._sendTyped() }, icon("send"));
    // A standard meeting toolbar: lesson on the left, controls in the
    // middle, the question box on the right.
    // The agenda: a slim column beside the board, collapsible to numbers only.
    this.agendaToggle = h("button", { class: "st-agenda-toggle", onclick: () => this._collapseAgenda(!this.agendaSide.classList.contains("collapsed")) });
    this.agendaSide = h("aside", { class: "st-agenda-side", hidden: true }, h("div", { class: "st-agenda-head" }, h("span", {}, "Agenda"), this.agendaToggle), this.agenda);
    this._collapseAgenda(localStorage.getItem("st-agenda-collapsed") === "1");
    const info = h("div", { class: "st-info" },
      this.tutorRing,
      h("div", { class: "st-info-text" },
        h("div", { class: "st-info-top" }, this.title, this.liveBadge),
        h("div", { class: "st-info-sub" }, this.timer, h("span", { class: "sep" }, "·"), this.tutorState, this.youState)));
    this.call.dataset.dropLabel = "Drop files or pictures for your tutor";
    this.callAttachments.dropTarget(this.call);
    this.call.append(
      h("div", { class: "st-stage" }, this.agendaSide, h("div", { class: "st-board-wrap" }, this.board.root, this.caption)),
      h("footer", { class: "st-controls" },
        info,
        h("div", { class: "st-ctl-group" }, this.backBtn, this.pauseBtn, this.speedBtn, this.ccBtn, this.fsBtn, h("span", { class: "st-divider" }), this.endBtn),
        h("div", { class: "st-compose" }, this.callAttachments.list, this.callAttachments.controls, this.micBtn, this.input, this.sendBtn)),
    );
    // Full screen is the whiteboard alone; the bar slides in when the mouse
    // nears the bottom edge.
    // Window full screen (F11) counts too.
    let windowFull = false;
    const fsMode = () => this.call.classList.toggle("fs", windowFull || document.fullscreenElement === this.call);
    document.addEventListener("fullscreenchange", fsMode);
    window.ml.onFullscreen?.((on) => {
      windowFull = !!on;
      fsMode();
    });
    this.call.addEventListener("mousemove", (e) => {
      if (!this.call.classList.contains("fs")) return;
      const near = e.clientY > innerHeight - 90;
      this.call.classList.toggle("bar-shown", near || this.call.querySelector(".st-controls")?.contains(e.target));
    });
    this.voice = new Voice({ onLevel: (v) => this.tutorRing.style.setProperty("--level", v.toFixed(3)) });
    this.voice.setVoice(tutorVoice(this.state.settings));
    // A clear "I'm listening" sign while the student talks, shown over the
    // board (also in full screen) or on the home screen.
    this.talkText = h("span", {}, "Listening…");
    this.talkPill = h("div", { class: "st-talk", hidden: true, "aria-live": "polite" }, h("span", { class: "st-talk-bars" }, h("i"), h("i"), h("i"), h("i"), h("i")), this.talkText);
    this.mic = new Mic({ onLevel: (v) => {
      this.micBtn.style.setProperty("--level", v.toFixed(3));
      this.talkPill.style.setProperty("--level", v.toFixed(3));
    } });
  }

  _toggleCaptions() {
    this.captionsOff = !this.captionsOff;
    this.ccBtn.classList.toggle("on", !this.captionsOff);
    this.caption.classList.toggle("off", this.captionsOff);
  }

  _toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (this.call.classList.contains("fs")) return; // already full screen (F11)
    else this.call.requestFullscreen?.().catch(() => {});
  }

  _speedMenu() {
    popMenu(this.speedBtn, [{ label: "Speaking speed" }, ...[0.85, 1, 1.15, 1.3, 1.5].map((r) => ({ text: `${this.voice.rate === r ? "✓ " : ""}${r}×`, run: () => {
      this.voice.setRate(r);
      this.speedBtn.querySelector(".st-speed").textContent = `${r}×`;
    } }))]);
  }

  setStatus(kind, text) {
    this.status.className = `st-status ${kind || ""}`;
    this.status.textContent = text || "";
    this.tutorState.textContent = { thinking: "Thinking…", speaking: "Speaking", waiting: "Waiting for you", paused: "Paused", done: "Lesson complete", error: "Something went wrong", listening: "Listening to you", replaying: "Replaying" }[kind] || "";
    this.tutorRing.classList.toggle("thinking", kind === "thinking");
    this.tutorRing.classList.toggle("speaking", kind === "speaking");
    this.pauseBtn.querySelector("span").textContent = kind === "paused" ? "Resume" : "Pause";
    this.pauseBtn.replaceChild(icon(kind === "paused" ? "play" : "pause"), this.pauseBtn.firstChild);
  }

  setReplay(on) {
    this.call.classList.toggle("replaying", on);
    this.caption.classList.toggle("replay", on);
    this.liveBadge.classList.toggle("on", on);
    this.liveBadge.title = on ? "Go back to the live lesson (Right arrow steps forward)" : "You're live";
    if (!on) this.liveBadge.textContent = "LIVE";
  }

  setReplayPosition(behind) {
    this.liveBadge.textContent = `Replaying · ${behind} back · Go live`;
  }

  setCaption(text) {
    if (!text) {
      this.caption.hidden = true;
      return;
    }
    this.caption.hidden = false;
    this.caption.textContent = text;
  }

  addTranscript(who, text, extra = "", files = []) {
    const el = h("div", { class: `st-line ${who}` }, h("b", {}, who === "you" ? "You" : who === "tutor" ? this.tutorName || "Tutor" : ""), h("span", { html: richHtml(text, { inline: true }) }), extra ? h("i", { class: "faint" }, ` ${extra}`) : null, attachmentNames(files));
    this.transcript.append(el);
    this.transcript.scrollTop = this.transcript.scrollHeight;
    return el;
  }

  renderAgenda(plan, section) {
    this.agenda.replaceChildren(...plan.map((p, i) => h("li", { class: i + 1 < section ? "done" : i + 1 === section ? "now" : "", title: `${i + 1}. ${p}` }, h("span", { class: "n" }, i + 1 < section ? "✓" : String(i + 1)), h("span", { class: "t" }, p))));
    this.agendaSide.hidden = !plan.length;
  }

  _collapseAgenda(on) {
    this.agendaSide.classList.toggle("collapsed", on);
    this.agendaToggle.textContent = on ? "›" : "‹";
    this.agendaToggle.title = on ? "Show the agenda" : "Collapse the agenda";
    localStorage.setItem("st-agenda-collapsed", on ? "1" : "0");
  }

  // ---------- sessions ----------
  async start(topic) {
    if (!this._canStart() || this._starting) return;
    const id = await window.ml.study.newId();
    let attachments = [];
    let names = [];
    if (this.homeAttachments.count) {
      this._starting = true;
      this.homeAttachments.setLocked(true);
      this.startBtn.disabled = true;
      try {
        const raw = await this.homeAttachments.serialize();
        names = this.homeAttachments.names();
        attachments = await window.ml.study.attach(id, raw);
        this.homeAttachments.clear();
      } catch (e) {
        toast(friendly(e), { kind: "bad" });
        return;
      } finally {
        this._starting = false;
        this.homeAttachments.setLocked(false);
        this.startBtn.disabled = false;
      }
    }
    const cleanTopic = String(topic || "").trim();
    const effectiveTopic = cleanTopic || (names.length === 1 ? `Teach me about ${names[0].name}` : `Teach me from ${names.map((n) => n.name).join(", ")}`);
    this.topicInput.value = "";
    this.topicInput.style.height = "auto";
    const session = { id, topic: effectiveTopic, title: effectiveTopic.length > 70 ? effectiveTopic.slice(0, 67) + "…" : effectiveTopic, createdAt: new Date().toISOString(), plan: [], section: 0, history: [], board: [], attachments, seconds: 0, finished: false };
    this._enter(session);
    this.lesson.begin(names);
  }

  async open(id) {
    const session = await window.ml.study.get(id);
    if (!session) return toast("That lesson couldn't be opened.", { kind: "bad" });
    if (!this._canStart()) return;
    this._enter(session);
    this.lesson.restore();
  }

  _canStart() {
    const s = this.state.settings;
    if (!s.engine && !s.tutorEngine) {
      toast("Connect an AI account first (Settings).", { kind: "bad", actions: [{ label: "Open Settings", run: () => bus.emit("navigate", { view: "settings" }) }] });
      return false;
    }
    return true;
  }

  _enter(session) {
    this.home.hidden = true;
    this.call.hidden = false;
    document.body.classList.add("in-lesson");
    this.callAttachments.clear();
    this.board.clear();
    this.transcript.replaceChildren();
    this.setCaption("");
    this.title.textContent = session.title || "Lesson";
    this.renderAgenda(session.plan || [], session.section || 0);
    const choice = this.engineChoice || {};
    this.engineTag.textContent = choice.engine ? `${ENGINE_NAMES[choice.engine] || choice.engine}${choice.model ? ` · ${choice.model}` : ""}` : "";
    this.lesson = new Lesson(this, session);
    this._tick = setInterval(() => this.lesson?.tick(), 1000);
  }

  async leave() {
    const l = this.lesson;
    if (!l) return;
    l.close();
    await l.save();
    this.lesson = null;
    clearInterval(this._tick);
    this.voice.stop();
    this.callAttachments.clear();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.body.classList.remove("in-lesson");
    this.call.hidden = true;
    this.home.hidden = false;
    this.refreshRecent();
  }

  // ---------- talking ----------
  async _takeCallAttachments() {
    if (!this.callAttachments.count || !this.lesson) return { added: [], names: [] };
    this.callAttachments.setLocked(true);
    this.sendBtn.disabled = true;
    const prev = this.youState.textContent;
    this.youState.textContent = "Attaching…";
    try {
      const raw = await this.callAttachments.serialize();
      const names = this.callAttachments.names();
      const added = await window.ml.study.attach(this.lesson.s.id, raw);
      this.callAttachments.clear();
      return { added, names };
    } finally {
      this.youState.textContent = prev === "Attaching…" ? "" : prev;
      this.callAttachments.setLocked(false);
      this.sendBtn.disabled = false;
    }
  }

  async _sendTyped() {
    const t = this.input.value.trim();
    if ((!t && !this.callAttachments.count) || !this.lesson || this._sending) return;
    this._sending = true;
    let added = [], names = [];
    try {
      ({ added, names } = await this._takeCallAttachments());
    } catch (e) {
      this._sending = false;
      toast(friendly(e), { kind: "bad" });
      return;
    }
    this._sending = false;
    const text = t || (names.length === 1 ? `Can you explain ${names[0].name}?` : `Can you explain these files (${names.map((n) => n.name).join(", ")})?`);
    this.input.value = "";
    this.input.style.height = "auto";
    this.lesson.studentSays(text, "typed", added, names);
  }

  _paste(e) {
    if (this.state.view !== "study" || this.root.offsetParent === null || this._typingTarget(e)) return;
    const picker = this.lesson && !this.call.hidden ? this.callAttachments : this.homeAttachments;
    if (picker.paste(e)) picker.input?.focus();
  }

  _typingTarget(e) {
    const t = e.target;
    return t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable);
  }

  _key(e) {
    if (this.state.view !== "study" || this.root.offsetParent === null) return;
    if (e.code === "Space" && !this._typingTarget(e) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat && !this.recording) this._startTalk(this.lesson ? "call" : "home");
      return;
    }
    if (!this.lesson || this._typingTarget(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.lesson.rewind(e.shiftKey);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      this.lesson.replayForward();
    } else if (e.key === "p" || e.key === "P") this.lesson.togglePause();
    else if (e.key === "c" || e.key === "C") this._toggleCaptions();
    else if (e.key === "/" ) {
      e.preventDefault();
      this.input.focus();
    }
  }

  _keyUp(e) {
    if (e.code === "Space" && this.recording === "key") {
      e.preventDefault();
      this._endTalk();
    }
  }

  _holdToTalk(btn, where) {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      this._startTalk(where, "pointer");
    });
    const up = () => this.recording === "pointer" && this._endTalk();
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
  }

  async _startTalk(where, how = "key") {
    if (this.recording) return;
    this.recording = how;
    this.talkWhere = where;
    document.body.classList.add("st-recording");
    this.youState.textContent = "Listening…";
    this._talkSign("listening", how === "key" ? "Listening…  release Space to send" : "Listening…  release to send");
    this.lesson?.studentStartedTalking();
    try {
      await this.mic.start();
    } catch (e) {
      this.recording = false;
      document.body.classList.remove("st-recording");
      this._talkSign(null);
      this.lesson?.studentStoppedTalking(false);
      toast(`Microphone unavailable: ${friendly(e)}`, { kind: "bad" });
    }
  }

  async _endTalk() {
    if (!this.recording) return;
    this.recording = false;
    document.body.classList.remove("st-recording");
    const { pcm, seconds } = this.mic.stop();
    if (seconds < 0.35) {
      this.youState.textContent = "";
      this._talkSign(null);
      this.lesson?.studentStoppedTalking(false);
      return;
    }
    this.youState.textContent = "Transcribing…";
    this._talkSign("transcribing", "Got it, transcribing…");
    let text = "";
    try {
      text = cleanTranscript(await window.ml.stt.transcribe(pcm));
    } catch (e) {
      toast(`Couldn't recognize speech: ${friendly(e)}`, { kind: "bad" });
    }
    this.youState.textContent = "";
    this._talkSign(null);
    if (!text) {
      if (seconds > 0.8) toast("I didn't catch that. Try again, or type your question.", { timeout: 2500 });
      this.lesson?.studentStoppedTalking(false);
      return;
    }
    if (this.talkWhere === "home" && !this.lesson) {
      this.start(text);
      return;
    }
    let added = [], names = [];
    if (this.callAttachments.count && this.lesson) {
      try {
        ({ added, names } = await this._takeCallAttachments());
      } catch (e) {
        toast(friendly(e), { kind: "bad" });
      }
    }
    this.lesson?.studentSays(text, "voice", added, names);
  }

  _talkSign(state, text = "") {
    const pill = this.talkPill;
    if (!state) {
      pill.hidden = true;
      return;
    }
    const host = this.lesson && !this.call.hidden ? this.call : this.home;
    if (pill.parentNode !== host) host.append(pill);
    pill.className = `st-talk ${state}`;
    this.talkText.textContent = text;
    pill.hidden = false;
  }

  _sttStatus(st) {
    if (!this.recording && (st.state === "downloading" || st.state === "loading")) this.youState.textContent = st.message;
    else if (!this.recording && st.state === "ready") this.youState.textContent = "";
    else if (st.state === "error") this.youState.textContent = "Voice input unavailable. Type instead.";
    if (st.state === "downloading" || st.state === "loading") this.micBtn.title = st.message;
    else this.micBtn.title = "Hold to talk (or hold Space)";
  }
}

// One live lesson: generation, the playback queue, interruptions and saving.
class Lesson {
  constructor(view, session) {
    this.v = view;
    this.s = session;
    this.queue = []; // undelivered items, in order
    this.gen = null; // the segment being generated
    this.lastEnd = null; // how the last delivered segment ended
    this.awaiting = null; // id of the interactive the tutor waits on
    this.paused = false;
    this.closed = false;
    this.running = false;
    this.lastSay = null; // history entry of the say line being spoken
    this.latency = [];
    this._saveTimer = 0;
    this._sleepers = new Set();
    this.spoken = []; // sentences heard so far, for rewinding
    this.replay = null; // {cursor, live, done, resolve, jump}
    this.epoch = 0;
    this.writing = null;
  }

  // ----- lifecycle -----
  _warmFillers() {
    // Cached by the voice engine, so the first filler plays instantly.
    const opts = this.v.voice.fallback ? undefined : this.v.voice.opts || undefined;
    for (const f of FILLERS) window.ml.tts.synth(f, opts).catch(() => {});
  }

  begin(names = []) {
    const shared = names.length ? ` [shared: ${names.map((n) => n.name).join(", ")}]` : "";
    this.v.addTranscript("you", this.s.topic, "", names);
    this.s.history.push({ role: "student", text: this.s.topic + shared, via: "typed", ...(names.length ? { files: names } : {}) });
    this.request({ kind: "start", text: this.s.topic + shared });
    this.v.board.newPage(this.s.title);
  }

  restore() {
    this.v.board.setLocked(false);
    for (const a of this.s.board || []) this.v.board.draw(a, { animate: false, replay: true });
    for (const t of this.s.history) {
      if (t.role === "student") this.v.addTranscript("you", t.text, "", t.files || []);
    }
    this.v.renderAgenda(this.s.plan, this.s.section);
    if (this.s.finished) {
      this.v.setStatus("done", "Lesson complete · ask a follow-up any time");
    } else {
      this.v.setStatus("waiting", "");
      this.v.setCaption("");
      const resume = h("button", { class: "btn primary", onclick: () => {
        resume.remove();
        this.s.history.push({ role: "event", text: "The student came back to this lesson later and resumed it. Briefly reconnect (one or two sentences recapping where you were), then continue." });
        this.request({ kind: "continue" });
      } }, icon("play"), "Continue the lesson");
      this.v.board.scroller.append(h("div", { class: "wb-resume" }, resume));
    }
  }

  close() {
    this.closed = true;
    if (this.gen) window.ml.study.cancel(this.gen.turnId);
    this.gen = null;
    this.queue = [];
    this.v.voice.stop();
    this.v.voice.cancelPending();
  }

  tick() {
    if (this.closed || this.paused) return;
    this.s.seconds = (this.s.seconds || 0) + 1;
    const t = this.s.seconds;
    this.v.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  }

  save() {
    clearTimeout(this._saveTimer);
    return window.ml.study.save(this.s).catch(() => {});
  }

  _saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 1500);
  }

  // ----- generation -----
  // History as it will be once the queue has played (for lookahead).
  _futureHistory() {
    const out = this.s.history.map((x) => ({ ...x }));
    let line = null;
    for (const it of this.queue) {
      const a = it.action;
      if (a.type === "say") {
        if (line && line.key === `${it.turnId}:${a.line}`) line.text += " " + a.text;
        else {
          line = { role: "tutor", text: "say: " + a.text, key: `${it.turnId}:${a.line}` };
          out.push(line);
        }
      } else if (a.raw && a.type !== "end") {
        out.push({ role: "tutor", text: a.raw });
        line = null;
      }
    }
    return out;
  }

  _futureSection() {
    let sec = this.s.section;
    for (const it of this.queue) if (it.action.type === "section") sec = it.action.index;
    return sec;
  }

  request(task) {
    if (this.closed) return;
    if (this.gen) window.ml.study.cancel(this.gen.turnId);
    const turnId = `t${rid()}`;
    const seg = { turnId, task, end: null, done: false, at: performance.now(), firstAt: 0 };
    if (!this.paused) this.v.board.setLocked(true);
    this.gen = seg;
    if (!this.queue.length && !this.v.voice.current) this.v.setStatus("thinking", "");
    const req = {
      turnId,
      sessionId: this.s.id,
      topic: this.s.topic,
      history: this._futureHistory().map(({ role, text, via }) => ({ role, text, via })),
      plan: this.s.plan,
      section: this._futureSection(),
      task,
      attachments: this.s.attachments || [],
    };
    window.ml.study.turn(req).catch((e) => this.onEvent({ turnId, type: "error", message: friendly(e) }));
  }

  onEvent(ev) {
    const seg = this.gen;
    if (!seg || ev.turnId !== seg.turnId || this.closed) return;
    if (ev.type === "first") {
      seg.firstAt = performance.now() - seg.at;
      this.latency.push(seg.firstAt);
    } else if (ev.type === "upcoming") {
      this._next = ev.kind;
      this._wake?.();
    } else if (ev.type === "action") {
      this._next = null;
      this._receive(seg, ev.action);
      this._wake?.();
    }
    else if (ev.type === "done") {
      seg.done = true;
      this.gen = null;
      this._wake?.();
      clearTimeout(this._fillerTimer);
      if (!this.queue.length && !this.running) this._afterDrain();
      this._maybeLookahead();
    } else if (ev.type === "error") {
      this.gen = null;
      clearTimeout(this._fillerTimer);
      this.v.setStatus("error", "");
      this.v.setCaption("");
      toast(`Your tutor couldn't respond: ${ev.message}`, { kind: "bad", timeout: 9000, actions: [{ label: "Try again", run: () => this.request(seg.task) }] });
    } else if (ev.type === "aborted") {
      // A newer request replaced it.
    }
  }

  _receive(seg, a) {
    if (a.type === "plan") {
      if (a.items?.length) {
        this.s.plan = a.items;
        this.v.renderAgenda(this.s.plan, this._futureSection());
      }
      return;
    }
    if (a.type === "invalid") return;
    if (a.type === "image") a._image = window.ml.study.image(a.data?.query || a.data?.caption || "").catch(() => null);
    if (a.type === "end") seg.end = a.value;
    const item = { turnId: seg.turnId, action: a, epoch: this.epoch };
    if (a.type === "say") {
      const cues = [];
      let clean = "";
      let last = 0;
      a.text.replace(/\s*\{(?:look|point|see)\s*:\s*([^}]+)\}\s*/gi, (m, ref, i) => {
        clean += a.text.slice(last, i);
        if (clean && !/\s$/.test(clean)) clean += " ";
        cues.push({ pos: clean.length, ref: ref.trim() });
        last = i + m.length;
        return m;
      });
      clean = (clean + a.text.slice(last)).replace(/\s+/g, " ").trim();
      a.spoken = clean;
      a.cues = cues;
      item.prepared = this.v.voice.prepare(clean);
    }
    if (VISUAL_KINDS.has(a.type)) this._placeVisual(item);
    else this.queue.push(item);
    this._run();
  }

  // The tutor often introduces a visual ("let's start with a picture...")
  // and only writes the visual a few sentences later. Show it at the
  // sentence that introduces it, if that sentence hasn't been spoken yet.
  _placeVisual(item) {
    let i = this.queue.length;
    // Unspoken sentences of the say line just before this visual.
    const tail = [];
    while (i > 0 && this.queue[i - 1].action.type === "say" && this.queue[i - 1].turnId === item.turnId) {
      const prev = this.queue[i - 1];
      if (tail.length && prev.action.line !== tail[0].action.line) break;
      tail.unshift(prev);
      i--;
    }
    // Otherwise it goes with the sentence just before it: show it as that
    // sentence starts, so the student sees it while hearing about it.
    if (tail.length) {
      const k = tail.findIndex((t) => INTRODUCES.test(t.action.spoken || ""));
      this.queue.splice(i + (k >= 0 ? k : tail.length - 1), 0, item);
      return;
    }
    // That sentence has only just started playing: show it now.
    const sp = this.speaking;
    if (!this.queue.length && sp?.action.type === "say" && sp.turnId === item.turnId && !this.replay && !this.writing && !this.paused && performance.now() - (this.speakAt || 0) < 2500) {
      this._drawVisual(item);
      this._saveSoon();
      return;
    }
    this.queue.push(item);
  }

  // The sentence about to play is the last one received while the tutor is
  // still writing. If a visual comes next (it often follows the sentence that
  // describes it), wait for it so the two start together.
  async _awaitNext(head) {
    const t0 = performance.now(), ep = this.epoch;
    const still = () => this.gen?.turnId === head.turnId && this.queue.length === 1 && this.queue[0] === head && ep === this.epoch && !this.paused && !this.closed;
    while (still()) {
      const k = this._next, waited = performance.now() - t0;
      if (k && !VISUAL_KINDS.has(k)) break; // more speech or a note next
      if (waited > (k ? 7000 : 1200)) break;
      await new Promise((r) => {
        this._wake = r;
        setTimeout(r, 120);
      });
    }
    this._wake = null;
  }

  // Before a sentence that points at something not drawn yet, draw it.
  _pullForward(cues) {
    const out = [];
    for (const c of cues || []) {
      const id = String(c.ref).split(/[./]/)[0];
      if (this.v.board.items.has(id)) continue;
      const k = this.queue.findIndex((q) => VISUAL_KINDS.has(q.action.type) && (q.action.id === id || q.action.data?.id === id));
      if (k >= 0) out.push(...this.queue.splice(k, 1));
    }
    return out;
  }

  // Keep a segment ahead so the tutor never stops to think mid-lesson.
  _maybeLookahead() {
    if (this.gen || this.closed || this.awaiting || this.s.finished) return;
    const last = [...this.queue].reverse().find((i) => i.action.type === "end");
    const tailEnd = last ? last.action.value : this.lastEnd;
    if (tailEnd !== "continue") return;
    const queuedWords = this.queue.reduce((n, i) => n + (i.action.type === "say" ? words(i.action.text) : 0), 0);
    if (queuedWords > LOOKAHEAD_WORDS) return;
    this.request({ kind: "continue" });
  }

  // ----- playback -----
  async _run() {
    if (this.paused || this.closed) return;
    if (this.running && this.runEpoch === this.epoch) return;
    const ep = (this.runEpoch = this.epoch);
    this.running = true;
    try {
      while (this.queue.length && !this.paused && !this.closed && ep === this.epoch) {
        if (this.replay) await this.replay.done;
        if (ep !== this.epoch) return;
        if (!this.queue.length || this.paused || this.closed) break;
        const head = this.queue[0];
        if (head.action.type === "say" && this.queue.length === 1 && this.gen?.turnId === head.turnId) {
          await this._awaitNext(head);
          if (ep !== this.epoch) return;
          if (!this.queue.length || this.paused || this.closed) break;
        }
        const item = this.queue.shift();
        await this._deliver(item);
        if (ep !== this.epoch) return;
        this._maybeLookahead();
      }
    } finally {
      if (ep === this.runEpoch) this.running = false;
    }
    if (ep === this.epoch && !this.queue.length && !this.paused && !this.closed) this._afterDrain();
  }

  async _deliver(item) {
    const a = item.action;
    const hist = this.s.history;
    if (a.type !== "say") this.lastSay = null;
    switch (a.type) {
      case "say": {
        // It points at something still waiting in the queue: draw that first.
        for (const pulled of this._pullForward(a.cues)) {
          await this._deliver(pulled);
          if (this.closed || this._interruptedSince(item)) return;
          this.lastSay = null;
        }
        const key = `${item.turnId}:${a.line}`;
        if (this.lastSay && this.lastSay.key === key) this.lastSay.text += " " + a.text;
        else {
          this.lastSay = { role: "tutor", text: "say: " + a.text, key };
          hist.push(this.lastSay);
          this.sayLine = this.v.addTranscript("tutor", "");
        }
        const span = this.sayLine?.querySelector("span");
        if (span) span.textContent = (span.textContent ? span.textContent + " " : "") + (a.spoken ?? a.text);
        this.v.transcript.scrollTop = this.v.transcript.scrollHeight;
        if (this.filler) await this.filler;
        // Remember what was said (and what was on the board) for rewinding.
        this.spoken.push({ text: a.spoken ?? a.text, cues: a.cues || [], prepared: item.prepared, key, el: this.v.board.active, page: this.v.board.current });
        let r;
        for (;;) {
          this.v.setStatus("speaking", "");
          this.v.setCaption(a.spoken ?? a.text);
          this.speaking = item;
          r = await this.v.voice.play(item.prepared, a.spoken ?? a.text, { onStart: (dur) => {
            this.speakAt = performance.now();
            this._cue(a.cues, a.spoken ?? a.text, dur, item.epoch);
          } });
          this.speaking = null;
          // Rewound mid-sentence: after the replay catches up, say it again.
          if (r.stopped && this.replay) {
            await this.replay.done;
            if (this.closed || this._interruptedSince(item)) return;
            continue;
          }
          break;
        }
        if (r.stopped) {
          // Interrupted: keep only what was heard.
          return;
        }
        // Human pacing: a breath between sentences, a longer one between thoughts.
        const next = this.queue[0]?.action;
        const gap = next?.type === "say" && next.line === a.line && this.queue[0].turnId === item.turnId ? 220 : /\?$/.test(a.text) ? 900 : 520;
        await this._sleep(gap);
        break;
      }
      case "pause":
        this.v.setCaption("");
        hist.push({ role: "tutor", text: a.raw });
        await this._sleep(a.seconds * 1000);
        break;
      case "section":
        this.s.section = a.index;
        this.v.renderAgenda(this.s.plan, this.s.section);
        hist.push({ role: "tutor", text: a.raw });
        break;
      case "end":
        this.lastEnd = a.value;
        if (a.value === "done") this.s.finished = true;
        break;
      default: {
        // One thing at a time on the board: finish writing the last item first.
        if (this.writing) await this.writing;
        // Draw it when the words about it are ready to play, so the board
        // never runs ahead of the voice.
        const nextSay = this.queue.find((i) => i.action.type === "say");
        if (nextSay && this.queue.indexOf(nextSay) <= 2) await Promise.race([nextSay.prepared, new Promise((r) => setTimeout(r, 5000))]);
        if (this.closed || this._interruptedSince(item)) return;
        const el = this._drawVisual(item);
        if (!el && a.type !== "page") break;
        if (a.type === "ask" || a.type === "practice") {
          if (this.writing) await this.writing;
          this.awaiting = a.data?.id || a.id || "q";
          setTimeout(() => el?._focus?.(), 200);
        }
      }
    }
    this._saveSoon();
  }

  // Puts a board item up and records it. The tutor keeps talking while it's
  // written; the next board item waits for the pen.
  _drawVisual(item) {
    const a = item.action;
    const el = this.v.board.draw(a);
    if (!el && a.type !== "page") return null;
    const ms = el?._writeMs || 0;
    this.writing = ms ? this._sleep(ms + 350, { board: true }).then(() => (this.writing = null)) : null;
    this.s.history.push({ role: "tutor", text: a.raw });
    this.s.board.push(a);
    return el;
  }

  // Fires the pointing cues of a sentence at their moment in the audio
  // (by position in the text, which tracks speech closely enough).
  _cue(cues, text, dur, epoch) {
    if (!cues?.length) return;
    const len = Math.max(1, text.length);
    for (const c of cues) {
      const ms = Math.max(0, (c.pos / len) * dur * 1000 - 150);
      setTimeout(() => {
        if (this.closed || epoch !== this.epoch) return;
        // The words right after the cue ("...this blue line") help find the exact part.
        this.v.board.point(c.ref, text.slice(c.pos, c.pos + 60));
      }, ms);
    }
  }

  // ----- rewind: replay what was said, then catch up to the live lesson -----
  // block: go back to the start of the previous say line instead of one sentence.
  rewind(block = false) {
    if (this.closed || !this.spoken.length) return;
    const live = this.replay ? this.replay.live : this.speaking ? this.spoken.length - 1 : this.spoken.length;
    const from = this.replay ? this.replay.cursor : live;
    let t = Math.max(0, from - 1);
    if (block) while (t > 0 && this.spoken[t - 1].key === this.spoken[t].key) t--;
    if (this.replay) {
      this.replay.cursor = t;
      this.replay.jump = true;
      this.v.voice.stop();
      return;
    }
    let resolve;
    const done = new Promise((r) => (resolve = r));
    this.replay = { cursor: t, live, done, resolve, jump: false };
    this.v.voice.stop(); // the live sentence starts over once the replay catches up
    this._replayLoop(this.replay);
  }

  // Steps ahead inside a replay; never past the live lesson.
  replayForward() {
    const rp = this.replay;
    if (!rp) return;
    if (rp.cursor + 1 >= rp.live) return this.backToLive();
    rp.cursor++;
    rp.jump = true;
    this.v.voice.stop();
  }

  backToLive() {
    const rp = this.replay;
    if (!rp) return;
    this.v.voice.stop();
    this._endReplay(rp);
  }

  async _replayLoop(rp) {
    this.v.setReplay(true);
    this.v.board.setHold(true);
    this.v.board.follow = false;
    while (this.replay === rp && rp.cursor < rp.live && !this.closed) {
      const e = this.spoken[rp.cursor];
      rp.jump = false;
      const b = this.v.board;
      if (e.page != null && e.page >= 0 && e.page !== b.viewing) b.showPage(e.page);
      if (e.el?.isConnected) {
        b.markActive(e.el);
        e.el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      this.v.setStatus("replaying", "");
      this.v.setCaption(e.text);
      this.v.setReplayPosition(rp.live - rp.cursor);
      const r = await this.v.voice.play(e.prepared, e.text, { onStart: (dur) => this._cue(e.cues, e.text, dur, this.epoch) });
      if (this.replay !== rp) return;
      if (rp.jump) continue;
      if (r.stopped) break;
      rp.cursor++;
      await new Promise((res) => setTimeout(res, 250));
    }
    this._endReplay(rp);
  }

  _endReplay(rp) {
    if (!rp || this.replay !== rp) return;
    this.replay = null;
    this.v.setReplay(false);
    const b = this.v.board;
    b.setHold(false);
    if (b.current >= 0) b.showPage(b.current);
    rp.resolve();
  }

  // Interruptible wait (an interruption ends it early).
  _sleep(ms, { board = false } = {}) {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(t);
        self._sleepers.delete(done);
        resolve();
      }
      if (!board) this._sleepers.add(done);
    });
  }

  _interruptedSince(item) {
    return item.epoch !== this.epoch;
  }

  _afterDrain() {
    if (this.closed) return;
    this.v.setCaption("");
    if (this.gen) {
      this.v.setStatus("thinking", "");
      return;
    }
    if (this.s.finished) {
      this.v.setStatus("done", "Lesson complete · ask a follow-up any time");
      this.v.board.setLocked(false);
    } else if (this.awaiting || this.lastEnd === "wait") {
      this.v.setStatus("waiting", "Your turn");
      // Narration stopped for the student: they may look back.
      this.v.board.setLocked(false);
      if (!this._warmed) {
        this._warmed = true;
        this._warmFillers();
      }
    }
    else if (this.lastEnd === "continue") this._maybeLookahead();
    else this.v.setStatus("waiting", "");
  }

  togglePause() {
    if (this.paused) {
      this.paused = false;
      this.v.board.setLocked(true);
      this.v.voice.resume();
      this.v.setStatus(this.v.voice.current ? "speaking" : this.gen ? "thinking" : "waiting", "");
      this._run();
    } else {
      this.paused = true;
      this.v.voice.pause();
      this.v.board.setLocked(false);
      this.v.setStatus("paused", "");
    }
  }

  // ----- the student -----
  studentStartedTalking() {
    // Like on a call: the tutor stops to listen.
    this.v.voice.pause();
    this.wasPaused = this.paused;
    this.paused = true;
    this.v.setStatus("listening", "");
  }

  studentStoppedTalking(sent) {
    if (sent) return;
    this.paused = !!this.wasPaused;
    if (!this.paused) {
      this.v.voice.resume();
      this.v.setStatus(this.v.voice.current ? "speaking" : this.gen ? "thinking" : this.awaiting ? "waiting" : "waiting", "");
      this._run();
    } else this.v.setStatus("paused", "");
  }

  // Drops everything not yet heard.
  _interrupt() {
    const wasSpeaking = !!this.speaking || this.queue.some((i) => i.action.type === "say");
    if (this.speaking && this.lastSay) this.lastSay.text += " —";
    this._endReplay(this.replay);
    this.v.voice.stop();
    this.v.voice.cancelPending();
    this.writing = null;
    this.epoch++;
    for (const wake of [...this._sleepers]) wake();
    if (this.gen) window.ml.study.cancel(this.gen.turnId);
    this.gen = null;
    this.queue = [];
    this.lastSay = null;
    this.paused = false;
    this.wasPaused = false;
    this.v.setCaption("");
    return wasSpeaking;
  }

  studentSays(text, via, added = [], names = []) {
    if (this.closed) return;
    const interrupted = this._interrupt();
    if (added.length) this.s.attachments = [...(this.s.attachments || []), ...added];
    const shared = names.length ? ` [shared: ${names.map((n) => n.name).join(", ")}]` : "";
    this.v.addTranscript("you", text, via === "voice" ? "(voice)" : "", names);
    this.s.history.push({ role: "student", text: text + shared, via, ...(names.length ? { files: names } : {}) });
    this.awaiting = null;
    this.s.finished = false;
    this.v.board.scroller.querySelector(".wb-resume")?.remove();
    this.request({ kind: "student", text: text + shared, via, interrupted });
    this._filler();
    if (added.length) this._saveSoon();
  }

  answered(r) {
    if (this.closed) return;
    this._interrupt();
    const text = describeAnswer(r);
    this.s.history.push({ role: "event", text });
    this.v.addTranscript("you", r.kind === "practice" ? `Finished the practice` : `Answered: ${r.answer}`, r.correct === true ? "✓" : r.correct === false ? "✗" : "");
    this.awaiting = null;
    this.request({ kind: "answer", text });
    this._saveSoon();
  }

  explored(r) {
    const text = `The student moved the sliders in ${r.id}: ${Object.entries(r.values).map(([k, v]) => `${k} = ${Math.round(v * 100) / 100}`).join(", ")}`;
    const last = this.s.history[this.s.history.length - 1];
    if (last?.role === "event" && last.text.startsWith(`The student moved the sliders in ${r.id}`)) last.text = text;
    else this.s.history.push({ role: "event", text });
  }

  // A short spoken acknowledgement if the model is slow to start, like a
  // person saying "good question" while they think.
  _filler() {
    clearTimeout(this._fillerTimer);
    const seg = this.gen;
    this._fillerTimer = setTimeout(() => {
      if (this.gen !== seg || !seg || seg.firstAt || this.queue.length || this.v.voice.current) return;
      const text = FILLERS[Math.floor(Math.random() * FILLERS.length)];
      this.filler = this.v.voice.play(this.v.voice.prepare(text, { priority: true }), text).finally(() => (this.filler = null));
    }, 1400);
  }
}
