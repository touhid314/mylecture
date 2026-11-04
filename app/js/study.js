// Study: a chat where every answer is a narrated, animated lesson.
import { renderMarkdown, wireMarkdown } from "./markdown.js";
import { h, icon, fmtTime, fmtDate, toast, popMenu, confirmBox, promptBox, bus } from "./ui.js";
import { Player } from "./player.js";
import { engineLabel } from "./settings.js";
import { UsagePanel } from "./usage.js";
import { AttachmentPicker, attachmentNames } from "./attachments.js";

const SUGGESTIONS = [
  ["How does binary search work?", "Algorithms"],
  ["Why is the sky blue?", "Physics"],
  ["Explain the chain rule with an example", "Calculus"],
  ["What is a transformer in AI?", "Machine learning"],
  ["How does photosynthesis work?", "Biology"],
  ["Explain supply and demand", "Economics"],
  ["What is an eigenvector, intuitively?", "Linear algebra"],
  ["How do vaccines train the immune system?", "Medicine"],
];

const MODE_LABEL = { simpler: "Simpler", deeper: "Go deeper", example: "Worked example", quiz: "Quiz me" };

export class StudyView {
  constructor(root, { state, exportsCenter }) {
    this.root = root;
    this.state = state;
    this.exportsCenter = exportsCenter;
    this.sessionId = null;
    this.cards = new Map(); // lectureId -> card
    this.jobs = new Map(); // jobId -> card
    this.activeJob = null;
    this._build();
    window.ml.gen.onEvent((ev) => this._onGen(ev));
    this.refreshSessions();
    this.refreshEngine();
    bus.on("settings-changed", () => this.refreshEngine());
    bus.on("open-lecture-in-study", (id) => this.openLecture(id));
  }

  _build() {
    this.sessList = h("div", { class: "sessions-list" });
    this.enginePill = h("div", { class: "engine-pill", onclick: () => bus.emit("navigate", { view: "settings" }) });
    this.usage = new UsagePanel({ state: this.state });
    const side = h(
      "aside",
      { class: "sessions" },
      h("div", { class: "sessions-head" }, h("button", { class: "btn primary grow", onclick: () => this.newSession() }, icon("plus"), "New session")),
      this.sessList,
      this.enginePill,
    );
    this.inner = h("div", { class: "chat-inner" });
    this.scroller = h("div", { class: "chat-scroll" }, this.inner);
    this.input = h("textarea", { rows: 1, placeholder: "Ask anything…" });
    this.attachments = new AttachmentPicker(this.input);
    this.input.addEventListener("input", () => this._autosize());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    this.sendBtn = h("button", { class: "send-btn", title: "Send (Enter)", onclick: () => (this.activeJob ? this.stop() : this.send()) }, icon("send"));
    const styles = this.state.info?.styles || { themes: [], teachingStyles: [] };
    const styleSelect = (key, list, title) => {
      const sel = h("select", { class: "select sm", title, onchange: async () => {
        this.state.settings = await window.ml.settings.set({ [key]: sel.value });
        bus.emit("settings-changed", this.state.settings);
      } }, list.map((o) => h("option", { value: o.id, title: o.description }, o.name)));
      sel.value = this.state.settings[key] || list[0]?.id || "";
      return sel;
    };
    this.themeSelect = styleSelect("lgTheme", styles.themes, "Visual theme of the lesson");
    this.teachSelect = styleSelect("lgTeachingStyle", styles.teachingStyles, "Teaching style");
    bus.on("settings-changed", (s) => {
      if (s?.lgTheme) this.themeSelect.value = s.lgTheme;
      if (s?.lgTeachingStyle) this.teachSelect.value = s.lgTeachingStyle;
    });
    const composer = h(
      "div",
      { class: "composer" },
      this.attachments.list,
      h("div", { class: "composer-input-row" }, this.attachments.controls, this.input),
      h("div", { class: "composer-bar" }, this.themeSelect, this.teachSelect, h("div", { class: "grow" }), h("span", { class: "small faint" }, h("kbd", {}, "Enter"), " send · ", h("kbd", {}, "Shift+Enter"), " new line"), this.sendBtn),
    );
    const chat = h("div", { class: "chat", "data-drop-label": "Drop files to attach" }, this.scroller, h("div", { class: "composer-wrap" }, composer, h("div", { class: "composer-note" }, "Lessons are AI-generated and can contain mistakes. Check important facts.")));
    this.attachments.dropTarget(chat);
    this.root.append(side, chat);
    this._welcome();
  }

