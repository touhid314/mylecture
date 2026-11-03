import fs from "node:fs";
import path from "node:path";
// Orchestrates a live generation: engine text stream -> scene parser ->
// per-beat speech synthesis -> events to the UI. The player starts as soon as
// scene 1 and its first beat's audio are ready; everything else streams in
// behind playback.
import { systemPrompt, userPrompt, sceneEditPrompt } from "./prompt.js";
import { StreamParser, parseAll } from "./stream-parser.js";
import { lectures, sessions, newId, getSettings } from "./store.js";
import "../app/shared/timeline.js";
import { runLectureGen } from "./lecturegen/run.js";
import { runAgentLecture, runAgentTurn, supportsAgentFlow } from "./lecturegen/agent-run.js";

const TL = globalThis.MLTimeline;

export function sceneUrl(lectureId, file) {
  return `mylecture://app/lib/${encodeURIComponent(lectureId)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

export function audioUrl(key) {
  return key ? `mylecture://app/tts/${key}.wav` : "";
}

function summarize(lec) {
  const text = lec.answer || (lec.scenes || []).flatMap((s) => s.beats.map((b) => b.text)).join(" ");
  return text.length > 420 ? text.slice(0, 420) + "…" : text;
}

export class Generator {
  constructor({ engines, tts, send }) {
    this.engines = engines;
    this.tts = tts;
    this.send = send;
    this.jobs = new Map();
  }

  cancel(jobId) {
    const j = this.jobs.get(jobId);
    if (j) j.abort.abort();
  }

  engineConfig() {
    const s = getSettings();
    const base = this.engines.get(s.engine);
    const engine = base.snapshot?.() || base;
    const model = s.engine === "api" ? s.api.model : s.models?.[s.engine] ?? engine.defaultModel;
    return { engine, model: model || engine.defaultModel || "", settings: s };
  }

  // Study: the original MyLecture LectureGen pipeline, streamed scene by scene.
  startLectureGen(req) {
    const { engine, model, settings: s } = this.engineConfig();
    const jobId = newId("job-");
    const lec = {
      id: newId("lec-"),
      format: "lecturegen-1",
      title: "",
      question: req.question,
      mode: req.mode || "answer",
      aspect: req.aspect || "16:9",
      theme: req.theme || s.lgTheme || "default",
      teachingStyle: req.teachingStyle || s.lgTeachingStyle || "default",
      length: (req.source || "study") === "study" ? null : req.length || s.length,
      source: req.source || "study",
      sessionId: req.sessionId || null,
      engine: engine.id,
      model,
      status: "generating",
      createdAt: new Date().toISOString(),
      scenes: [],
    };
    const voiceEngine = this.tts.activeEngine();
    const abort = new AbortController();
    this.jobs.set(jobId, { id: jobId, lectureId: lec.id, abort });
    const emit = (type, payload = {}) => this.send("gen:event", { jobId, lectureId: lec.id, type, ...payload });
    const t0 = Date.now();
    const logLines = [];
    const log = (m) => logLines.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
    const workspaceDir = lectures.dir(lec.id);
    let reply = "";
    const history = [];
    if (lec.source === "study" && req.sessionId) {
      for (const message of sessions.get(req.sessionId)?.messages || []) {
        if (message.role !== "lecture") continue;
        const previous = lectures.get(message.lectureId);
        if (previous) history.push({ question: previous.question, answer: summarize(previous) });
      }
    }
    emit("started", { lecture: { ...lec }, engine: engine.name, model, voiceEngine });
    if (req.sessionId) attachToSession(req.sessionId, req.question, lec.id, req.mode);
    try {
      lectures.save(lec);
    } catch {}

    (async () => {
      try {
        // CLI agents get one free-form task (answer -> script -> index files);
        // API models run the staged LectureGen pipeline.
        const run = supportsAgentFlow(engine) ? runAgentLecture : runLectureGen;
        log(`Flow: ${run === runAgentLecture ? "agent" : "pipeline"} · ${engine.name}${model ? ` · ${model}` : ""}`);
        const result = await run({
          lec,
          workspaceDir,
          engine,
          model,
          effort: s.codexEffort,
          tts: this.tts,
          voiceEngine,
          history: history.slice(-6),
          signal: abort.signal,
          log,
          emit: (type, payload) => {
            if (type === "answer") {
              lec.answer = payload.text;
              emit("answer", payload);
              if (payload.done) lectures.save(lec);
            } else if (type === "title") {
              lec.title = payload.title;
              emit("title", payload);
            } else if (type === "scene-ready") {
              const sc = payload.scene;
              const index = lec.scenes.length;
              lec.scenes.push(sc);
              const playable = { ...sc, src: sceneUrl(lec.id, sc.file), beats: sc.beats.map((b) => ({ ...b, url: audioUrl(b.audio) })) };
              sc.beats.forEach((b, bi) => b.text && emit("beat", { scene: index, index: bi, text: b.text }));
              emit("scene", { index, scene: playable, elapsed: Date.now() - t0 });
              try {
                lectures.save(lec);
              } catch {}
            } else emit(type, payload);
          },
        });
        if (!lec.title) lec.title = result.title || req.question.slice(0, 60);
        reply = result.reply || "";
        if (!lec.scenes.length) throw new Error(result.failures.length ? `No scene passed validation. ${result.failures[0]}` : "The pipeline produced no scenes.");
        lec.status = result.failures.length ? "partial" : "ready";
        emit("generated", { elapsed: Date.now() - t0 });
      } catch (e) {
        const aborted = e?.aborted || abort.signal.aborted;
        lec.status = lec.scenes.length ? "partial" : "failed";
        if (!lec.title) lec.title = req.question.slice(0, 60);
        emit("error", { message: aborted ? "Stopped" : String(e?.message || e), aborted });
      } finally {
        lec.duration = TL.build(lec.scenes).total;
        try {
          fs.writeFileSync(path.join(workspaceDir, "generation.log"), logLines.join("\n"), "utf8");
        } catch {}
        if (lec.scenes.length) lectures.save(lec);
        else {
          try {
            lectures.save(lec);
          } catch {}
        }
        this.jobs.delete(jobId);
        const playable = { ...lec, scenes: lec.scenes.map((sc) => ({ ...sc, src: sceneUrl(lec.id, sc.file), beats: sc.beats.map((b) => ({ ...b, url: audioUrl(b.audio) })) })) };
        emit("done", { lecture: playable, elapsed: Date.now() - t0, reply });
      }
    })();
    return { jobId, lectureId: lec.id };
  }

