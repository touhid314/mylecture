import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { Activity } from "../electron/activity.js";
import { idleStatus } from "../electron/engines/cli-util.js";

const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const html = (n, ok = true) => `<!doctype html><html><head></head><body>${ok ? "" : "BROKEN"}<script>window.__VIDEO_METADATA__={contractVersion:"0.2",title:"Part ${n}",aspectRatio:"16:9"};</script></body></html>`;

const fake = {
  normalizeTtsText: (t) => t,
  viewportForAspectRatio: () => ({ width: 1920, height: 1080 }),
  validateHtmlInBrowser: async (file, dir) => {
    const c = fs.readFileSync(path.join(dir, file), "utf8");
    return c.includes("BROKEN") ? `HTML contract validation failed for ${file}:\n - broken` : `HTML contract validation passed for ${file}`;
  },
  chromium: {
    launch: async () => ({
      close: async () => {},
      newPage: async () => ({ addInitScript: async () => {}, goto: async () => {}, close: async () => {}, evaluate: async () => fake.plan ?? [{ id: "i1", kind: "narration+visual", text: "Hello." }] }),
    }),
  },
};
const key = "__agentFlowFixture";
globalThis[key] = fake;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/electron/lecturegen/src/lecturegen.mjs")) {
      return { format: "module", shortCircuit: true, source: `const fake = globalThis[${JSON.stringify(key)}];\n` + Object.keys(fake).map((n) => `export const ${n} = fake.${n};`).join("\n") };
    }
    return nextLoad(url, context);
  },
});
const { runAgent, runAgentLecture, runAgentTurn, agentTaskPrompt, agentTurnPrompt, bundledAssets, LECTURE_AGENT_SYSTEM, supportsAgentFlow } = await import("../electron/lecturegen/agent-run.js");
const { lecturegenCatalog, resolveStyleResource } = await import("../electron/lecturegen/run.js");
test.after(() => {
  hooks.deregister();
  delete globalThis[key];
});

test("silent heartbeats retain the observed phase without repeated warning lines", async () => {
  const status = [];
  const activity = new Activity(() => {});
  const result = await runAgent({
    engine: { agent: async ({ onStatus, onActivity, onDelta }) => {
      const idle = () => { for (const ms of [45000, 60000, 300000, 600000]) onStatus(idleStatus(ms)); };
      idle();
      assert.deepEqual(activity.items, ["💭 Working…"]);
      onActivity({ type: "step", icon: "💭", text: "thinking" });
      idle();
      assert.deepEqual(activity.items, ["💭 Thinking…"]);
      onStatus("agent: Write");
      idle();
      assert.deepEqual(activity.items, ["💭 Generating…"]);
      onActivity({ type: "step", icon: "✏️", text: "index1.html" });
      idle();
      assert.deepEqual(activity.items, ["✏️ index1.html", "💭 Generating…"]);
      onStatus("agent: Bash");
      onActivity({ type: "step", icon: "▶", text: "validate scene" });
      idle();
      assert.equal(activity.items.at(-1), "💭 Working…");
      onDelta("Done");
      onActivity({ type: "say", id: "m", delta: "Done" });
      idle();
      assert.equal(activity.items.at(-1), "💭 Generating…");
      onActivity({ type: "say", id: "m", delta: "." });
      assert.equal(activity.items.at(-1), "💬 Done.");
      return { text: "Done." };
    } },
    signal: new AbortController().signal,
    activity,
    onStatus: value => status.push(value),
  });
  activity.flush();
  assert.equal(result, "Done.");
  for (const label of ["Thinking…", "Generating…", "Working…"]) assert.ok(status.includes(label));
  assert.doesNotMatch([...status, ...activity.items].join("\n"), /waiting|no (events|output|response)|seems stuck/i);
  assert.equal(activity.items.filter(item => item.startsWith("💭")).length, 0);
});

