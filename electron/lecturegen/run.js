// Runs the ORIGINAL mylecture-agent LectureGen pipeline (bundled verbatim in
// ./src/lecturegen.mjs) inside the app, streaming scenes to the player:
//
//   answer generator -> metadata (parallel) -> script writer (streamed)
//   -> script trimmer (on completed scenes) -> animator (one retained session)
//   -> HTML contract validator + repair -> layout gate -> TTS "resolve"
//   -> scene handed to the player while the next block animates.
//
// The only differences from the server pipeline are transport-level: LLM calls
// go to the engine the user configured, the browser is Electron, narration is
// synthesized with the app's voice, and blocks are cut from the script as its
// scenes finish streaming (instead of after the whole script) so playback can
// start early.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RESOURCES = path.join(here, "resources");

// Same values as the original repository .env.
process.env.SCRIPT_TRIMMER_CHUNK_SIZE ||= "80";
process.env.ANIMATOR_MAX_PREVIOUS_HTMLS ||= "3";
// The repair budget's per-call deadline (8s) assumes a direct API call; app
// engines (CLI agents) need longer just to start.
process.env.LECTUREGEN_REPAIR_TIMEOUT_MS ||= "120000";
process.env.LECTUREGEN_REPAIR_JOB_TIME_MS ||= "600000";

let LG = null;
export async function lecturegen() {
  LG ||= await import("./src/lecturegen.mjs");
  return LG;
}

// ---------- LLM bridge (per job, via async context) ----------
const jobContext = new AsyncLocalStorage();
globalThis.__ML_LLM__ = {
  async generate({ system, user, purpose, signal }) {
    const ctx = jobContext.getStore();
    if (!ctx) throw new Error("No active MyLecture generation.");
    ctx.signal.throwIfAborted();
    const combined = signal ? AbortSignal.any([ctx.signal, signal]) : ctx.signal;
    if (ctx.study) ({ system, user } = studyPrompts({ system, user, purpose, history: ctx.history }));
    let text = "";
    const res = await ctx.engine.generate({
      system,
      user,
      model: ctx.model,
      effort: ctx.effort,
      signal: combined,
      onDelta: (d) => {
        text += d;
        ctx.onDelta?.(purpose, d, text);
      },
      onStatus: (st) => ctx.onStatus?.(purpose, st),
    });
    if (res?.aborted || combined.aborted) throw Object.assign(new Error("Stopped"), { aborted: true });
    return (res && typeof res.text === "string" && res.text.trim() ? res.text : text).trim();
  },
};

// Study is a conversation, so its answer decides the amount of content. Keep
// the original teaching/visual rules, overriding only their video time budget.
export function studyPrompts({ system, user, purpose, history = [] }) {
  if (purpose !== "lecturegen_answer_generator" && purpose !== "lecturegen_script_writer") return { system, user };
  system = system
    .split(/\r?\n/)
    .filter(line => !/^- (?:1 minute of talking|Remember, about 150 words)/.test(line))
    .join("\n");
  user = user.replace(/^Requested Length:.*(?:\r?\n|$)/gm, "");
  if (purpose === "lecturegen_answer_generator") {
    system += "\n\n# Study conversation\nAnswer the user's actual question directly, like a helpful tutor in a conversation. There is no requested duration or word count. Let the question and conversation determine the response length: a simple question may need one sentence; a complex question may need a fuller explanation. Do not pad a short answer or compress a needed explanation to fit a video. Give the answer itself, without introductions about making a lesson, scripts, visuals, narration, duration, or this process.";
    if (history.length) user = "Recent conversation (use only when relevant):\n" + history.map(turn => `User: ${turn.question}\nTutor: ${turn.answer}`).join("\n\n") + "\n\nCurrent " + user;
  } else {
    system += "\n\n# Study answer adaptation\nThe concept explanation is the completed answer already shown to the user. Adapt that answer into synchronized narration and visuals without adding unrelated material or omitting its reasoning. There is no requested duration or word count. Let this answer determine the amount of narration and the video duration. Do not pad or trim it to meet a target runtime.";
  }
  return { system, user };
}

// Run fn with LLM calls routed to the given engine.
export function withEngine({ engine, model, effort, signal, onDelta, onStatus }, fn) {
  return jobContext.run({ engine, model, effort, signal, onDelta, onStatus }, fn);
}