  _autosize() {
    this.input.style.height = "auto";
    this.input.style.height = Math.min(200, this.input.scrollHeight) + "px";
  }

  onShow() {
    setTimeout(() => this.input.focus(), 30);
  }

  async refreshEngine() {
    const s = this.state.settings;
    this.enginePill.replaceChildren(h("span", { class: "dot warn" }), h("div", { class: "grow" }, h("b", {}, engineLabel(s)), h("span", { class: "muted" }, "Checking…")));
    this.enginePill.querySelector(".grow").appendChild(this.usage.root);
    const st = !s.engine || (s.engine !== "api" && !s.connected?.[s.engine]) ? { ready: false, message: "Connect an account in Settings." } : await window.ml.engines.status(s.engine);
    this.enginePill.replaceChildren(
      h("span", { class: `dot ${st.ready ? "good" : "bad"}` }),
      h("div", { class: "grow" }, h("b", {}, engineLabel(s)), h("span", { class: "muted" }, st.ready ? "Connected · click to change" : st.message || "Not ready")),
    );
    this.engineReady = st.ready;
    this.enginePill.querySelector(".grow").appendChild(this.usage.root);
  }

  // ---------- sessions ----------
  async refreshSessions() {
    const list = await window.ml.sessions.list();
    const groups = {};
    const now = new Date();
    for (const s of list) {
      const d = new Date(s.updatedAt);
      const days = (now - d) / 86400000;
      const g = d.toDateString() === now.toDateString() ? "Today" : days < 7 ? "This week" : days < 31 ? "This month" : "Older";
      (groups[g] ||= []).push(s);
    }
    this.sessList.replaceChildren();
    for (const g of ["Today", "This week", "This month", "Older"]) {
      if (!groups[g]) continue;
      this.sessList.appendChild(h("div", { class: "sess-group" }, g));
      for (const s of groups[g]) {
        const more = h("button", {
          class: "btn ghost sm icon sess-x",
          onclick: (e) => {
            e.stopPropagation();
            popMenu(more, [
              { text: "Rename", icon: "edit", run: async () => {
                const t = await promptBox("Rename session", { value: s.title, okLabel: "Rename" });
                if (t) {
                  await window.ml.sessions.rename(s.id, t);
                  this.refreshSessions();
                }
              } },
              { text: "Delete", icon: "trash", run: async () => {
                if (await confirmBox("Delete session?", "The chat is removed. Its lessons stay in your Library.")) {
                  await window.ml.sessions.remove(s.id);
                  if (this.sessionId === s.id) this.newSession();
                  this.refreshSessions();
                }
              } },
            ]);
          },
        }, icon("more"));
        this.sessList.appendChild(
          h("div", { class: `sess ${s.id === this.sessionId ? "active" : ""}`, onclick: () => this.openSession(s.id), title: s.title }, h("span", { class: "sess-title" }, s.title || "Untitled"), more),
        );
      }
    }
    if (!list.length) this.sessList.appendChild(h("div", { class: "small faint", style: { padding: "10px" } }, "Your study sessions will appear here."));
  }

  _clearChat() {
    for (const c of this.cards.values()) c.player?.destroy();
    this.cards.clear();
    this.inner.replaceChildren();
  }

  newSession() {
    if (this.activeJob) this.stop();
    this.sessionId = null;
    this._clearChat();
    this._welcome();
    this.refreshSessions();
    this.input.focus();
  }

  async openSession(id) {
    if (this.activeJob) this.stop();
    const s = await window.ml.sessions.get(id);
    if (!s) return;
    this.sessionId = id;
    this._clearChat();
    for (const m of s.messages || []) {
      if (m.role === "user") this._userBubble(m.text, m.mode, m.attachments);
      else if (m.role === "lecture") {
        const lec = await window.ml.lectures.get(m.lectureId);
        if (lec) this._lectureCard(lec, { autoplay: false });
        else this.inner.appendChild(h("div", { class: "lec-error" }, "This lesson was deleted from the Library."));
      }
    }
    this.refreshSessions();
    this._scrollBottom();
  }