test("task prompt: one straightforward task; auto omits theme and teaching style", () => {
  const p = agentTaskPrompt({ question: "What is E=mc2?", length: "2:00", aspect: "16:9", theme: "light", teachingStyle: "default" });
  assert.match(p, /1\. answer\.md[\s\S]*2\. script\.md[\s\S]*3\. index1\.html/);
  assert.match(p, /# Visual theme/);
  assert.match(p, /# Teaching style/);
  assert.match(p, /2:00/);
  const auto = agentTaskPrompt({ question: "Q", length: "1:00", theme: "auto", teachingStyle: "auto" });
  assert.doesNotMatch(auto, /# Visual theme|# Teaching style/);
  assert.match(auto, /Visual theme: your choice/);
  assert.equal(lecturegenCatalog().themes[0].id, "auto");
  assert.equal(lecturegenCatalog().teachingStyles[0].id, "auto");
  const catalog = lecturegenCatalog();
  for (const id of ["fonts-colors", "none", "sat-tutor"]) assert.ok(!catalog.themes.some(item => item.id === id));
  for (const id of ["middle-school-math", "none", "sat-tutor", "stickman-compare"]) assert.ok(!catalog.teachingStyles.some(item => item.id === id));
  assert.ok(catalog.themes.some(item => item.id === "stickman-compare"));
  assert.ok(catalog.teachingStyles.some(item => item.id === "research-paper"));
  assert.match(resolveStyleResource("auto", "themes"), /No specific visual theme/);
  assert.equal(supportsAgentFlow({ kind: "cli", agent() {} }), true);
  assert.equal(supportsAgentFlow({ kind: "api", generate() {} }), false);
});

test("agent writes files; scenes stream in order, broken scene is sent back for a fix", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-flow-"));
  const calls = [];
  const engine = {
    name: "Fake",
    kind: "cli",
    async agent({ user, workspace }) {
      calls.push(user);
      const w = (f, c) => fs.writeFileSync(path.join(workspace, f), c);
      if (calls.length === 1) {
        assert.equal(workspace, ws);
        w("answer.md", "Energy equals mass times c squared.");
        await pause();
        w("script.md", "# Scene 1\n...");
        w("metadata.json", JSON.stringify({ title: "E=mc²" }));
        w("index1.html", html(1));
        await pause(1500);
        w("index2.html", html(2, false));
        await pause();
        w("index3.html", html(3));
        return { text: "Done." };
      }
      assert.match(user, /index2\.html/);
      w("index2.html", html(2));
      return { text: "Fixed." };
    },
  };
  const events = [];
  const r = await runAgentLecture({
    lec: { source: "ide", question: "What is E=mc2?", length: "1:00", aspect: "16:9", theme: "auto", teachingStyle: "auto" },
    workspaceDir: ws,
    engine,
    tts: { synth: async () => ({ key: "k", dur: 1 }) },
    signal: new AbortController().signal,
    emit: (type, p) => events.push({ type, ...p }),
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(r.failures, []);
  assert.equal(r.title, "E=mc²");
  const scenes = events.filter((e) => e.type === "scene-ready");
  assert.deepEqual(scenes.map((e) => e.scene.file), ["index1.html", "index2.html", "index3.html"]);
  assert.deepEqual(scenes.map((e) => e.index), [0, 1, 2]);
  assert.equal(scenes[0].scene.beats[0].text, "Hello.");
  // Scene 1 was handed over while the agent was still working.
  const firstScene = events.findIndex((e) => e.type === "scene-ready");
  const fixAsk = events.findIndex((e) => e.type === "status" && /fix/.test(e.message));
  assert.ok(firstScene < fixAsk);
});

test("lecture agent brief: makes videos, can just talk, keeps artifacts out of replies", () => {
  assert.match(LECTURE_AGENT_SYSTEM, /main job is to make narrated, animated videos of any kind/);
  assert.match(LECTURE_AGENT_SYSTEM, /What video do you want to make next\?/);
  assert.match(LECTURE_AGENT_SYSTEM, /just reply/);
  assert.match(LECTURE_AGENT_SYSTEM, /Do not mention the project's files or artifacts[\s\S]*unless the user explicitly asks/);
  const p = agentTurnPrompt({ message: "hi", files: [], history: [{ role: "user", text: "make a video" }, { role: "agent", text: "Done." }], length: "1:00", theme: "auto", teachingStyle: "auto" });
  assert.match(p, /Empty: no video yet/);
  assert.match(p, /# Conversation so far\nUser: make a video\n\nYou: Done\./);
  assert.match(p, /# The user's message\nhi/);
  assert.match(p, /HTML Input Contract/);
});

const fakeTts = { synth: async () => ({ key: "k", dur: 1 }) };
const turn = (lec, ws, engine, message, extra = {}) => {
  const events = [];
  const done = runAgentTurn({ lec, workspaceDir: ws, engine, tts: fakeTts, signal: new AbortController().signal, emit: (type, p) => events.push({ type, ...p }), message, ...extra });
  return done.then((r) => ({ ...r, events }));
};

test("agent turn: a plain question gets a reply and touches nothing", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-turn-"));
  fs.writeFileSync(path.join(ws, "index1.html"), html(1));
  const keep = { id: "sc1", kind: "html", file: "index1.html", beats: [{ text: "Hello.", audio: "existing", dur: 1 }] };
  const engine = {
    name: "Fake",
    kind: "cli",
    async agent({ system, user, onActivity }) {
      assert.equal(system, LECTURE_AGENT_SYSTEM);
      assert.match(user, /Files: index1\.html/);
      onActivity({ type: "say", id: "m1", delta: "Scene 1 shows the **circuit**." });
      return { text: "Scene 1 shows the **circuit**." };
    },
  };
  const r = await turn({ aspect: "16:9", scenes: [keep] }, ws, engine, "what is in scene 1?");
  assert.equal(r.reply, "Scene 1 shows the **circuit**.");
  assert.deepEqual(r.scenes, [keep]);
  assert.equal(r.events.filter((e) => e.type === "scene").length, 0);
});

test("agent turn: changes stream to the player; only changed scenes are re-narrated", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-turn-"));
  fs.writeFileSync(path.join(ws, "index1.html"), html(1));
  fs.writeFileSync(path.join(ws, "index2.html"), html(2));
  const keep = { id: "sc1", kind: "html", file: "index1.html", beats: [{ text: "Hello.", audio: "existing", dur: 1 }] };
  const lec = { aspect: "16:9", scenes: [keep, { id: "sc2", kind: "html", file: "index2.html", beats: [] }] };
  const engine = {
    name: "Fake",
    kind: "cli",
    async agent({ user, workspace, onActivity }) {
      assert.match(user, /looking at index2\.html/);
      assert.match(user, /# Conversation so far\nUser: earlier/);
      onActivity({ type: "step", icon: "✏️", text: "index2.html" });
      fs.writeFileSync(path.join(workspace, "index2.html"), html(2).replace("Part 2", "Better part 2"));
      fs.writeFileSync(path.join(workspace, "index3.html"), html(3));
      onActivity({ type: "say", id: "m", delta: "Added a recap scene." });
      return { text: "Added a recap scene." };
    },
  };
  const r = await turn(lec, ws, engine, "add a recap", { sceneFile: "index2.html", history: [{ role: "user", text: "earlier" }] });
  assert.equal(r.reply, "Added a recap scene.");
  assert.deepEqual(r.scenes.map((s) => s.file), ["index1.html", "index2.html", "index3.html"]);
  assert.equal(r.scenes[0], keep);
  assert.equal(r.scenes[1].title, "Better part 2");
  assert.deepEqual(r.events.filter((e) => e.type === "scene").map((e) => e.index), [1, 2]);
  // The final reply is not left inside the work timeline.
  assert.ok(!r.activity.some((i) => i.includes("Added a recap scene")));
});

test("agent scenes stay unavailable until narration finishes", async t => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resolve-pending-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  let signalStarted, finish;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const voice = new Promise(resolve => { finish = resolve; });
  const events = [];
  const result = runAgentTurn({
    lec: {}, workspaceDir: ws, signal: new AbortController().signal, message: "make it",
    engine: { async agent() { fs.writeFileSync(path.join(ws, "index1.html"), html(1)); return { text: "Done" }; } },
    tts: { async synth() { signalStarted(); return voice; } },
    emit: (type, payload) => events.push({ type, ...payload }),
  });
  await started;
  assert.equal(events.filter(event => event.type === "scene").length, 0);
  finish({ key: "recorded", dur: 2 });
  const complete = await result;
  assert.equal(complete.scenes.length, 1);
  assert.equal(complete.scenes[0].beats[0].audio, "recorded");
  assert.equal(events.filter(event => event.type === "scene").length, 1);
});

test("rejected or invalid narration never publishes scenes or reuses changed scene audio", async t => {
  for (const output of [undefined, {}, { key: "", dur: 1 }, { key: "k", dur: 0 }, { key: "k", dur: NaN }, new Error("Voice download failed")]) {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resolve-failed-"));
    t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
    fs.writeFileSync(path.join(ws, "index1.html"), html(1));
    let calls = 0;
    const engine = { async agent() {
      calls++;
      fs.writeFileSync(path.join(ws, "index1.html"), html(1).replace("Part 1", "Changed"));
      return { text: "Changed" };
    } };
    const lec = { scenes: [{ id: "sc1", kind: "html", file: "index1.html", beats: [{ audio: "old-audio", dur: 1 }] }] };
    const result = await turn(lec, ws, engine, "change it", { tts: { async synth() { if (output instanceof Error) throw output; return output; } } });
    assert.deepEqual(result.scenes, []);
    assert.equal(result.events.filter(event => event.type === "scene").length, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /Narration failed/);
    assert.equal(calls, 1, "A voice failure must not ask the HTML agent to repair the scene");
    assert.equal(fs.existsSync(path.join(ws, "index1.html")), true, "Keep failed scenes available for retry");
  }
});

test("unresolved historical scene records are narrated before they are returned", async t => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resolve-old-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ws, "index1.html"), html(1));
  const lec = { scenes: [{ file: "index1.html", beats: [] }] };
  let calls = 0;
  const result = await turn(lec, ws, { async agent() { return { text: "Just a reply" }; } }, "hi", {
    tts: { async synth() { calls++; return { key: "new-audio", dur: 1 }; } },
  });
  assert.equal(calls, 1);
  assert.equal(result.scenes[0].beats[0].audio, "new-audio");
});

test("intentional visual-only scenes play without requesting speech and empty plans cannot play", async t => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resolve-visual-"));
  t.after(() => { fake.plan = undefined; fs.rmSync(ws, { recursive: true, force: true }); });
  fake.plan = [{ id: "visual", kind: "visual-only", duration: 2 }];
  const engine = { async agent() { fs.writeFileSync(path.join(ws, "index1.html"), html(1)); return { text: "Done" }; } };
  const result = await turn({}, ws, engine, "make it", { tts: { async synth() { throw new Error("Must not narrate visual-only cue"); } } });
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].beats[0].visualOnly, true);
  assert.equal(result.scenes[0].beats[0].dur, 2);
  fake.plan = [];
  const empty = await turn({}, ws, engine, "make it");
  assert.deepEqual(empty.scenes, []);
  assert.match(empty.failures[0], /no narration or visual-only cues/);
});

