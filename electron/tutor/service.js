// Live tutor: runs one script segment at a time on the chosen engine and
// streams parsed actions to the renderer as they are written.
import { TUTOR_SYSTEM, buildTurn } from "./prompt.js";
import { createTutorParser } from "./protocol.js";
import path from "node:path";
import { log } from "../logger.js";
import { tutorSessions } from "../store.js";

export function tutorEngineChoice(settings) {
  const engine = settings.tutorEngine || settings.engine || "";
  const model = settings.tutorEngine && settings.tutorModel != null && settings.tutorModel !== ""
    ? settings.tutorModel
    : engine === "api" ? settings.api?.model || "" : settings.models?.[engine] || "";
  return { engine, model };
}

export class TutorService {
  constructor({ engines, getSettings, send }) {
    this.engines = engines;
    this.getSettings = getSettings;
    this.send = send;
    this.turns = new Map(); // turnId -> AbortController
  }

  // req: {turnId, sessionId, topic, history, plan, section, task, learner}
  async turn(req) {
    const { turnId } = req;
    const s = this.getSettings();
    const { engine: engineId, model } = tutorEngineChoice(s);
    if (!engineId || (engineId !== "api" && !s.connected?.[engineId])) throw new Error("Connect an AI account in Settings first.");
    const engine = this.engines.get(engineId);
    const abort = new AbortController();
    this.turns.set(turnId, abort);
    const emit = (p) => this.send("study:event", { turnId, ...p });
    const started = Date.now();
    let firstAt = 0, sawEnd = false, count = 0;
    const parser = createTutorParser((action) => {
      if (action.type === "end") sawEnd = true;
      if (!firstAt) {
        firstAt = Date.now() - started;
        emit({ type: "first", ms: firstAt });
      }
      count++;
      emit({ type: "action", action });
    }, { onUpcoming: (kind) => emit({ type: "upcoming", kind }) });
    // The lesson's shared files: only ones stored with this lesson.
    let files = [];
    try {
      const root = path.resolve(tutorSessions.dir(req.sessionId), "attachments") + path.sep;
      files = (Array.isArray(req.attachments) ? req.attachments : []).filter((f) => typeof f?.path === "string" && path.resolve(f.path).startsWith(root));
    } catch {}
    const images = files.filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.mime || "")).slice(-4);
    const user = buildTurn({ ...req, attachments: files });
    log("info", "tutor.turn", { turnId, engine: engineId, model, task: req.task?.kind, historyItems: req.history?.length || 0, promptChars: user.length });
    try {
      const res = await engine.generate({
        system: TUTOR_SYSTEM,
        user,
        model,
        effort: s.tutorEffort || "low",
        signal: abort.signal,
        onDelta: (d) => parser.feed(d),
        images,
      });
      if (abort.signal.aborted || res?.aborted) {
        emit({ type: "aborted" });
        return { aborted: true };
      }
      parser.end();
      // A segment without an end line: treat as a pause point if it asked
      // something, else continue.
      if (!sawEnd) emit({ type: "action", action: { type: "end", value: "continue", implicit: true } });
      log("info", "tutor.done", { turnId, firstMs: firstAt, totalMs: Date.now() - started, actions: count });
      emit({ type: "done", ms: Date.now() - started, engine: engineId, model });
      return { ok: true };
    } catch (error) {
      if (abort.signal.aborted) {
        emit({ type: "aborted" });
        return { aborted: true };
      }
      log("error", "tutor.failed", { turnId, error });
      emit({ type: "error", message: String(error?.message || error) });
      return { error: String(error?.message || error) };
    } finally {
      this.turns.delete(turnId);
    }
  }

  cancel(turnId) {
    if (turnId) this.turns.get(turnId)?.abort();
    else for (const a of this.turns.values()) a.abort();
    return true;
  }
}