// ---------- catalogs (original resources) ----------
function listCatalog(folder) {
  const dir = path.join(RESOURCES, folder);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const id = f.slice(0, -3);
      const body = fs.readFileSync(path.join(dir, f), "utf8");
      return { id, name: catalogName(id), description: firstLine(body) };
    });
}
const NAMES = {
  default: "Default",
  "3b1b": "3Blue1Brown",
  "fonts-colors": "Fonts & colors",
  "hand-drawn": "Hand-drawn",
  light: "Light",
  none: "None",
  reel: "Reel",
  "sat-tutor": "SAT tutor",
  "stickman-compare": "Stickman compare",
  "thin-line": "Thin-line",
  "middle-school-math": "Middle-school math",
  "research-paper": "Research paper",
};
const catalogName = (id) => NAMES[id] || id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function firstLine(body) {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.replace(/[#*`>{}"]/g, "").trim())
    .find((l) => l && !/^theme$/i.test(l) && !/^teaching style$/i.test(l));
  return (line || "").slice(0, 120);
}
const AUTO_OPTION = { id: "auto", name: "Auto", description: "No preset — the agent decides" };
export function lecturegenCatalog() {
  return { themes: [AUTO_OPTION, ...listCatalog("themes")], teachingStyles: [AUTO_OPTION, ...listCatalog("teaching-styles")] };
}

// Same as lecturegen.ts resolveStyleResource().
export function resolveStyleResource(value, folder, fallbackFile = "default.md") {
  const fallbackPath = path.join(RESOURCES, folder, fallbackFile);
  const readFallback = () => fs.readFileSync(fallbackPath, "utf8").trim();
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return readFallback();
  // "Auto": nothing specific is imposed; the model decides.
  if (trimmed.toLowerCase() === "auto") {
    return folder === "themes"
      ? "No specific visual theme was requested. Choose the visual style that best suits the topic."
      : "No specific teaching style was requested. Teach in the way that best suits the topic.";
  }
  if (trimmed.includes("\n") || trimmed.startsWith("#")) return trimmed;
  const filename = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
  const byId = path.join(RESOURCES, folder, filename);
  if (fs.existsSync(byId) && fs.statSync(byId).isFile()) return fs.readFileSync(byId, "utf8").trim();
  return readFallback();
}

export const GENERATION_LENGTHS = { quick: "1:00", standard: "2:00", deep: "5:00" };
function lengthMinutes(len) {
  const [m, s] = String(len).split(":").map(Number);
  return (m || 0) + (s || 0) / 60;
}

// ---------- streaming script -> blocks ----------
class ScriptBlockStream {
  constructor(lg, onBlock) {
    this.lg = lg;
    this.onBlock = onBlock;
    this.sizes = lg.getScriptTrimmerChunkSizes();
    this.text = "";
    this.consumed = 0; // characters of this.text already turned into blocks
    this.pending = ""; // completed scenes not yet flushed
    this.index = 0;
  }
  push(full) {
    this.text = full;
    // Every "# Scene" header after the consumed point closes the previous scene.
    const rest = this.text.slice(this.consumed);
    const headers = [...rest.matchAll(/^\s*#\s*Scene\b.*$/gim)].map((m) => m.index);
    if (headers.length < 2 && !(headers.length === 1 && headers[0] > 0)) return;
    const closeAt = headers[headers.length - 1];
    if (closeAt <= 0) return;
    // Only consume up to the start of the last (still streaming) scene.
    const completed = rest.slice(0, closeAt);
    this.pending += completed;
    this.consumed += closeAt;
    if (this.lg.countNarrationWords(narrationOf(this.pending)) >= this.sizes.minimumNarrationWords) this._flush();
  }
  end(full) {
    this.text = full;
    this.pending += this.text.slice(this.consumed);
    this.consumed = this.text.length;
    this._flush();
  }
  _flush() {
    const chunk = this.lg.stripImageRequests(this.pending);
    this.pending = "";
    if (!this.lg.countNarrationWords(narrationOf(chunk))) return;
    const blocks = this.lg.trimScriptByNarration(chunk, this.sizes.maximumNarrationWords, this.sizes.minimumNarrationWords);
    for (const b of blocks) this.onBlock({ ...b, index: ++this.index });
  }
}
function narrationOf(script) {
  return script
    .split(/\r?\n/)
    .filter((l) => /^\s*N:/i.test(l))
    .map((l) => l.replace(/^\s*N:\s*/i, ""))
    .join(" ");
}

// ---------- plan extraction ("resolve" step, minus file writing) ----------
export async function readPlan(browser, file, viewport) {
  const page = await browser.newPage({ viewport });
  try {
    await page.addInitScript(() => {
      window.__PLAYER_CONTROLLED__ = true;
    });
    await page.goto(pathToFileURL(file).href + "?export=1", { timeout: 30000 });
    return await page.evaluate(() => JSON.parse(JSON.stringify(window.__VIDEO_PLAN__ || [])));
  } finally {
    await page.close();
  }
}

// "Resolve": read the plan, apply narration overrides (narration-edits.json,
// same shape as the local IDE), synthesize each narration item.
export function readOverrides(workspaceDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceDir, "narration-edits.json"), "utf8"));
  } catch {
    return { version: 1, files: {} };
  }
}
export async function resolveBeats({ lg, browser, workspaceDir, file, viewport, tts, voiceEngine, voice, speed }) {
  const plan = await readPlan(browser, path.join(workspaceDir, file), viewport);
  const overrides = readOverrides(workspaceDir).files?.[file] || {};
  const beats = [];
  for (const raw of plan) {
    if (!raw || !raw.id) continue;
    const o = overrides[raw.id];
    const item = o ? { ...raw, text: o.text || raw.text, ttsText: o.ttsText || raw.ttsText } : raw;
    if (item.kind === "visual-only") {
      beats.push({ text: "", dur: Number(item.duration) || 1, visualOnly: true, segment: item });
    } else {
      const spoken = lg.normalizeTtsText(String(item.ttsText ?? item.text ?? ""));
      const r = await tts.synth(spoken, { engine: voiceEngine, voice, speed });
      beats.push({ text: String(item.text || ""), ttsText: item.ttsText, audio: r.key, dur: r.dur, segment: item });
    }
  }
  return beats;
}