test("fatal agent failure restores original HTML paired with existing narration", async t => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resolve-rollback-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ws, "index1.html"), html(1));
  const engine = { async agent() { fs.writeFileSync(path.join(ws, "index1.html"), html(2)); throw new Error("Provider disconnected"); } };
  await assert.rejects(turn({ scenes: [{ file: "index1.html", beats: [{ audio: "old-audio", dur: 1 }] }] }, ws, engine, "change it"), /Provider disconnected/);
  assert.equal(fs.readFileSync(path.join(ws, "index1.html"), "utf8"), html(1));
});

test("initial lecture generation reports voice failure without publishing a silent scene", async t => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-lecture-voice-failure-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const events = [];
  let calls = 0;
  const result = await runAgentLecture({
    lec: { question: "make it", theme: "auto", teachingStyle: "auto" }, workspaceDir: ws,
    engine: { async agent() { calls++; fs.writeFileSync(path.join(ws, "index1.html"), html(1)); return { text: "Done" }; } },
    tts: { async synth() { throw new Error("Voice is unavailable"); } },
    signal: new AbortController().signal,
    emit: (type, payload) => events.push({ type, ...payload }),
  });
  assert.equal(events.filter(event => event.type === "scene-ready").length, 0);
  assert.match(result.failures[0], /Narration failed: Voice is unavailable/);
  assert.equal(calls, 1);
});

