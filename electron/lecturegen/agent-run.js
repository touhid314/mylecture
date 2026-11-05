// Agent flow for CLI agents (Codex, Claude, Antigravity).
//
// Instead of the staged LectureGen pipeline (answer generator -> script writer
// -> trimmer -> animator -> JSON repair), the agent gets ONE task and works in
// the project folder itself:
//
//   answer.md -> script.md -> index1.html, index2.html, ... (+ metadata.json)
//
// Theme and teaching style are passed along unless they are "auto", in which
// case the agent decides. The app watches the folder: once index{N+1}.html
// appears (or the agent finishes), index{N}.html is validated against the
// HTML contract, narrated, and handed to the player. Files that fail the
// contract go back to the same agent once, with the validator output.
import fs from "node:fs";
import { attachmentContext } from "../attachments.js";
import path from "node:path";
import { createRequire } from "node:module";
import { Activity } from "../activity.js";
import { IDLE_STATUS } from "../engines/cli-util.js";
import { lecturegen, resolveBeats, isResolvedScene, resolveStyleResource, RESOURCES, GENERATION_LENGTHS } from "./run.js";
import { writePlaybackSnapshot } from "../scene-readiness.js";

export const AUTO = "auto";
const isAuto = (v) => String(v || "").trim().toLowerCase() === AUTO;
const INDEX_RE = /^index(\d+)\.html$/i;

export function supportsAgentFlow(engine) {
  return engine?.kind === "cli" && typeof engine.agent === "function";
}

// Agents have full tools (shell, web, downloads). Media lives in the project
// folder so the video plays and exports offline; music is declared in
// metadata.json and played as-is by the app (see electron/music.js).
// MyLecture's bundled ffmpeg, so agents can edit media without installing it.
const FFMPEG = (() => {
  try {
    const p = createRequire(import.meta.url)("ffmpeg-static");
    return p && p.includes("app.asar") ? p.replace("app.asar", "app.asar.unpacked") : p || "";
  } catch {
    return "";
  }
})();

export const MEDIA_RULES = [
  "# Tools, media and music",
  "- You have full tool access: shell commands, the internet (web search, fetching pages, downloading files), subagents and file tools. You may read and copy files from anywhere on this computer. Every file you create, download, copy, edit or delete yourself must be inside this project folder; never put your own files anywhere else. Installing tools or packages (pip, npm, uv, winget, Playwright browsers, etc.) is allowed, and so are the caches, temp files and install folders those tools write to on their own.",
  "- Use real media whenever it makes the video better: photos of people and places, logos, maps, screenshots, historical images, fonts, music. Find them on the web, or take them from the user's attachments (Word, PowerPoint and Excel files are zip archives: a .docx keeps its images in word/media/, a .pptx in ppt/media/; extract them).",
  "- Save every asset inside this folder under media/ (for example media/portrait.jpg) and reference it with a relative path (src=\"media/portrait.jpg\"). Do not hot-link remote URLs: the video must play and export offline. Check that each download is the real file (not an HTML error page) and that it has the right extension.",
  "- Prefer public-domain or openly licensed material (Wikimedia Commons, official press kits, Pixabay, Free Music Archive, Incompetech and similar) and list each asset's source and licence in media/CREDITS.md.",
  "- Background music: you are in full control of it. Prepare the final track yourself with ffmpeg (volume relative to the narration, fades, trimming or looping to the video length, any edits), save it in media/ and declare it in metadata.json as \"music\": \"media/music.mp3\". The app plays that file exactly as it is from the start of the video, in the player and in every export: it changes nothing (no volume change, fades, ducking or looping). Narration is recorded by the app at about -24 LUFS, so a background track usually sits around -36 to -32 LUFS. Leave the key out for no music.",
  "- Video clips (the user's or downloaded): put them in a scene as <video src=\"attachments/…\" muted playsinline></video> and show, move or fade the element in renderSection. The app keeps every <video> in sync with the scene clock in the player and in exports; add data-ml-start=\"2\" to start a clip 2 seconds into the scene. Do not set currentTime yourself. Browsers play MP4 (H.264) and WebM: convert other formats first.",
  "- Scene HTML must not play sound itself (no <audio>, no unmuted <video>): narration and music are mixed by the app. To use a clip's own sound, extract it with ffmpeg and use it as the music track.",
  ...(FFMPEG ? [`- ffmpeg is bundled with MyLecture at ${FFMPEG}: use it to trim, crop, convert, extract frames or audio, and make GIFs or thumbnails.`] : []),
];