  // Create (CLI agents): one conversational turn with the Lecture Agent in a
  // project. The agent decides whether the message needs a new video, changes
  // to this one, or just a reply. New projects are created on the first message.
  startAgentTurn(req) {
    const { engine, model, settings: s } = this.engineConfig();
    const jobId = newId("job-");
    const message = String(req.message || "").trim();
    let lec = req.projectId ? lectures.get(req.projectId) : null;
    if (!lec) {
      lec = {
        id: newId("lec-"),
        format: "lecturegen-1",
        title: "",
        question: message,
        mode: "video",
        aspect: req.aspect || "16:9",
        theme: req.theme || s.lgTheme || "default",
        teachingStyle: req.teachingStyle || s.lgTeachingStyle || "default",
        length: req.length || s.length,
        source: "ide",
        engine: engine.id,
        model,
        createdAt: new Date().toISOString(),
        scenes: [],
      };
    }
    lec.chat ||= [];
    const history = lec.chat.slice(-12);
    lec.chat.push({ role: "user", text: message, at: Date.now() });
    lec.status = "generating";
    lectures.save(lec);
    const abort = new AbortController();
    this.jobs.set(jobId, { id: jobId, lectureId: lec.id, abort });
    const emit = (type, payload = {}) => this.send("gen:event", { jobId, lectureId: lec.id, type, ...payload });
    const t0 = Date.now();
    const logLines = [];
    const log = (m) => logLines.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
    const workspaceDir = lectures.dir(lec.id);
    const voiceEngine = this.tts.activeEngine();
    emit("started", { lecture: { ...lec }, engine: engine.name, model, voiceEngine });

    (async () => {
      let reply = "";
      try {
        const r = await runAgentTurn({
          lec,
          workspaceDir,
          engine,
          model,
          effort: s.codexEffort,
          tts: this.tts,
          voiceEngine,
          signal: abort.signal,
          log,
          message,
          sceneFile: req.sceneFile || null,
          history,
          settings: { length: req.length || lec.length, theme: req.theme ?? lec.theme, teachingStyle: req.teachingStyle ?? lec.teachingStyle },
          emit: (type, payload) => {
            if (type === "scene") {
              const sc = payload.scene;
              emit("scene", { index: payload.index, scene: { ...sc, src: sceneUrl(lec.id, sc.file), beats: sc.beats.map((b) => ({ ...b, url: audioUrl(b.audio) })) } });
            } else if (type === "title") {
              lec.title = payload.title;
              emit("title", payload);
            } else emit(type, payload);
          },
        });
        lec.scenes = r.scenes;
        if (r.title) lec.title = r.title;
        reply = r.reply || "";
        if (r.failures.length) reply += `${reply ? "\n\n" : ""}_${r.failures.length} scene${r.failures.length > 1 ? "s" : ""} could not pass the checks and ${r.failures.length > 1 ? "were" : "was"} left out._`;
        lec.status = r.failures.length ? "partial" : "ready";
      } catch (e) {
        const aborted = e?.aborted || abort.signal.aborted;
        lec.status = lec.scenes.length ? "ready" : "failed";
        emit("error", { message: aborted ? "Stopped" : String(e?.message || e), aborted });
      } finally {
        if (!lec.title) lec.title = (lec.question || message).slice(0, 60);
        if (reply) lec.chat.push({ role: "agent", text: reply, at: Date.now() });
        lec.duration = TL.build(lec.scenes).total;
        try {
          fs.appendFileSync(path.join(workspaceDir, "generation.log"), logLines.join("\n") + "\n", "utf8");
        } catch {}
        lectures.save(lec);
        this.jobs.delete(jobId);
        const playable = { ...lec, scenes: lec.scenes.map((sc) => ({ ...sc, src: sceneUrl(lec.id, sc.file), beats: sc.beats.map((b) => ({ ...b, url: audioUrl(b.audio) })) })) };
        emit("done", { lecture: playable, elapsed: Date.now() - t0, reply });
      }
    })();
    return { jobId, lectureId: lec.id };
  }

