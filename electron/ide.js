// Create tab backend: the MyLecture local IDE workflow inside the app.
// Projects are LectureGen workspaces (answer.md, script.md, index*.html, ...)
// stored in the library. Generation runs the full original pipeline; editing
// mirrors the local IDE: narration clip regeneration, exact on-screen text
// edits, scoped one-scene visual edits, and agent chat edits, each validated
// with the original HTML contract validator before it is kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lectures, getSettings, paths } from "./store.js";
import { lecturegen, withEngine, resolveBeats, readOverrides, resolveStyleResource } from "./lecturegen/run.js";
import { supportsAgentFlow } from "./lecturegen/agent-run.js";
import { audioUrl, sceneUrl } from "./generator.js";
import { exportMp4 } from "./exporter.js";
import "../app/shared/timeline.js";

const TL = globalThis.MLTimeline;
const PROJECT_FILES = /^(answer\.md|script\.md|metadata\.json|narration-edits\.json|generation\.log|index\d*\.html)$/i;

export function hydrateProject(lec) {
  if (!lec) return lec;
  return {
    ...lec,
    scenes: (lec.scenes || []).map((sc) => ({
      ...sc,
      src: sc.kind === "html" && sc.file ? sceneUrl(lec.id, sc.file) : sc.src,
      version: sc.version || 0,
      beats: (sc.beats || []).map((b) => ({ ...b, url: audioUrl(b.audio) })),
    })),
  };
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ---------- helpers ported from mylecture-local-ide/src/ide-server.ts ----------
function escapeHtmlText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function replaceVisibleHtmlText(source, oldText, newText) {
  const encodedOldText = escapeHtmlText(oldText);
  const encodedNewText = escapeHtmlText(newText);
  let replacements = 0;
  const protectedBlocks = source.split(/(<(?:script|style)\b[\s\S]*?<\/(?:script|style)>)/gi);
  const updated = protectedBlocks
    .map((block) => {
      if (/^<(?:script|style)\b/i.test(block)) return block;
      return block.replace(/>([^<]*)</g, (match, textContent) => {
        let nextText = textContent;
        for (const candidate of new Set([oldText, encodedOldText])) {
          if (!candidate) continue;
          const count = nextText.split(candidate).length - 1;
          if (count > 0) {
            nextText = nextText.split(candidate).join(encodedNewText);
            replacements += count;
          }
        }
        return `>${nextText}<`;
      });
    })
    .join("");
  return { source: updated, replacements };
}
function decodeHtmlText(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
function visibleTextCandidatesFromHtml(source) {
  const withoutCode = source.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const candidates = new Set();
  for (const match of withoutCode.matchAll(/>([^<]+)</g)) {
    const text = decodeHtmlText(match[1]).replace(/\s+/g, " ").trim();
    if (text && text.length <= 500) candidates.add(text);
  }
  return [...candidates].sort(naturalSort);
}
function scopedVisualEditorSystemPrompt(targetName) {
  return `You are a tightly scoped MyLecture visual scene editor.

# Scope

- The isolated workspace contains exactly one target file: ${targetName}.
- Read that file once, then apply one or a few small edits tool patches — never rewrite the whole file.
- Change only visual/layout/render code: HTML structure for visuals, CSS, SVG, Canvas, or window.__RENDER_SECTION__ drawing logic.
- Make the smallest sufficient change for the user's request.
- Keep every coordinate in its immediate positioned parent's local coordinate system. Never reuse 1920x1080 stage coordinates inside an inset or reduced-width container; prefer Flexbox/Grid for multi-node rows and verify equal intended edge margins.
- Do NOT edit, regenerate, reformat, or delete window.__VIDEO_METADATA__ or window.__VIDEO_PLAN__. Narration text, audio paths, cue IDs, cue ordering, and timing are immutable — the host discards any change to those blocks.
- For broad requests (e.g. "readd missing visuals"), implement only what existing cues already describe — do not invent new cue IDs or narration.
- Preserve unrelated visual content and timing.
- Do not add new facts, equations, statistics, labels, citations, or other technical content.
- Do not create files or inspect anything outside the target file.
- Do not modify resolved HTML, audio, scripts, or assets.
- The target must retain window.__VIDEO_METADATA__, window.__VIDEO_PLAN__, and window.__RENDER_SECTION__ and pass the HTML contract validator.
- When the edit is complete, provide one short sentence describing it.`;
}

// The app's engines are single-turn text models, so the editor's "edits"
// tool is expressed as the same JSON edits format the animator repair uses.
function editsToolSection(file) {
  return `# Available tools:

edits — reply with exactly one JSON object and nothing else:
{"path":"${file}","edits":[{"lines":[12,14],"new":"replacement text"}]}
Line ranges are inclusive and refer to the line-numbered file in the request. Use [a,b] to replace lines a..b, [a] to insert after line a, and [0] to insert at the top. Every inline <script> block must remain syntactically valid as a classic browser script.`;
}

function lineNumbered(content) {
  return content
    .split(/\r?\n/)
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
}

async function sceneContract(browser, file, viewport) {
  const page = await browser.newPage({ viewport });
  try {
    await page.addInitScript(() => { window.__PLAYER_CONTROLLED__ = true; });
    await page.goto(pathToFileURL(file).href + "?export=1");
    return await page.evaluate(() => JSON.stringify({ metadata: window.__VIDEO_METADATA__, plan: window.__VIDEO_PLAN__ }));
  } finally {
    await page.close();
  }
}

export class IdeService {
  constructor({ engines, tts, send }) {
    this.engines = engines;
    this.tts = tts;
    this.send = send;
    this.job = null; // one IDE job at a time, like the local IDE
  }

  engineConfig() {
    const s = getSettings();
    const selected = this.engines.get(s.engine);
    const engine = selected.snapshot?.() || selected;
    const model = s.engine === "api" ? s.api.model : s.models?.[s.engine] ?? engine.defaultModel;
    return { engine, model: model || engine.defaultModel || "", settings: s };
  }

  log(projectId, text, kind = "log") {
    this.send("ide:log", { projectId, text, kind, at: Date.now() });
  }

  list() {
    return lectures
      .list()
      .map((l) => lectures.get(l.id))
      .filter((l) => l && l.source === "ide" && l.format === "lecturegen-1")
      .map((l) => ({ id: l.id, title: l.title || l.question, question: l.question, createdAt: l.createdAt, updatedAt: l.updatedAt, status: l.status, scenes: (l.scenes || []).length, duration: l.duration || 0, aspect: l.aspect }));
  }

  get(id) {
    const lec = lectures.get(id);
    if (!lec) throw new Error("Project not found");
    return { lecture: hydrateProject(lec), files: this.files(id) };
  }

  files(id) {
    const dir = lectures.dir(id);
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => PROJECT_FILES.test(f));
    } catch {}
    const order = (f) => (/^answer/.test(f) ? 0 : /^script/.test(f) ? 1 : /^index/.test(f) ? 2 : 3);
    names.sort((a, b) => order(a) - order(b) || naturalSort(a, b));
    const out = names.map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtimeMs, url: sceneUrl(id, name) };
    });
    // Rendered MP4s live in the exports folder (so they appear in Library).
    for (const file of lectures.get(id)?.renders || []) {
      if (!fs.existsSync(file)) continue;
      const name = path.basename(file);
      out.push({ name, path: file, size: fs.statSync(file).size, url: `mylecture://app/exports/${encodeURIComponent(name)}` });
    }
    return out;
  }

  readFile(id, name) {
    if (!PROJECT_FILES.test(name)) throw new Error("Not a project file");
    return fs.readFileSync(path.join(lectures.dir(id), name), "utf8");
  }

  remove(id) {
    const lec = lectures.get(id);
    if (lec?.source === "ide") lectures.remove(id);
  }

  _begin(type, projectId) {
    if (this.job) throw new Error(`A ${this.job.type} job is already running.`);
    const abort = new AbortController();
    this.job = { type, projectId, abort };
    this.send("ide:job", { projectId, type, state: "running" });
    return abort;
  }
  _end(projectId, extra = {}) {
    const type = this.job?.type;
    this.job = null;
    this.send("ide:job", { projectId, type, state: "idle", ...extra });
  }
  stop() {
    this.job?.abort.abort();
  }

  // ---------- generation (full original pipeline) ----------
  generate({ question, length = "1:00", aspect = "16:9", theme = "default", teachingStyle = "default" }, generator) {
    if (this.job) throw new Error(`A ${this.job.type} job is already running.`);
    question = String(question || "").trim();
    if (!question) throw new Error("Describe the video to make.");
    const r = generator.startLectureGen({ question, length, aspect, theme, teachingStyle, source: "ide" });
    this.job = { type: "generation", projectId: r.lectureId, jobId: r.jobId, abort: { abort: () => generator.cancel(r.jobId) } };
    this.send("ide:job", { projectId: r.lectureId, type: "generation", state: "running" });
    return r;
  }
  // ---------- chat: every message goes to the Lecture Agent ----------
  // CLI agents: one conversational turn (new video, changes or just a reply).
  // API models keep the staged pipeline: the first message generates, later
  // ones are scene edits.
  async chat({ projectId = null, message, sceneIndex = 0, length, aspect, theme, teachingStyle } = {}, generator) {
    message = String(message || "").trim();
    if (!message) throw new Error("Write a message.");
    if (this.job) throw new Error(`A ${this.job.type} job is already running.`);
    if (supportsAgentFlow(this.engineConfig().engine)) {
      const lec = projectId ? lectures.get(projectId) : null;
      const r = generator.startAgentTurn({ projectId: lec?.id || null, message, sceneFile: lec?.scenes?.[sceneIndex]?.file || null, length, aspect, theme, teachingStyle });
      this.job = { type: "agent", projectId: r.lectureId, jobId: r.jobId, abort: { abort: () => generator.cancel(r.jobId) } };
      this.send("ide:job", { projectId: r.lectureId, type: "agent", state: "running" });
      return { ...r, kind: "job" };
    }
    if (!projectId) return { ...this.generate({ question: message, length, aspect, theme, teachingStyle }, generator), kind: "job" };
    return { kind: "project", project: await this.editScene(projectId, { sceneIndex, instruction: message, scope: "chat" }) };
  }

  generationFinished(lectureId) {
    if ((this.job?.type === "generation" || this.job?.type === "agent") && this.job.projectId === lectureId) this._end(lectureId);
  }

  // ---------- resolve: re-record narration from the current HTML ----------
  async resolve(id, { sceneIndex = null, voice, speed } = {}) {
    const abort = this._begin("resolve", id);
    let browser;
    try {
    const lg = await lecturegen();
    const lec = lectures.get(id);
    const ws = lectures.dir(id);
    browser = await lg.chromium.launch();
      const viewport = lg.viewportForAspectRatio(lec.aspect || "16:9");
      const targets = sceneIndex == null ? lec.scenes.map((_, i) => i) : [sceneIndex];
      for (const i of targets) {
        abort.signal.throwIfAborted();
        const sc = lec.scenes[i];
        this.log(id, `Resolving ${sc.file}…`);
        sc.beats = await resolveBeats({ lg, browser, workspaceDir: ws, file: sc.file, viewport, tts: this.tts, voice, speed });
        sc.version = (sc.version || 0) + 1;
      }
      lec.duration = TL.build(lec.scenes).total;
      lectures.save(lec);
      this.log(id, `Resolved ${targets.length} scene(s).`, "done");
      return this.get(id);
    } finally {
      await browser?.close();
      this._end(id);
    }
  }

  // ---------- narration: edit caption/spoken text, regenerate one clip ----------
  async editNarration(id, { sceneIndex, sectionId, text, ttsText, voice, speed }) {
    text = String(text || "").trim();
    ttsText = String(ttsText || "").trim() || text;
    if (!text) throw new Error("Caption text cannot be empty.");
    const abort = this._begin("narration", id);
    try {
    const lec = lectures.get(id);
    const sc = lec.scenes[sceneIndex];
    const ws = lectures.dir(id);
    const overrides = readOverrides(ws);
    overrides.version = 1;
    overrides.files ||= {};
    (overrides.files[sc.file] ||= {})[sectionId] = { text, ttsText };
    const beat = sc.beats.find((b) => b.segment?.id === sectionId);
    if (!beat) throw new Error("Narration cue not found.");
    const lg = await lecturegen();
    const r = await this.tts.synth(lg.normalizeTtsText(ttsText), { voice, speed });
    abort.signal.throwIfAborted();
    fs.writeFileSync(path.join(ws, "narration-edits.json"), JSON.stringify(overrides, null, 2) + "\n", "utf8");
    Object.assign(beat, { text, ttsText, audio: r.key, dur: r.dur, segment: { ...beat.segment, text, ttsText } });
    lec.duration = TL.build(lec.scenes).total;
    lectures.save(lec);
    this.log(id, `Regenerated narration ${sc.file} · ${sectionId}.`, "done");
    return this.get(id);
    } finally {
      this._end(id);
    }
  }

  // ---------- visual text: exact replacement, no model ----------
  visualCandidates(id, sceneIndex) {
    const lec = lectures.get(id);
    const file = path.join(lectures.dir(id), lec.scenes[sceneIndex].file);
    return visibleTextCandidatesFromHtml(fs.readFileSync(file, "utf8"));
  }
  editVisualText(id, { sceneIndex, oldText, newText }) {
    if (this.job) throw new Error(`A ${this.job.type} job is already running.`);
    oldText = String(oldText || "").trim();
    newText = String(newText || "").trim();
    if (!oldText) throw new Error("Text to replace cannot be empty.");
    const lec = lectures.get(id);
    const sc = lec.scenes[sceneIndex];
    const ws = lectures.dir(id);
    const file = path.join(ws, sc.file);
    const updated = replaceVisibleHtmlText(fs.readFileSync(file, "utf8"), oldText, newText);
    if (updated.replacements === 0) throw new Error("That text was not found in the scene HTML. Choose it from the visible-text list or enter the exact on-screen wording.");
    fs.writeFileSync(file, updated.source, "utf8");
    const scriptPath = path.join(ws, "script.md");
    if (fs.existsSync(scriptPath)) {
      const script = fs.readFileSync(scriptPath, "utf8");
      if (script.includes(oldText)) fs.writeFileSync(scriptPath, script.split(oldText).join(newText), "utf8");
    }
    sc.version = (sc.version || 0) + 1;
    lectures.save(lec);
    this.log(id, `Replaced ${updated.replacements} text occurrence(s) in ${sc.file}.`, "done");
    return this.get(id);
  }

  // ---------- model edits (scoped visual edit or agent chat) ----------
  async editScene(id, { sceneIndex, instruction, scope = "visual" }) {
    instruction = String(instruction || "").trim();
    if (!instruction) throw new Error("Describe the change to make.");
    const abort = this._begin(scope === "visual" ? "visual edit" : "agent edit", id);
    let browser, filePath, original;
    try {
    const lg = await lecturegen();
    const { engine, model, settings: s } = this.engineConfig();
    const lec = lectures.get(id);
    const sc = lec.scenes[sceneIndex];
    if (!sc) throw new Error("Scene not found.");
    const ws = lectures.dir(id);
    filePath = path.join(ws, sc.file);
    original = fs.readFileSync(filePath, "utf8");
    browser = await lg.chromium.launch();
      return await withEngine({ engine, model, effort: s.codexEffort, signal: abort.signal }, async () => {
        const viewport = lg.viewportForAspectRatio(lec.aspect || "16:9");
        const protectedContract = scope === "visual" ? await sceneContract(browser, filePath, viewport) : null;
        const prompts = path.join(path.dirname(fileURLToPath(import.meta.url)), "lecturegen", "src", "prompts");
        const base =
          scope === "visual"
            ? scopedVisualEditorSystemPrompt(sc.file)
            : fs.readFileSync(path.join(prompts, "system_prompt.md"), "utf8").replace(/# Available tools:[\s\S]*?(?=\n# Rules:)/, "");
        const system = lg.build_prompt(`${base}\n\n${editsToolSection(sc.file)}`, ws);
        const user = [
          `Target file: ${sc.file}`,
          "",
          scope === "visual" ? "Requested visual change:" : "Edit request:",
          instruction,
          "",
          `# Current ${sc.file} With Line Numbers`,
          lineNumbered(original),
        ].join("\n");
        this.log(id, `${scope === "visual" ? "Visual edit" : "Agent"} on ${sc.file}: ${instruction}`);
        const response = await globalThis.__ML_LLM__.generate({ system, user, purpose: `ide_${scope}_edit` });
        const edits = lg.parseAnimatorEdits(response, sc.file);
        lg.tool_edits(sc.file, edits, ws);
        let modified = fs.readFileSync(filePath, "utf8");
        if (modified === original) throw new Error("The model completed without changing the scene.");
        if (scope === "visual" && await sceneContract(browser, filePath, viewport) !== protectedContract) {
          throw new Error("The edit changed metadata, narration or timing, which visual edits may not touch.");
        }
        // Validate (and repair) with the original contract validator.
        const input = {
          model: model || "app-engine",
          promptWorkspaceDir: ws,
          request: lec.question,
          aspectRatio: lec.aspect || "16:9",
          generationLength: lec.length || "1:00",
          scriptBlock: "",
          blockIndex: sceneIndex + 1,
          totalBlocks: lec.scenes.length,
          outputPath: sc.file,
          theme: resolveStyleResource(lec.theme, "themes"),
          teachingStyle: resolveStyleResource(lec.teachingStyle, "teaching-styles"),
          assetDescriptions: "",
          previousHtmls: [],
          attachments: [],
        };
        this.log(id, `Validating ${sc.file}…`);
        modified = await lg.validateAndRepairHtml(input, new lg.AnimatorSession(input), ws, modified, (v) => this.log(id, String(v).split("\n")[0]), 2, {
          browser,
          viewport,
          budget: new lg.RepairBudget(undefined, abort.signal),
        });
        abort.signal.throwIfAborted();
        fs.writeFileSync(filePath, modified, "utf8");
        if (scope === "visual" && await sceneContract(browser, filePath, viewport) !== protectedContract) {
          throw new Error("Validation changed metadata, narration or timing; the visual edit was discarded.");
        }
        sc.version = (sc.version || 0) + 1;
        if (scope !== "visual") {
          // Agent edits may change narration: re-resolve this scene.
          sc.beats = await resolveBeats({ lg, browser, workspaceDir: ws, file: sc.file, viewport, tts: this.tts });
          lec.duration = TL.build(lec.scenes).total;
        }
        lectures.save(lec);
        this.log(id, `Saved ${sc.file}.`, "done");
        return this.get(id);
      });
    } catch (e) {
      if (filePath && original !== undefined) fs.writeFileSync(filePath, original, "utf8");
      // Stopped by the user: not an error; nothing was kept.
      if (e?.aborted || abort.signal.aborted) {
        this.log(id, "Stopped. No changes were kept.", "stopped");
        return this.get(id);
      }
      this.log(id, `Edit failed: ${e.message || e}`, "error");
      throw e;
    } finally {
      await browser?.close();
      this._end(id);
    }
  }

  // ---------- render MP4 ----------
  async render(id, { fps = 30, height, captions = false } = {}) {
    const abort = this._begin("render", id);
    try {
      const lec = hydrateProject(lectures.get(id));
      const outDir = paths.exports;
      fs.mkdirSync(outDir, { recursive: true });
      const out = await exportMp4(lec, {
        ttsFile: (key) => this.tts.fileFor(key),
        outDir,
        fps,
        captionsOn: captions,
        height,
        signal: abort.signal,
        onProgress: (p) => this.send("ide:progress", { projectId: id, ...p }),
      });
      const saved = lectures.get(id);
      saved.renders = [...(saved.renders || []), out];
      lectures.save(saved);
      this.log(id, `Rendered ${path.basename(out)}.`, "done");
      return { file: out, files: this.files(id) };
    } finally {
      this._end(id);
    }
  }
}