  async openLecture(id) {
    const lec = await window.ml.lectures.get(id);
    if (!lec) return;
    if (lec.sessionId) {
      await this.openSession(lec.sessionId);
      const c = this.cards.get(id);
      if (c) {
        c.el.scrollIntoView({ behavior: "smooth", block: "center" });
        c.player.play();
      }
      return;
    }
    this.sessionId = null;
    this._clearChat();
    this._userBubble(lec.question || lec.title);
    const c = this._lectureCard(lec, { autoplay: true });
    c.el.scrollIntoView({ block: "center" });
  }

  _welcome() {
    const pick = SUGGESTIONS.slice().sort(() => Math.random() - 0.5).slice(0, 6);
    this.inner.appendChild(
      h(
        "div",
        { class: "welcome" },
        h("img", { src: "assets/lockup.png", alt: "MyLecture" }),
        h("h1", {}, "What do you want to learn?"),
        h("p", {}, "Ask anything. Get an answer right away, then watch the ideas come to life with narrated visuals."),
        h(
          "div",
          { class: "suggest" },
          pick.map(([q, tag]) =>
            h("button", { onclick: () => {
              this.input.value = q;
              this.send();
            } }, h("b", {}, q), h("span", {}, tag)),
          ),
        ),
      ),
    );
  }

  _scrollBottom() {
    requestAnimationFrame(() => (this.scroller.scrollTop = this.scroller.scrollHeight));
  }

  _userBubble(text, mode, attachments = []) {
    this.inner.querySelector(".welcome")?.remove();
    const b = h("div", { class: "msg-user" }, mode && MODE_LABEL[mode] ? h("span", { class: "mode-tag" }, MODE_LABEL[mode]) : null, text, attachmentNames(attachments));
    this.inner.appendChild(b);
    return b;
  }

  // ---------- asking ----------
  async send(mode = "answer", override) {
    const q = (override ?? this.input.value).trim() || (this.attachments.count ? "Explain the attached material." : "");
    if (!q || this.activeJob || this.sending) return;
    this.sending = true;
    this.input.readOnly = true;
    this.attachments.setLocked(true);
    const bubble = this._userBubble(q, mode, this.attachments.names());
    const card = this._lectureCard(null, { live: true, question: q });
    this._scrollBottom();
    this._setBusy(true);
    try {
      if (!this.sessionId) this.sessionId = (await window.ml.sessions.create()).id;
      const attachments = await this.attachments.serialize();
      const { jobId, lectureId } = await window.ml.gen.start({ question: q, mode, sessionId: this.sessionId, source: "study", attachments });
      if (!override) {
        this.input.value = "";
        this._autosize();
      }
      this.attachments.clear();
      card.jobId = jobId;
      card.lectureId = lectureId;
      this.jobs.set(jobId, card);
      this.cards.set(lectureId, card);
      this.activeJob = jobId;
      // Replay buffered events that may have raced the IPC reply.
      for (const ev of this._early.splice(0)) this._onGen(ev);
    } catch (e) {
      bubble.remove();
      card.fail(String(e.message || e));
      this._setBusy(false);
    } finally {
      this.sending = false;
      this.input.readOnly = false;
      this.attachments.setLocked(false);
    }
    setTimeout(() => this.refreshSessions(), 300);
  }
  _early = [];

  stop() {
    if (this.activeJob) window.ml.gen.cancel(this.activeJob);
  }

  _setBusy(b) {
    this.sendBtn.classList.toggle("stop", b);
    this.sendBtn.replaceChildren(icon(b ? "stop" : "send"));
    this.sendBtn.title = b ? "Stop generating" : "Send (Enter)";
    if (!b) this.activeJob = null;
  }