  // Start a new lesson. Returns immediately with ids; progress arrives as events.
  start(req) {
    if ((req.source || "study") === "study") return this.startLectureGen(req);
    const { engine, model, settings: s } = this.engineConfig();
    const jobId = newId("job-");
    const aspect = req.aspect || (req.source === "ide" ? s.aspect : "16:9");
    const theme = req.theme || s.theme;
    const teachingStyle = req.teachingStyle || s.teachingStyle || "default";
    const length = req.length || s.length;
    const lec = {
      id: newId("lec-"),
      format: "stream-1",
      title: "",
      question: req.question,
      mode: req.mode || "answer",
      aspect,
      theme,
      teachingStyle,
      length,
      source: req.source || "study",
      sessionId: req.sessionId || null,
      engine: engine.id,
      model,
      status: "generating",
      createdAt: new Date().toISOString(),
      scenes: [],
    };
    // Pin the voice engine for the whole lesson so the voice never changes mid-way.
    const voiceEngine = this.tts.activeEngine();
    const history = [];
    if (req.sessionId) {
      const sess = sessions.get(req.sessionId);
      for (const m of sess?.messages || []) {
        if (m.role === "lecture" && m.lectureId) {
          const l = lectures.get(m.lectureId);
          if (l) history.push({ question: l.question, summary: summarize(l) });
        }
      }
    }
    const abort = new AbortController();
    const job = { id: jobId, lectureId: lec.id, abort };
    this.jobs.set(jobId, job);
    const emit = (type, payload = {}) => this.send("gen:event", { jobId, lectureId: lec.id, type, ...payload });

    const t0 = Date.now();
    const pendingAudio = [];
    const synthBeat = (si, bi) => {
      const beat = lec.scenes[si].beats[bi];
      const p = this.tts
        .synth(beat.text, { engine: voiceEngine })
        .then((r) => {
          beat.audio = r.key;
          beat.dur = r.dur;
          emit("audio", { scene: si, beat: bi, url: audioUrl(r.key), dur: r.dur, key: r.key });
        })
        .catch((e) => {
          emit("audio-error", { scene: si, beat: bi, message: String(e.message || e) });
        });
      pendingAudio.push(p);
    };

    const parser = new StreamParser({
      title: (t) => {
        lec.title = t;
        emit("title", { title: t });
      },
      sceneStart: ({ index, title }) => {
        lec.scenes[index] = { id: `sc${index + 1}`, title, beats: [], html: "", js: "" };
        emit("sceneStart", { index, title, elapsed: Date.now() - t0 });
      },
      beat: ({ scene, index, text }) => {
        lec.scenes[scene].beats[index] = { text };
        emit("beat", { scene, index, text });
        synthBeat(scene, index);
      },
      sceneEnd: ({ index, scene }) => {
        const sc = lec.scenes[index];
        sc.html = scene.html;
        sc.js = scene.js;
        sc.title = scene.title;
        // Parser may have synthesized a fallback beat.
        if (!sc.beats.length) sc.beats = scene.beats.map((b) => ({ text: b.text }));
        emit("scene", { index, scene: sc, elapsed: Date.now() - t0 });
        try {
          lectures.save(lec);
        } catch {}
      },
    });

    emit("started", { lecture: { ...lec }, engine: engine.name, model, voiceEngine });
    if (req.sessionId) attachToSession(req.sessionId, req.question, lec.id, req.mode);

    (async () => {
      let raw = "";
      try {
        const res = await engine.generate({
          system: systemPrompt({ aspect, length, theme, teachingStyle, language: s.language }),
          user: userPrompt({ question: req.question, history, mode: req.mode || (req.source === "ide" ? "video" : "answer"), extra: req.extra || "" }),
          model,
          effort: s.codexEffort,
          signal: abort.signal,
          onDelta: (d) => {
            raw += d;
            parser.push(d);
          },
          onStatus: (st) => emit("status", { message: st }),
        });
        parser.end();
        if (res?.aborted) throw Object.assign(new Error("Stopped"), { aborted: true });
        if (!lec.scenes.length) {
          throw new Error("The AI engine did not return a lesson in the MyLecture format. First output: " + raw.slice(0, 300));
        }
        if (!lec.title) lec.title = lec.scenes[0]?.title || req.question.slice(0, 60);
        emit("generated", { elapsed: Date.now() - t0 });
        await Promise.all(pendingAudio);
        lec.status = "ready";
      } catch (e) {
        parser.end();
        lec.status = lec.scenes.length ? "partial" : "failed";
        if (!lec.title) lec.title = req.question.slice(0, 60);
        await Promise.allSettled(pendingAudio);
        emit("error", { message: e.aborted ? "Stopped" : String(e.message || e), aborted: !!e.aborted });
      } finally {
        lec.scenes = lec.scenes.filter(Boolean);
        lec.duration = TL.build(lec.scenes).total;
        lec.raw = raw.length < 400000 ? raw : undefined;
        if (lec.scenes.length) lectures.save(lec);
        this.jobs.delete(jobId);
        emit("done", { lecture: lec, elapsed: Date.now() - t0 });
      }
    })();

    return { jobId, lectureId: lec.id };
  }

