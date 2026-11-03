// End-to-end: run the original LectureGen pipeline through the app's engine,
// voice and Electron validator, logging every event with timestamps.
//   npx electron tests/scratch/lecturegen-e2e.mjs "question" [theme] [length]
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

app.setName("MyLecture");
app.on("window-all-closed", (e) => e.preventDefault?.());
app.whenReady().then(main);
async function main() {
const { createEngines } = await import("../../electron/engines/index.js");
const { TTSService } = await import("../../electron/tts/index.js");
const { getSettings, paths, newId } = await import("../../electron/store.js");
const { runLectureGen } = await import("../../electron/lecturegen/run.js");
const { runAgentLecture, supportsAgentFlow } = await import("../../electron/lecturegen/agent-run.js");

const q = process.argv.find((a, i) => i > 1 && !a.startsWith("--") && !a.endsWith(".mjs")) || "Explain how a binary search works";
const theme = process.env.ML_THEME || "default";
const length = process.env.ML_LENGTH || "quick";
const s = getSettings();
// API keys: ML_API_PROVIDER, ML_API_KEY, ML_API_BASE, ML_API_MODEL (with ML_ENGINE=api).
const apiConfig = { provider: process.env.ML_API_PROVIDER, apiKey: process.env.ML_API_KEY, baseUrl: process.env.ML_API_BASE, model: process.env.ML_API_MODEL };
const engines = createEngines(() => apiConfig);
const engine = engines.get(process.env.ML_ENGINE || s.engine);
const model = engine.id === "api" ? apiConfig.model : s.models?.[engine.id] ?? engine.defaultModel;
const tts = new TTSService({ cacheDir: paths.tts, modelDir: paths.models, getSettings });
tts.startKokoro();
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";
const id = newId("e2e-");
const ws = path.join(paths.library, id);
const log = [];
try {
  const run = supportsAgentFlow(engine) && process.env.ML_FLOW !== "pipeline" ? runAgentLecture : runLectureGen;
  console.log("FLOW", run.name, engine.name, model);
  const r = await run({
    lec: { id, question: q, theme, teachingStyle: process.env.ML_TEACH || "default", length, source: "ide", aspect: "16:9" },
    workspaceDir: ws,
    engine,
    model,
    effort: s.codexEffort,
    tts,
    voiceEngine: undefined,
    signal: new AbortController().signal,
    log: (m) => { log.push(`${ts()} ${m}`); console.log(ts(), "LOG", String(m).slice(0, 300)); },
    emit: (type, p) => {
      if (type === "progress") { if (p.stage === "animate" && Math.floor(p.chars / 4000) !== globalThis.__lastK) { globalThis.__lastK = Math.floor(p.chars / 4000); console.log(ts(), "animating", p.scene, p.chars, "chars"); } return; }
      if (type === "scene-ready") console.log(ts(), "SCENE READY", p.index, p.scene.file, p.scene.beats.length, "beats", p.scene.beats.reduce((a, b) => a + b.dur, 0).toFixed(1) + "s");
      else console.log(ts(), type, JSON.stringify(p).slice(0, 160));
    },
  });
  console.log(ts(), "DONE", JSON.stringify(r).slice(0, 400));
} catch (e) {
  console.log(ts(), "FAILED", e.stack || e);
}
fs.writeFileSync(path.join(ws, "e2e.log"), log.join("\n"));
console.log("WORKSPACE", ws);
app.exit(0);
}