  _onGen(ev) {
    const card = this.jobs.get(ev.jobId);
    if (!card) {
      if (this.activeJob === null && this.sendBtn.classList.contains("stop")) this._early.push(ev);
      return;
    }
    const p = card.player;
    switch (ev.type) {
      case "started":
        card.meta(`MyLecture Engine · voice: ${{ kokoro: "Kokoro", omnivoice: "OmniVoice", system: "system" }[ev.voiceEngine] || ev.voiceEngine}`);
        p.liveStatus("Thinking…", `${ev.engine} is answering`);
        card.meta("Answering…");
        break;
      case "answer":
        card.setAnswer(ev.text);
        card.meta(ev.done ? "Answer ready · preparing visuals…" : "Answering…");
        break;
      case "status":
        p.liveStatus(null, ev.message);
        card.meta(ev.message);
        break;
      case "title":
        card.setTitle(ev.title);
        p.liveStatus(ev.title, "Writing scene 1…");
        break;
      case "sceneStart":
        p.liveStatus(null, `Writing scene ${ev.index + 1}: ${ev.title}`);
        break;
      case "beat":
        if (ev.scene === 0) p.liveLine("“" + ev.text + "”");
        card.addTranscript(ev.scene, ev.index, ev.text);
        break;
      case "scene":
        p.el.style.display = "";
        p.addScene(ev.index, ev.scene);
        card.sceneTitle(ev.index, ev.scene.title);
        if (ev.index === 0) {
          card.firstSceneAt = ev.elapsed;
          if (this.state.settings.autoplay !== false) p.play();
        }
        break;
      case "audio":
        p.setBeatAudio(ev.scene, ev.beat, ev.url, ev.dur);
        break;
      case "audio-error":
        p.setBeatFailed(ev.scene, ev.beat);
        break;
      case "error":
        if (!ev.aborted) card.fail(ev.message);
        else card.meta("Stopped");
        break;
      case "done":
        p.endLive();
        if (!ev.lecture.scenes.length) {
          p.liveStatus("No lesson", "");
          card.player.overlay.classList.add("hidden");
        }
        card.lecture = ev.lecture;
        card.finish(ev);
        this.jobs.delete(ev.jobId);
        this._setBusy(false);
        this.refreshSessions();
        bus.emit("library-changed");
        break;
    }
  }