  // Re-synthesize every beat that lacks audio (after edits). Returns lecture.
  async ensureAudio(lec, onProgress) {
    const all = [];
    for (const sc of lec.scenes) for (const b of sc.beats) all.push(b);
    let done = 0;
    for (const b of all) {
      const r = await this.tts.synth(b.text);
      b.audio = r.key;
      b.dur = r.dur;
      onProgress?.(++done / all.length);
    }
    lec.duration = TL.build(lec.scenes).total;
    return lec;
  }

  // IDE: ask the AI to rewrite one scene. Streams, then resolves with scene.
  async editScene({ lectureId, index, instruction, jobId }) {
    const lec = lectures.get(lectureId);
    if (!lec) throw new Error("Lecture not found");
    const { engine, model, settings: s } = this.engineConfig();
    const scene = lec.scenes[index];
    const neighbors = [lec.scenes[index - 1], lec.scenes[index + 1]]
      .filter(Boolean)
      .map((sc) => sc.beats.map((b) => b.text).join(" "))
      .join(" | ");
    const abort = new AbortController();
    const id = jobId || newId("edit-");
    this.jobs.set(id, { id, abort });
    let raw = "";
    try {
      await engine.generate({
        system: systemPrompt({ aspect: lec.aspect, length: "quick", theme: lec.theme, teachingStyle: lec.teachingStyle || s.teachingStyle, language: s.language }),
        user: scene ? sceneEditPrompt({ scene, instruction, aspect: lec.aspect, neighbors }) : `Write ONE new scene (exactly one <ml-scene> block, no <ml-title>) for this lesson. Context: ${neighbors}\nInstruction: ${instruction}`,
        model,
        effort: s.codexEffort,
        signal: abort.signal,
        onDelta: (d) => {
          raw += d;
          this.send("edit:delta", { jobId: id, delta: d });
        },
      });
    } finally {
      this.jobs.delete(id);
    }
    const parsed = parseAll(raw);
    const sc = parsed.scenes[0];
    if (!sc) throw new Error("The AI did not return a scene. Output: " + raw.slice(0, 200));
    const beats = [];
    for (const b of sc.beats) {
      const r = await this.tts.synth(b.text);
      beats.push({ text: b.text, audio: r.key, dur: r.dur });
    }
    return { id: scene?.id || `sc${Date.now()}`, title: sc.title, beats, html: sc.html, js: sc.js };
  }
}

function attachToSession(sessionId, question, lectureId, mode) {
  let s = sessions.get(sessionId);
  if (!s) s = { id: sessionId, title: question.slice(0, 70), createdAt: new Date().toISOString(), messages: [] };
  s.messages.push({ role: "user", text: question, mode, at: new Date().toISOString() });
  s.messages.push({ role: "lecture", lectureId, at: new Date().toISOString() });
  sessions.save(s);
}
