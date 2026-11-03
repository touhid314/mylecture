// Real conversation with the Lecture Agent (CLI engine from settings):
//   npx electron tests/scratch/agent-turn-e2e.mjs
import { app } from "electron";
import path from "node:path";

app.setName("MyLecture");
app.on("window-all-closed", (e) => e.preventDefault?.());
app.whenReady().then(main);
async function main() {
  const { createEngines } = await import("../../electron/engines/index.js");
  const { TTSService } = await import("../../electron/tts/index.js");
  const { getSettings, paths, newId } = await import("../../electron/store.js");
  const { runAgentTurn } = await import("../../electron/lecturegen/agent-run.js");
  const s = getSettings();
  const engine = createEngines(() => ({})).get(process.env.ML_ENGINE || s.engine);
  const model = s.models?.[engine.id] ?? engine.defaultModel;
  const tts = new TTSService({ cacheDir: paths.tts, modelDir: paths.models, getSettings });
  tts.startKokoro();
  const ws = path.join(paths.library, newId("e2e-turn-"));
  const lec = { aspect: "16:9", scenes: [] };
  const chat = [];
  const t0 = Date.now();
  const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";
  const messages = [
    "make a 30 second video on why the sky is blue",
    "what does the first scene show?",
    "make the first scene's title say 'Why is the sky blue?' exactly",
  ];
  for (const message of messages) {
    console.log(`\n${ts()} USER: ${message}`);
    let last = [];
    try {
      const r = await runAgentTurn({
        lec, workspaceDir: ws, engine, model, effort: s.codexEffort, tts, signal: new AbortController().signal, message,
        history: chat.slice(-12), settings: { length: "0:30", theme: "auto", teachingStyle: "auto" },
        log: () => {},
        emit: (type, p) => {
          if (type === "activity") last = p.items;
          else if (type === "scene") console.log(ts(), "SCENE", p.index, p.scene.file, p.scene.beats.length, "beats");
        },
      });
      lec.scenes = r.scenes;
      chat.push({ role: "user", text: message }, { role: "agent", text: r.reply });
      console.log(ts(), "STEPS", last.length, last.slice(-6).map((x) => x.slice(0, 70)).join(" | "));
      console.log(ts(), "REPLY:", r.reply);
      console.log(ts(), "SCENES", r.scenes.map((x) => x.file).join(","), "failures", r.failures.length);
    } catch (e) {
      console.log(ts(), "FAILED", e.stack || e);
      break;
    }
  }
  console.log("WORKSPACE", ws);
  app.exit(0);
}