test("published playback HTML stays paired with its narration when the agent rewrites the source", async t => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-playback-snapshot-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const events = [];
  let rewritten = false;
  const result = await runAgentTurn({
    lec: {}, workspaceDir: ws, message: "make it", signal: new AbortController().signal,
    engine: { async agent() { fs.writeFileSync(path.join(ws, "index1.html"), html(1)); return { text: "Done" }; } },
    tts: fakeTts,
    emit(type, payload) {
      if (type !== "scene") return;
      events.push(payload.scene);
      if (!rewritten) { rewritten = true; fs.writeFileSync(path.join(ws, "index1.html"), html(2)); }
    },
  });
  assert.equal(events.length, 2);
  assert.match(events[0].playbackFile, /^\.playback-index1-[a-f0-9]+\.html$/);
  assert.notEqual(events[0].playbackFile, events[1].playbackFile);
  assert.equal(fs.readFileSync(path.join(ws, events[0].playbackFile), "utf8"), html(1));
  assert.equal(fs.readFileSync(path.join(ws, result.scenes[0].playbackFile), "utf8"), html(2));
});

test("untouched saved scenes regenerate missing or empty cached audio before being returned", async t => {
  for (const corruptCache of [false, true]) {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "agent-audio-cache-recovery-"));
    t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
    fs.writeFileSync(path.join(ws, "index1.html"), html(1));
    if (corruptCache) fs.writeFileSync(path.join(ws, "old-audio.wav"), Buffer.alloc(44));
    const oldScene = { file: "index1.html", beats: [{ audio: "old-audio", dur: 1, text: "Hello." }] };
    let calls = 0;
    const tts = {
      fileFor: key => path.join(ws, `${key}.wav`),
      async synth() { calls++; fs.writeFileSync(path.join(ws, "regenerated.wav"), Buffer.alloc(100)); return { key: "regenerated", dur: 1 }; },
    };
    const result = await turn({ scenes: [oldScene] }, ws, { async agent() { return { text: "Just a reply" }; } }, "hi", { tts });
    assert.equal(calls, 1);
    assert.equal(result.scenes[0].beats[0].audio, "regenerated");
    assert.equal(result.events.filter(event => event.type === "scene").length, 1);
    assert.equal(fs.readFileSync(path.join(ws, "index1.html"), "utf8"), html(1));
  }
});

test("agents get the bundled world basemap and its projection instructions", () => {
  const copied = [];
  const lg = {
    ensureWorldBasemapInWorkspace: (dir) => (copied.push(dir), "assets/world-basemap.svg"),
    formatWorldBasemapDescription: (p) => `- ${p}: Natural Earth basemap. projectLonLat helpers.`,
  };
  const assets = bundledAssets(lg, "project-dir");
  assert.deepEqual(copied, ["project-dir"]);
  assert.match(assets, /assets\/world-basemap\.svg/);
  assert.match(assets, /country borders/);
  for (const prompt of [agentTaskPrompt({ question: "Map the Silk Road", assets }), agentTurnPrompt({ message: "Map the Silk Road", assets })]) {
    assert.match(prompt, /# Bundled assets \(already in this project folder\)/);
    assert.match(prompt, /projectLonLat/);
  }
  assert.equal(bundledAssets({ ensureWorldBasemapInWorkspace() { throw new Error("missing"); } }, "d"), "");
});