function assetSection(assets) {
  return assets ? ["", "# Bundled assets (already in this project folder)", assets] : [];
}

// MyLecture's bundled assets, copied into the project: the Natural Earth
// world basemap (with its lon/lat projection helpers) for map animations.
export function bundledAssets(lg, workspaceDir, log) {
  try {
    const map = lg.ensureWorldBasemapInWorkspace(workspaceDir);
    return [
      lg.formatWorldBasemapDescription(map),
      "  The basemap is land only. For country borders, states, rivers or more detail, download Natural Earth or similar public-domain GeoJSON into media/ and draw it with the same projectLonLat helpers so it lines up with the basemap.",
    ].join("\n");
  } catch (e) {
    log?.(`World basemap unavailable: ${e.message || e}`);
    return "";
  }
}

function contractText() {
  try {
    return fs.readFileSync(path.join(RESOURCES, "contracts", "html-input-contract.md"), "utf8").trim();
  } catch {
    return "";
  }
}

function stageSize(aspect) {
  if (aspect === "9:16") return "1080×1920";
  if (aspect === "1:1") return "1080×1080";
  return "1920×1080";
}

function lengthText(length) {
  const v = GENERATION_LENGTHS[length] || length || "1:00";
  const [m, s] = String(v).split(":").map(Number);
  const secs = (m || 0) * 60 + (s || 0);
  const words = Math.max(30, Math.round((secs / 60) * 150));
  return `${v} (about ${words} words of narration; ~150 spoken words per minute)`;
}

// The single task given to the agent. Kept short on purpose: the agent has
// room to decide structure, pacing, scene count and visual design.
export function agentTaskPrompt({ question, length, aspect = "16:9", theme, teachingStyle, study = false, history = [], assets = "" }) {
  const lines = [
    "You are making a narrated, animated explainer video for MyLecture.",
    "Work directly in the current folder (it is this video's project folder) using your tools. Create the files in this order:",
    "",
    "1. answer.md — the explanation itself, written in plain prose.",
    "2. script.md — the narration script, organised into scenes, with what is said and what is shown.",
    "3. index1.html, index2.html, … — one self-contained HTML animation per scene, in order. Finish each file completely before starting the next one: the app starts playing a scene as soon as the next file appears.",
    "4. metadata.json — {\"title\": \"…\", \"description\": \"…\"} for the video (plus \"music\" when it has a soundtrack, see below).",
    "",
    "Everything else — how many scenes, pacing, structure, visual design, analogies — is your call. Make it clear, accurate and visually rich.",
    "",
    "# Request",
    question,
    "",
    "# Settings",
    study
      ? "- Length: no fixed duration. Answer the question directly like a tutor; let the question decide how long the explanation is. answer.md is shown to the user as the reply, so write it as a direct answer (no talk about videos, scripts or narration)."
      : `- Target length: ${lengthText(length)}.`,
    `- Aspect ratio: ${aspect} (stage ${stageSize(aspect)}).`,
  ];
  if (isAuto(theme)) lines.push("- Visual theme: your choice.");
  if (isAuto(teachingStyle)) lines.push("- Teaching style: your choice.");
  if (history.length) {
    lines.push("", "# Earlier in this conversation (use only if relevant)");
    for (const t of history) lines.push(`User: ${t.question}`, `Tutor: ${t.answer}`, "");
  }
  if (!isAuto(teachingStyle)) lines.push("", "# Teaching style", resolveStyleResource(teachingStyle, "teaching-styles"));
  if (!isAuto(theme)) lines.push("", "# Visual theme", resolveStyleResource(theme, "themes"));
  lines.push(
    "",
    "# Scene HTML requirements (the player depends on these)",
    `- Each index file is a complete HTML document: body fixed at ${stageSize(aspect)}, margin 0, overflow hidden, no scrollbars, no playback controls, no subtitles.`,
    "- Narration lives inside the HTML as narration+visual plan items; their `text` is spoken exactly as written. The app records the audio itself, so just use audio paths like \"audio/i1.wav\" (ids i1, i2, … per file).",
    "- All motion is computed inside renderSection(segment, localTime, globalTime): deterministic, no CSS animations/transitions, timers, requestAnimationFrame loops, Date or Math.random.",
    "- Render one initial frame on load (renderSection(plan[0], 0, 0)). Support the ?export=1 query (it must not break anything).",
    "- Math may use KaTeX markup if helpful.",
    "",
    ...MEDIA_RULES,
    ...assetSection(assets),
    "",
    contractText(),
    "",
    "When you are done, reply with one short sentence.",
  );
  return lines.join("\n");
}