  // ---------- lesson card ----------
  _lectureCard(lec, { live = false, autoplay = false, question = "" } = {}) {
    const s = this.state.settings;
    const player = new Player({ aspect: lec?.aspect || "16:9", theme: lec?.theme || s.theme, captions: s.captions, rate: s.playbackRate || 1, live, showErrors: false });
    player.on("rate", (r) => window.ml.settings.set({ playbackRate: r }).then((ns) => (this.state.settings = ns)));
    player.on("captions", (c) => window.ml.settings.set({ captions: c }).then((ns) => (this.state.settings = ns)));
    const titleEl = h("div", { class: "lec-title" }, lec?.title || "Answer");
    const metaEl = h("div", { class: "lec-meta" });
    const transcript = h("div", { class: "transcript" });
    const answer = h("div", { class: "study-answer md", role: "article", "aria-label": "Answer", style: { fontSize: "15px", lineHeight: "1.7", color: "var(--fg-2)" } });
    answer.hidden = !lec?.answer;
    answer.replaceChildren(renderMarkdown(lec?.answer || ""));
    wireMarkdown(answer);
    if (live || (lec && !lec.scenes.length)) player.el.style.display = "none";
    const actions = h("div", { class: "lec-actions" });
    const el = h("div", { class: "lec-card" }, h("div", { class: "lec-head" }, titleEl), answer, player.el, actions, transcript);
    this.inner.appendChild(el);
    const tParas = [];

    const card = {
      el,
      player,
      lecture: lec,
      lectureId: lec?.id,
      setAnswer: (text) => {
        const atBottom = this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight < 100;
        answer.replaceChildren(renderMarkdown(text || ""));
        answer.hidden = !text;
        if (atBottom) this._scrollBottom();
      },
      setTitle: (t) => (titleEl.textContent = t),
      meta: (txt) => metaEl.replaceChildren(h("span", {}, txt)),
      sceneTitle: (i, t) => {
        const hd = transcript.querySelector(`h4[data-s="${i}"]`);
        if (hd) hd.textContent = `${i + 1}. ${t}`;
      },
      addTranscript: (si, bi, text) => {
        let hd = transcript.querySelector(`h4[data-s="${si}"]`);
        if (!hd) transcript.appendChild((hd = h("h4", { "data-s": si }, `${si + 1}.`)));
        const p = h("p", { onclick: () => {
          player.seek(player.beatStart(si, bi));
          player.play();
        } }, text);
        tParas.push({ si, bi, p });
        transcript.appendChild(p);
      },
      fail: (msg) => {
        el.insertBefore(h("div", { class: "lec-error" }, friendlyError(msg)), actions);
        if (!player.scenes.length) {
          player.overlay.classList.add("hidden");
          player.el.style.display = "none";
        }
      },
      finish: (ev) => {
        const l = ev.lecture;
        const secs = (ev.elapsed / 1000).toFixed(0);
        const first = card.firstSceneAt ? ` · first scene in ${(card.firstSceneAt / 1000).toFixed(1)}s` : "";
        metaEl.replaceChildren(h("span", {}, l.scenes.length ? `${l.scenes.length} scenes · ${fmtTime(l.duration)} · written in ${secs}s${first}` : l.answer ? "Answer ready · visuals not completed" : "No answer was produced"));
        if (l.scenes.length || l.answer) buildActions();
      },
    };

    player.on("position", (loc) => {
      for (const t of tParas) t.p.classList.toggle("now", !!loc && t.si === loc.scene && t.bi === loc.beat);
    });

    const chip = (label, mode, ic) => h("button", { class: "chip", onclick: () => this.send(mode, followText(mode, card.lecture?.title)) }, ic ? icon(ic) : null, label);
    const buildActions = () => {
      const moreBtn = h("button", { class: "btn ghost sm icon", title: "More", onclick: () => popMenu(moreBtn, [
        ...(card.lecture.scenes.length ? [{ label: "Export" },
        { text: "Export MP4 video (1080p)", icon: "film", run: () => this.exportsCenter.start(card.lecture.id, "mp4", { title: card.lecture.title }) },
        { text: "Export interactive HTML", icon: "share", run: () => this.exportsCenter.start(card.lecture.id, "html", { title: card.lecture.title }) },
        { text: "Export captions (.srt)", icon: "text", run: () => this.exportsCenter.start(card.lecture.id, "srt", { title: card.lecture.title }) },
        "-"] : []),
        { text: card.lecture.answer ? "Copy answer" : "Copy transcript", icon: "copy", run: () => {
          const txt = card.lecture.answer || card.lecture.scenes.map((s) => s.beats.map((b) => b.text).join(" ")).join("\n\n");
          navigator.clipboard.writeText(`${card.lecture.title}\n\n${txt}`);
          toast("Transcript copied", { kind: "good", timeout: 2000 });
        } },
        { text: "Regenerate", icon: "refresh", run: () => this.send("answer", card.lecture.question) },
      ]) }, icon("more"));
      actions.replaceChildren(...[
        chip("Simpler", "simpler"),
        chip("Go deeper", "deeper"),
        chip("Worked example", "example"),
        chip("Quiz me", "quiz"),
        h("div", { class: "grow" }),
        metaEl,
        card.lecture.scenes.length ? h("button", { class: "btn ghost sm", title: "Show transcript", onclick: () => transcript.classList.toggle("on") }, icon("text"), "Transcript") : null,
        card.lecture.scenes.length ? h("button", { class: "btn ghost sm", title: "Edit this lesson as a video in Create", onclick: () => bus.emit("navigate", { view: "create", lectureId: card.lecture.id }) }, icon("film"), "Edit as video") : null,
        moreBtn,
      ].filter(Boolean));
    };

    if (lec) {
      player.setLecture(lec);
      lec.scenes.forEach((sc, si) => sc.beats.forEach((b, bi) => card.addTranscript(si, bi, b.text)));
      lec.scenes.forEach((sc, si) => card.sceneTitle(si, sc.title));
      metaEl.replaceChildren(h("span", {}, lec.scenes.length ? `${lec.scenes.length} scenes · ${fmtTime(lec.duration)} · ${fmtDate(lec.createdAt)}` : `Answer saved · ${fmtDate(lec.createdAt)}`));
      buildActions();
      if (lec.status === "partial") actions.prepend(h("span", { class: "badge warn" }, "Partial"));
      if (autoplay) player.play();
    } else {
      actions.appendChild(metaEl);
      card.meta(question ? "Starting…" : "");
    }
    if (lec) this.cards.set(lec.id, card);
    return card;
  }
}

function followText(mode, title) {
  const t = title ? ` (${title})` : "";
  return {
    simpler: `Explain that more simply${t}`,
    deeper: `Go deeper on that${t}`,
    example: `Show me a worked example${t}`,
    quiz: `Quiz me on that${t}`,
  }[mode];
}

function friendlyError(msg) {
  msg = String(msg || "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  if (/not installed|not found on PATH/i.test(msg)) return msg + "\nOpen Settings to choose another AI engine.";
  if (/auth|login|sign in|401|403|unauthor/i.test(msg)) return msg + "\nSign in to the engine (or check your API key) in Settings.";
  if (/quota|rate|429|exhaust/i.test(msg)) return msg + "\nThe engine is rate-limited. Wait a moment or switch models in Settings.";
  return msg;
}
