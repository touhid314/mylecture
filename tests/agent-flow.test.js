import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";

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
      newPage: async () => ({ addInitScript: async () => {}, goto: async () => {}, close: async () => {}, evaluate: async () => [{ id: "i1", kind: "narration+visual", text: "Hello." }] }),
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
const { runAgentLecture, runAgentTurn, agentTaskPrompt, agentTurnPrompt, LECTURE_AGENT_SYSTEM, supportsAgentFlow } = await import("../electron/lecturegen/agent-run.js");
const { lecturegenCatalog, resolveStyleResource } = await import("../electron/lecturegen/run.js");
test.after(() => {
  hooks.deregister();
  delete globalThis[key];
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
  assert.match(LECTURE_AGENT_SYSTEM, /main job is to make narrated, animated explainer videos/);
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
  const keep = { id: "sc1", kind: "html", file: "index1.html", beats: [] };
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
  const keep = { id: "sc1", kind: "html", file: "index1.html", beats: [] };
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