// ---------- the pipeline ----------
export async function runLectureGen({ lec, workspaceDir, engine, model, effort, tts, voiceEngine, signal, emit, log, history = [] }) {
  const lg = await lecturegen();
  const study = lec.source === "study";
  const ctx = { engine, model, effort, signal, study, history, onDelta: null, onStatus: (purpose, st) => log?.(`${purpose}: ${st}`) };
  return jobContext.run(ctx, async () => {
    fs.mkdirSync(workspaceDir, { recursive: true });
    const theme = resolveStyleResource(lec.theme, "themes");
    const teachingStyle = resolveStyleResource(lec.teachingStyle, "teaching-styles");
    const generationLength = study ? "Content-driven; no fixed duration" : GENERATION_LENGTHS[lec.length] || lec.length || "1:00";
    const aspectRatio = lec.aspect || "16:9";
    const common = { model: model || "app-engine", promptWorkspaceDir: workspaceDir };
    const say = (m) => {
      log?.(m);
      emit("status", { message: m });
    };

    // 1. Answer
    say("Writing the explanation…");
    ctx.onDelta = (purpose, _d, text) => {
      if (purpose === "lecturegen_answer_generator") {
        if (study) emit("answer", { text, done: false });
        else emit("progress", { stage: "answer", text: text.slice(-240) });
      }
    };
    const answer = await lg.generateAnswer({ ...common, request: lec.question, generationLength, teachingStyle, attachments: [] });
    fs.writeFileSync(path.join(workspaceDir, "answer.md"), answer, "utf8");
    if (study) emit("answer", { text: answer, done: true });

    // 2. Metadata in parallel.
    const metadataPromise = lg
      .generateMetadata({ ...common, request: lec.question, answer })
      .then((meta) => {
        fs.writeFileSync(path.join(workspaceDir, "metadata.json"), JSON.stringify(meta, null, 2), "utf8");
        if (meta?.title) emit("title", { title: meta.title });
        return meta;
      })
      .catch((e) => {
        log?.(`Metadata generation failed: ${e.message || e}`);
        return null;
      });

    // 3. Script, streamed into blocks.
    const worldBasemapPath = lg.ensureWorldBasemapInWorkspace(workspaceDir);
    const assetDescriptions = [lg.formatWorldBasemapDescription(worldBasemapPath)].filter(Boolean).join("\n");
    const queue = [];
    let scriptDone = false;
    let wake = null;
    const notify = () => {
      wake?.();
      wake = null;
    };
    const stream = new ScriptBlockStream(lg, (block) => {
      queue.push(block);
      // Warm the voice cache with this block's narration.
      for (const t of narrationOf(block.content).length ? block.content.split(/\r?\n/).filter((l) => /^\s*N:/i.test(l)) : []) {
        const text = lg.normalizeTtsText(t.replace(/^\s*N:\s*/i, "").trim());
        if (text) tts.synth(text, { engine: voiceEngine }).catch(() => {});
      }
      notify();
    });
    say("Writing the script…");
    ctx.onDelta = (purpose, _d, text) => {
      if (purpose === "lecturegen_script_writer") {
        try {
          stream.push(text);
        } catch (e) {
          log?.(`Script streaming: ${e.message || e}`);
        }
      }
    };
    const scriptPromise = lg
      .writeScript({ ...common, request: lec.question, generationLength, answer, theme, teachingStyle, enableGetimg: false, attachments: [] })
      .then((script) => {
        script = lg.stripImageRequests(script);
        fs.writeFileSync(path.join(workspaceDir, "script.md"), script, "utf8");
        try {
          lg.validateAudiovisualScript(script);
        } catch (e) {
          log?.(`Script validation: ${e.message || e}`);
        }
        stream.end(script);
        return script;
      })
      .finally(() => {
        scriptDone = true;
        notify();
      });
    // Observe failures now, even while browser startup or animation is pending.
    // The await below still propagates the original error through browser cleanup.
    scriptPromise.catch(() => {});

    // 4-6. Animator loop (one retained session), validation, layout gate, TTS.
    const session = new lg.AnimatorSession(common);
    const budget = new lg.RepairBudget(undefined, signal);
    const browser = await lg.chromium.launch();
    const viewport = lg.viewportForAspectRatio(aspectRatio);
    const estimatedBlocks = Math.max(1, Math.ceil((study ? lg.countNarrationWords(answer) : lengthMinutes(generationLength) * 150) / ((80 + 40) / 2)));
    const completed = [];
    let sceneIndex = 0;
    const failures = [];
    try {
      for (;;) {
        if (!queue.length) {
          if (scriptDone) break;
          await new Promise((r) => (wake = r));
          continue;
        }
        signal.throwIfAborted();
        const block = queue.shift();
        const outputPath = `index${block.index}.html`;
        const totalBlocks = Math.max(estimatedBlocks, block.index + queue.length, scriptDone ? block.index + queue.length : 0);
        const input = {
          ...common,
          request: lec.question,
          aspectRatio,
          generationLength,
          scriptBlock: block.content,
          blockIndex: block.index,
          totalBlocks,
          outputPath,
          theme,
          teachingStyle,
          assetDescriptions,
          previousHtmls: lg.slicePreviousHtmls(completed),
          attachments: [],
        };
        try {
          say(`Animating scene ${block.index}…`);
          ctx.onDelta = (purpose, _d, text) => {
            if (purpose.startsWith("lecturegen_animator_block")) emit("progress", { stage: "animate", scene: block.index, chars: text.length });
          };
          const generatedHtml = await lg.animateScriptBlock(input, session);
          say(`Checking scene ${block.index}…`);
          const contractHtml = await lg.validateAndRepairHtml(
            input,
            session,
            workspaceDir,
            generatedHtml,
            (v) => {
              log?.(v);
              if (!String(v).includes("validation passed")) say(`Repairing scene ${block.index}…`);
            },
            2,
            { browser, viewport, budget },
          );
          let finalHtml = contractHtml;
          if (lg.layoutRepairEnabled()) {
            const layout = await lg.measureAndRepairLayout({ input, workspaceDir, html: contractHtml, viewport, browser, budget, log: (m) => log?.(m) });
            finalHtml = layout.html;
            if (layout.after?.renderErrors) throw new Error(`${outputPath} has runtime errors during layout sampling`);
          }
          fs.writeFileSync(path.join(workspaceDir, outputPath), finalHtml, "utf8");
          completed.push({ path: outputPath, content: finalHtml });

          // Resolve: narration audio + durations for each plan item.
          say(`Recording narration for scene ${block.index}…`);
          const beats = await resolveBeats({ lg, browser, workspaceDir, file: outputPath, viewport, tts, voiceEngine });
          const scene = { id: `sc${block.index}`, kind: "html", file: outputPath, title: firstVisualTitle(block.content) || `Part ${block.index}`, beats };
          emit("scene-ready", { index: sceneIndex++, scene });
        } catch (e) {
          if (e?.aborted || signal.aborted) throw e;
          failures.push(`${outputPath}: ${e.message || e}`);
          log?.(`Scene ${block.index} failed: ${e.stack || e}`);
          emit("status", { message: `Scene ${block.index} could not be validated; continuing…` });
        }
      }
      await scriptPromise;
    } finally {
      await browser.close();
    }
    const meta = await metadataPromise;
    return { title: meta?.title || "", description: meta?.description || "", failures };
  });
}

function firstVisualTitle(content) {
  const m = content.match(/^\s*#\s*Scene\b[^\n]*/im);
  return m ? m[0].replace(/^\s*#\s*/, "").trim() : "";
}
