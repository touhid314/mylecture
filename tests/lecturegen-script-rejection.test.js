import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { runLectureGen } from "../electron/lecturegen/run.js";

const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const script = "# Scene 1\nN: First.\n# Scene 2\nN: Second.\n# Scene 3\nN: Third.";
let state;
const fake = {
  generateAnswer: async options => { state.answerOptions = options; return "A natural answer."; },
  generateMetadata: async () => ({ title: "Test" }),
  ensureWorldBasemapInWorkspace: () => "",
  formatWorldBasemapDescription: () => "",
  getScriptTrimmerChunkSizes: () => ({ minimumNarrationWords: 1, maximumNarrationWords: 80 }),
  countNarrationWords: text => text.trim().split(/\s+/).filter(Boolean).length,
  normalizeTtsText: text => text,
  stripImageRequests: text => text,
  trimScriptByNarration: content => content.split(/(?=^# Scene)/m).filter(part => part.trim()).map(content => ({ content })),
  validateAudiovisualScript: () => {},
  writeScript: options => {
    state.scriptOptions = options;
    return globalThis.__ML_LLM__.generate({ purpose: "lecturegen_script_writer", system: "", user: "" });
  },
  AnimatorSession: class {},
  RepairBudget: class {},
  chromium: { launch: async () => {
    await pause(); // Let an early script rejection cross an event-loop turn.
    if (state.launchError) throw state.launchError;
    return {
      close: async () => { state.closed++; },
      newPage: async () => ({
        addInitScript: async () => {}, goto: async () => {},
        evaluate: async () => [{ id: "i1", kind: "narration+visual", text: "Narrated fixture scene." }], close: async () => {},
      }),
    };
  } },
  viewportForAspectRatio: () => ({ width: 1280, height: 720 }),
  slicePreviousHtmls: completed => completed,
  animateScriptBlock: async input => {
    state.animated.push(input.blockIndex);
    if (state.duringAnimation) await state.duringAnimation();
    return "<html></html>";
  },
  validateAndRepairHtml: async (_input, _session, _dir, html) => html,
  layoutRepairEnabled: () => false,
};

// Replace only the costly bundled dependency, exercising run.js itself unchanged.
const key = "__lecturegenScriptRejectionFixture";
globalThis[key] = fake;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/electron/lecturegen/src/lecturegen.mjs")) {
      return {
        format: "module", shortCircuit: true,
        source: `const fake = globalThis[${JSON.stringify(key)}];\n` +
          Object.keys(fake).map(name => `export const ${name} = fake.${name};`).join("\n"),
      };
    }
    return nextLoad(url, context);
  },
});

test("script failures are observed immediately and retain pipeline cleanup semantics", async t => {
  t.after(() => { hooks.deregister(); delete globalThis[key]; });

  async function run({ source = "study", generate, duringAnimation, launchError, controller = new AbortController() }) {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lecturegen-rejection-"));
    state = { closed: 0, animated: [], events: [], duringAnimation, launchError };
    const current = state;
    const completion = runLectureGen({
      lec: { source, question: "Explain.", length: "deep" }, workspaceDir,
      engine: { generate }, tts: { synth: async () => ({ key: "test", dur: 1 }) },
      signal: controller.signal,
      emit: (type, payload) => current.events.push({ type, ...payload }),
    });
    try { return { result: await completion, state: current }; }
    finally { fs.rmSync(workspaceDir, { recursive: true, force: true }); }
  }

  await t.test("early script rejection survives slow browser startup and closes the browser", async () => {
    const error = new Error("early script failure");
    await assert.rejects(run({ generate: async () => { throw error; } }), e => e === error);
    assert.equal(state.closed, 1);
    assert.deepEqual(state.animated, []);
    assert(state.events.some(event => event.type === "answer" && event.done));
  });

  await t.test("script rejection is handled even if browser launch fails first", async () => {
    const launchError = new Error("browser unavailable");
    await assert.rejects(run({ launchError, generate: async () => { throw new Error("script failed too"); } }), e => e === launchError);
    assert.equal(state.closed, 0);
  });

  await t.test("a rejection during animation preserves queued successful blocks then propagates", async () => {
    const error = new Error("stream interrupted");
    let rejectScript;
    await assert.rejects(run({
      generate: ({ onDelta }) => {
        onDelta(script);
        return new Promise((_resolve, reject) => { rejectScript = reject; });
      },
      duringAnimation: async () => { rejectScript(error); await pause(); },
    }), e => e === error);
    assert.deepEqual(state.animated, [1, 2]);
    assert.equal(state.events.filter(event => event.type === "scene-ready").length, 2);
    assert.equal(state.closed, 1);
  });

  await t.test("successful Study and Create keep their length behavior and all queued blocks", async () => {
    for (const source of ["study", "create"]) {
      const { result } = await run({ source, generate: async ({ onDelta }) => { onDelta(script); return { text: script }; } });
      assert.deepEqual(state.animated, [1, 2, 3]);
      assert.equal(state.events.filter(event => event.type === "scene-ready").length, 3);
      assert.deepEqual(result.failures, []);
      assert.equal(state.answerOptions.generationLength, source === "study" ? "Content-driven; no fixed duration" : "5:00");
      assert.equal(state.scriptOptions.generationLength, state.answerOptions.generationLength);
      assert.equal(state.closed, 1);
    }
  });

  await t.test("stop retains the abort error and handles a later script rejection", async () => {
    const controller = new AbortController();
    const stopped = Object.assign(new Error("Stopped"), { aborted: true });
    let rejectScript;
    await assert.rejects(run({
      controller,
      generate: ({ onDelta }) => {
        onDelta(script);
        return new Promise((_resolve, reject) => { rejectScript = reject; });
      },
      duringAnimation: async () => { controller.abort(stopped); throw stopped; },
    }), e => e === stopped);
    rejectScript(new Error("script cancelled after stop"));
    await pause();
    assert.equal(state.closed, 1);
  });
});