function fixTaskPrompt(problems) {
  return [
    "Some scene files in the current folder fail the MyLecture HTML contract validator. Fix them in place, keeping their content, narration and visual intent. Change only what is needed.",
    "",
    ...problems.map((p) => `## ${p.file}\n${p.validation}`),
    "",
    "# HTML contract",
    contractText(),
    "",
    "When you are done, reply with one short sentence.",
  ].join("\n");
}

export function indexFiles(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => INDEX_RE.test(f));
  } catch {}
  return names.sort((a, b) => Number(a.match(INDEX_RE)[1]) - Number(b.match(INDEX_RE)[1]));
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function sceneTitle(html, n) {
  const m = html && html.match(/title\s*:\s*["'`]([^"'`]{1,120})["'`]/);
  return m ? m[1] : `Scene ${n}`;
}

// Run one agent task in the workspace.
// `activity` collects the agent's words and tool steps; the return value is
// the agent's last message (its final answer).
const WORKER_SYSTEM = "You are a skilled educator, script writer and creative coder working on a MyLecture video project. Work autonomously with all your tools (shell, web, downloads, files); never ask questions.";
export async function runAgent({ engine, model, effort, signal, workspace, prompt, onStatus, onModel, activity, inbox, system = WORKER_SYSTEM }) {
  let text = "";
  let phase = "Working…";
  if (inbox) inbox.onDelivered = (t) => activity?.user(t);
  const res = await engine.agent({
    inbox,
    system,
    user: prompt,
    model,
    effort,
    signal,
    workspace,
    onModel,
    onDelta: (d) => { text += d; phase = "Generating…"; },
    onStatus: status => {
      if (!IDLE_STATUS.test(status)) {
        phase = /think|reason/i.test(status) ? "Thinking…"
          : /writ|edit|fileChange|agent_response/i.test(status) ? "Generating…" : "Working…";
        return onStatus?.(status);
      }
      onStatus?.(phase);
      activity?.step("💭", phase);
    },
    onActivity: (ev) => {
      if (ev?.type === "say") phase = "Generating…";
      else if (ev?.type === "step") phase = ev.icon === "💭" ? "Thinking…"
        : ev.icon === "✏️" ? "Generating…" : "Working…";
      activity?.feed(ev);
    },
  });
  if (res?.aborted || signal?.aborted) throw Object.assign(new Error("Stopped"), { aborted: true });
  return (activity?.lastSay() || res?.text || text).trim();
}

async function validate(lg, browser, workspaceDir, file, viewport, html = readText(path.join(workspaceDir, file))) {
  if (!html || !/<\/html>\s*$/i.test(html.trim())) return `HTML contract validation failed for ${file}:\n - The file is incomplete (no closing </html>).`;
  const snapshot = writePlaybackSnapshot(workspaceDir, file, html);
  return String(await lg.validateHtmlInBrowser(snapshot, workspaceDir, browser, viewport)).replaceAll(snapshot, file);
}

export async function runAgentLecture({ lec, workspaceDir, engine, model, effort, tts, voiceEngine, signal, emit, log, history = [], inbox }) {
  const lg = await lecturegen();
  const study = lec.source === "study";
  fs.mkdirSync(workspaceDir, { recursive: true });
  const aspect = lec.aspect || "16:9";
  const viewport = lg.viewportForAspectRatio(aspect);
  const activity = new Activity((items) => emit("activity", { items }));
  const say = (m) => {
    log?.(m);
    activity.app(m);
    emit("status", { message: m });
  };
  const failures = [];
  let title = "";
  let description = "";
  let modelUsed = "";
  const seen = { answer: null, script: null, meta: null };
  const emitted = new Set();
  const failed = new Map(); // file -> { html, validation }
  let sceneIndex = 0;
  let agentDone = false;
  let busy = false;
  const browser = await lg.chromium.launch();

  const readMeta = () => {
    const raw = readText(path.join(workspaceDir, "metadata.json"));
    if (!raw || raw === seen.meta) return;
    seen.meta = raw;
    try {
      const m = JSON.parse(raw);
      if (m.title && m.title !== title) {
        title = String(m.title);
        emit("title", { title });
      }
      description = String(m.description || "");
    } catch {}
  };

  // Look at the folder: surface new answer/script, and hand completed scenes
  // to the player in order.
  const scan = async ({ final = false } = {}) => {
    if (busy) return;
    busy = true;
    try {
      const answer = readText(path.join(workspaceDir, "answer.md"));
      if (answer && answer !== seen.answer) {
        seen.answer = answer;
        if (study) emit("answer", { text: answer.trim(), done: true });
        else emit("progress", { stage: "answer", text: answer.slice(-240) });
        say("Wrote answer.md");
      }
      const script = readText(path.join(workspaceDir, "script.md"));
      if (script && script !== seen.script) {
        if (seen.script == null) say("Wrote script.md");
        seen.script = script;
      }
      readMeta();
      const files = indexFiles(workspaceDir);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (emitted.has(file)) continue;
        const complete = agentDone || i < files.length - 1;
        if (!complete) break;
        const html = readText(path.join(workspaceDir, file));
        let validation = failed.get(file)?.html === html ? failed.get(file).validation : null;
        if (validation == null) {
          say(`Checking ${file}…`);
          validation = await validate(lg, browser, workspaceDir, file, viewport, html);
        }
        if (!String(validation).includes("validation passed")) {
          failed.set(file, { html, validation, phase: failed.get(file)?.html === html ? failed.get(file).phase : undefined });
          log?.(validation);
          // Keep scene order: later scenes wait until this one is fixed,
          // except on the final pass, where a broken scene is skipped.
          if (!final) break;
          continue;
        }
        failed.delete(file);
        say(`Recording narration for ${file}…`);
        let beats;
        const playbackFile = writePlaybackSnapshot(workspaceDir, file, html);
        try {
          beats = await resolveBeats({ lg, browser, workspaceDir, file: playbackFile, sourceFile: file, viewport, tts, voiceEngine });
        } catch (e) {
          if (e?.aborted || signal.aborted) throw e;
          failed.set(file, { html, validation: `Narration failed: ${e.message || e}`, phase: "narration" });
          log?.(`${file}: Narration failed: ${e.message || e}`);
          if (!final) break;
          continue;
        }
        const n = Number(file.match(INDEX_RE)[1]);
        const scene = { id: `sc${n}`, kind: "html", file, playbackFile, title: sceneTitle(html, n), beats };
        emitted.add(file);
        emit("scene-ready", { index: sceneIndex++, scene });
      }
    } finally {
      busy = false;
    }
  };

  let timer = null;
  let scanning = Promise.resolve();
  const tick = () => {
    scanning = scanning.then(scan).catch((e) => log?.(`Scan: ${e.stack || e}`));
  };
  try {
    timer = setInterval(tick, 1200);
    const reply = await runAgent({ inbox,
      engine,
      model,
      effort,
      signal,
      workspace: workspaceDir,
      prompt: agentTaskPrompt({ question: lec.question, length: lec.length, aspect, theme: lec.theme, teachingStyle: lec.teachingStyle, study, history, assets: bundledAssets(lg, workspaceDir, log) }) + "\n\n" + attachmentContext(lec.attachments),
      onModel: (m) => { modelUsed = m; },
      activity,
      onStatus: (st) => {
        log?.(st);
        if (/^agent: editing /.test(st)) emit("status", { message: st.replace(/^agent: editing/, "Writing") });
      },
    });
    activity.takeFinal();
    log?.(`Agent: ${reply}`);
    clearInterval(timer);
    timer = null;
    await scanning;
    agentDone = true;
    await scan();

    // Check every remaining scene, then give the failures back to the agent once.
    for (const file of indexFiles(workspaceDir)) {
      if (emitted.has(file) || failed.has(file)) continue;
      const html = readText(path.join(workspaceDir, file));
      const validation = await validate(lg, browser, workspaceDir, file, viewport, html);
      if (!String(validation).includes("validation passed")) failed.set(file, { html, validation });
    }
    const problems = [...failed].filter(([, f]) => f.phase !== "narration").map(([file, f]) => ({ file, validation: f.validation }));
    if (problems.length && !signal.aborted) {
      say(`Asking ${engine.name} to fix ${problems.map((p) => p.file).join(", ")}…`);
      await runAgent({ inbox, engine, model, effort, signal, workspace: workspaceDir, prompt: fixTaskPrompt(problems), activity, onStatus: (st) => log?.(st) });
    }
    await scan({ final: true });
    for (const [file, f] of failed) failures.push(`${file}: ${f.validation}`);
    if (!indexFiles(workspaceDir).length) {
      throw new Error(`${engine.name} finished without writing any index*.html scene files.${reply ? ` It said: ${reply.slice(0, 300)}` : ""}`);
    }
    if (study && !seen.answer) emit("answer", { text: reply, done: true });
    readMeta();
    activity.flush();
    return { title, description, failures, reply, model: modelUsed, activity: activity.items };
  } finally {
    if (timer) clearInterval(timer);
    await scanning.catch(() => {});
    await browser.close();
  }
}

// ---------- Video Agent: one conversation per project ----------
// Every message goes to the agent with a standing brief (make MyLecture
// videos with the workflow and the HTML contract), the project's current
// state and the conversation so far. The agent decides what the message
// needs: a new video, changes to this one, or just a reply.

export const LECTURE_AGENT_SYSTEM = [
  "You are the MyLecture Video Agent: a world-class teacher, storyteller, script writer, motion designer and creative coder.",
  "Your main job is to make narrated, animated videos of any kind on the user's request — lessons and explainers, how-it-works pieces, product demos, stories, announcements, social shorts — and to change them when asked, by working on the files of the video project in the current folder.",
  "You are also a conversation partner: when a message is a question, a discussion or feedback that needs no change, just reply. Do not touch files unless the message calls for it.",
  "Work autonomously with all your tools: shell, web search, downloads and files. Never tell the user you cannot download or fetch something — do it. Ask the user only when a request is truly ambiguous.",
  "When a video is finished, end your reply with a short, friendly invitation such as \"What video do you want to make next?\" or \"What do you want to teach next?\". When the user just greets you or seems unsure, invite them the same way and offer a few ideas.",
  "Do not mention the project's files or artifacts (answer.md, script.md, index*.html, metadata.json, file paths) in your replies unless the user explicitly asks about them. Talk about the video, its scenes and its content instead (\"scene 2\", not \"index2.html\").",
].join("\n");

function videoRequirements({ length, aspect = "16:9", theme, teachingStyle }) {
  const lines = [
    "# Settings for new videos",
    `- Target length: ${lengthText(length)}.`,
    `- Aspect ratio: ${aspect} (stage ${stageSize(aspect)}).`,
  ];
  if (isAuto(theme)) lines.push("- Visual theme: your choice.");
  if (isAuto(teachingStyle)) lines.push("- Teaching style: your choice.");
  if (!isAuto(teachingStyle)) lines.push("", "# Teaching style", resolveStyleResource(teachingStyle, "teaching-styles"));
  if (!isAuto(theme)) lines.push("", "# Visual theme", resolveStyleResource(theme, "themes"));
  return lines;
}

export function agentTurnPrompt({ message, files = [], sceneFile, history = [], length, aspect = "16:9", theme, teachingStyle, assets = "" }) {
  const lines = [
    "# MyLecture workflow",
    "A video is a project folder (the current folder). To make a new video, create these files in order:",
    "1. answer.md — the explanation itself, in plain prose.",
    "2. script.md — the narration script, organised into scenes, with what is said and what is shown.",
    "3. index1.html, index2.html, … — one self-contained HTML animation per scene, in play order. Finish each file completely before starting the next one: the app starts playing a scene as soon as the next file appears.",
    "4. metadata.json — {\"title\": \"…\", \"description\": \"…\"} (plus \"music\" when it has a soundtrack, see below).",
    "To change a video, edit the files directly. You may add, remove or reorder scenes; keep index files numbered 1..N without gaps, and keep script.md in sync with narration changes.",
    "Everything else — scene count, pacing, structure, visual design, analogies — is your call. Make it clear, accurate and visually rich.",
    "The app checks every new or changed scene against the HTML contract, records the narration with its own voice, and plays it.",
    "",
    "# This project",
    files.length ? `Files: ${files.join(", ")}.` : "Empty: no video yet.",
    sceneFile ? `The user is currently looking at ${sceneFile}.` : "",
    "",
    ...videoRequirements({ length, aspect, theme, teachingStyle }),
    "",
    "# Scene HTML requirements (the player depends on these)",
    `- Each index file is a complete HTML document: body fixed at ${stageSize(aspect)}, margin 0, overflow hidden, no scrollbars, no playback controls, no subtitles.`,
    "- Narration lives inside the HTML as narration+visual plan items; their `text` is spoken exactly as written. The app records the audio itself, so just use audio paths like \"audio/i1.wav\" (ids i1, i2, … per file).",
    "- All motion is computed inside renderSection(segment, localTime, globalTime): deterministic, no CSS animations/transitions, timers, requestAnimationFrame loops, Date or Math.random.",
    "- Render one initial frame on load (renderSection(plan[0], 0, 0)). Support the ?export=1 query (it must not break anything).",
    "- Math may use KaTeX markup if helpful.",
    "",
    ...MEDIA_RULES,
    ...assetSection(assets),
    "",
    contractText(),
  ];
  if (history.length) {
    lines.push("", "# Conversation so far");
    for (const m of history) lines.push(`${m.role === "user" ? "User" : "You"}: ${String(m.text || "").slice(0, 1500)}`, "");
  }
  lines.push("", "# The user's message", message, "", "End your turn with a short reply to the user (Markdown is fine).");
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

// One turn. Streams new/changed scenes to the player as they are finished,
// then returns the project's full scene list.
export async function runAgentTurn({ lec, workspaceDir, engine, model, effort, tts, voiceEngine, signal, emit, log, message, sceneFile, settings = {}, history = [], inbox }) {
  const lg = await lecturegen();
  fs.mkdirSync(workspaceDir, { recursive: true });
  const aspect = lec.aspect || "16:9";
  const viewport = lg.viewportForAspectRatio(aspect);
  const activity = new Activity((items) => emit("activity", { items }));
  const say = (m) => {
    log?.(m);
    activity.app(m);
  };
  const before = new Map(indexFiles(workspaceDir).map((f) => [f, readText(path.join(workspaceDir, f))]));
  const oldScenes = new Map((lec.scenes || []).map((s) => [s.file, s]));
  const resolved = scene => isResolvedScene(scene) && scene.beats.every(beat => {
    if (beat.visualOnly === true || beat.segment?.kind === "visual-only" || typeof tts.fileFor !== "function") return true;
    try {
      const file = fs.statSync(tts.fileFor(beat.audio));
      return file.isFile() && file.size > 44;
    } catch { return false; }
  });
  const processed = new Map(); // file -> { html, scene }
  const failed = new Map(); // file -> { html, validation }
  const lastSeen = new Map(); // file -> html at the previous scan (stability check)
  let agentDone = false;
  let title = "";
  let metaRaw = null;
  let modelUsed = "";
  const browser = await lg.chromium.launch();

  const readMeta = () => {
    const raw = readText(path.join(workspaceDir, "metadata.json"));
    if (!raw || raw === metaRaw) return;
    metaRaw = raw;
    try {
      const m = JSON.parse(raw);
      if (m.title && m.title !== title) emit("title", { title: (title = String(m.title)) });
    } catch {}
  };

  const sceneOf = async (file, html) => {
    const n = Number(file.match(INDEX_RE)[1]);
    say(`Recording narration for scene ${n}`);
    const playbackFile = writePlaybackSnapshot(workspaceDir, file, html);
    const beats = await resolveBeats({ lg, browser, workspaceDir, file: playbackFile, sourceFile: file, viewport, tts, voiceEngine });
    return { id: `sc${n}`, kind: "html", file, playbackFile, title: sceneTitle(html, n), beats, version: (oldScenes.get(file)?.version || 0) + 1 };
  };

  // Hand finished scenes to the player, in order.
  const scan = async ({ final = false } = {}) => {
    readMeta();
    const files = indexFiles(workspaceDir);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const html = readText(path.join(workspaceDir, file));
      const prevSeen = lastSeen.get(file);
      lastSeen.set(file, html);
      if (html == null) break;
      if (processed.get(file)?.html === html) continue;
      if (!processed.has(file) && before.get(file) === html && resolved(oldScenes.get(file))) continue; // already playable and untouched
      // Finished = the agent is done, or a later file exists and this one stopped changing.
      const complete = agentDone || (i < files.length - 1 && prevSeen === html);
      if (!complete) break;
      let validation = failed.get(file)?.html === html ? failed.get(file).validation : null;
      if (validation == null) {
        say(`Checking scene ${i + 1}`);
        validation = await validate(lg, browser, workspaceDir, file, viewport, html);
      }
      if (!String(validation).includes("validation passed")) {
        processed.delete(file);
        failed.set(file, { html, validation, phase: failed.get(file)?.html === html ? failed.get(file).phase : undefined });
        log?.(validation);
        if (!final) break;
        continue;
      }
      failed.delete(file);
      let scene;
      try {
        scene = await sceneOf(file, html);
      } catch (e) {
        if (e?.aborted || signal.aborted) throw e;
        processed.delete(file);
        failed.set(file, { html, validation: `Narration failed: ${e.message || e}`, phase: "narration" });
        log?.(`${file}: Narration failed: ${e.message || e}`);
        if (!final) break;
        continue;
      }
      processed.set(file, { html, scene });
      emit("scene", { index: i, scene });
    }
  };

  let busy = Promise.resolve();
  const tick = () => (busy = busy.then(() => scan()).catch((e) => log?.(`Scan: ${e.stack || e}`)));
  const timer = setInterval(tick, 1200);
  try {
    const files = fs.readdirSync(workspaceDir).filter((f) => /^(answer\.md|script\.md|metadata\.json|index\d+\.html)$/i.test(f));
    const reply = await runAgent({ inbox,
      engine,
      model,
      effort,
      signal,
      workspace: workspaceDir,
      system: LECTURE_AGENT_SYSTEM,
      prompt: agentTurnPrompt({ message, files, sceneFile, history, aspect, length: settings.length, theme: settings.theme, teachingStyle: settings.teachingStyle, assets: bundledAssets(lg, workspaceDir, log) }) + "\n\n" + attachmentContext(lec.attachments),
      onModel: (m) => { modelUsed = m; },
      activity,
      onStatus: (st) => log?.(st),
    });
    activity.takeFinal();
    clearInterval(timer);
    await busy;
    agentDone = true;
    await scan();

    // Every changed scene that still fails goes back to the agent once.
    for (const file of indexFiles(workspaceDir)) {
      const html = readText(path.join(workspaceDir, file));
      if (processed.get(file)?.html === html || (!processed.has(file) && before.get(file) === html && resolved(oldScenes.get(file))) || failed.has(file)) continue;
      const validation = await validate(lg, browser, workspaceDir, file, viewport, html);
      if (!String(validation).includes("validation passed")) failed.set(file, { html, validation });
    }
    const problems = [...failed].filter(([, f]) => f.phase !== "narration").map(([file, f]) => ({ file, validation: f.validation }));
    if (problems.length && !signal.aborted) {
      say(`Fixing ${problems.length} scene${problems.length > 1 ? "s" : ""} that failed the checks`);
      await runAgent({ inbox, engine, model, effort, signal, workspace: workspaceDir, prompt: fixTaskPrompt(problems), activity });
      activity.takeFinal();
    }
    await scan({ final: true });

    // The project's scenes, from the folder.
    const scenes = [];
    const failures = [];
    for (const file of indexFiles(workspaceDir)) {
      const html = readText(path.join(workspaceDir, file));
      if (failed.has(file)) failures.push(`${file}: ${failed.get(file).validation}`);
      else if (processed.get(file)?.html === html && isResolvedScene(processed.get(file).scene)) scenes.push(processed.get(file).scene);
      else if (before.get(file) === html && resolved(oldScenes.get(file))) scenes.push(oldScenes.get(file));
      else {
        // Unchanged file without a scene record (e.g. after an earlier failed turn): try it now.
        const v = await validate(lg, browser, workspaceDir, file, viewport, html);
        if (String(v).includes("validation passed")) {
          try { scenes.push(await sceneOf(file, html)); }
          catch (e) {
            if (e?.aborted || signal.aborted) throw e;
            failures.push(`${file}: Narration failed: ${e.message || e}`);
          }
        } else failures.push(`${file}: ${v}`);
      }
    }
    readMeta();
    activity.flush();
    return { scenes, reply, title, failures, model: modelUsed, activity: activity.items };
  } catch (error) {
    // A failed agent turn may have edited scene files in place. The caller
    // retains the previous project on fatal failure, so restore its HTML too.
    clearInterval(timer);
    await busy.catch(() => {});
    for (const [file, html] of before) {
      if (html != null) fs.writeFileSync(path.join(workspaceDir, file), html, "utf8");
    }
    throw error;
  } finally {
    clearInterval(timer);
    await busy.catch(() => {});
    await browser.close();
  }
}
