// Manual live check (requires a connected Claude account and internet).
// For a real-world topic the tutor should show a real picture, time its
// visuals with {show:...}, and, once it can see the picture (next segment),
// mark its parts with annotate as it names them.
//   node tests/scratch/study-picture-sync.mjs ["topic"] [segments]
import { claudeCode } from "../../electron/engines/claude-code.js";
import { TutorService } from "../../electron/tutor/service.js";
import { ImageFinder } from "../../electron/tutor/images.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const topic = process.argv[2] || "What are mitochondria?";
const segments = Number(process.argv[3]) || 2;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-live-sync-"));
let actions = [];
const service = new TutorService({
  engines: new Map([["claude-code", claudeCode]]),
  getSettings: () => ({ engine: "claude-code", connected: { "claude-code": true } }),
  sessions: { dir: () => dir },
  imageFinder: new ImageFinder({ dir: path.join(dir, "img") }),
  send: (_, event) => {
    if (event.type === "action") actions.push(event.action);
    if (event.type === "error") console.log("ERROR", event.message);
  },
});
const timer = setTimeout(() => service.cancel(), 600000);
const history = [{ role: "student", text: topic, via: "typed" }];
const totals = { images: 0, annotate: 0, show: 0, focus: 0, maps: 0, visuals: 0, cues: 0, says: 0, maxSaysWithoutVisual: 0 };
const TEXT_ONLY = new Set(["write", "page", "section", "say", "pause", "end"]);
try {
  for (let n = 0; n < segments; n++) {
    actions = [];
    const task = n ? { kind: "continue" } : { kind: "start", text: topic };
    const result = await service.turn({ turnId: `live-${n}`, sessionId: "live-sync", topic, history, task });
    console.log(`\n===== segment ${n + 1} (${result.ok ? "ok" : "failed"}) =====`);
    let lastLine = null;
    let run = 0;
    let lastSayLine = null;
    for (const a of actions) {
      console.log(a.type.padEnd(8), (a.type === "say" ? a.text : a.raw || JSON.stringify(a.data || a.text || "")).slice(0, 240));
      if (a.type === "say") {
        if (lastLine === a.line && history.at(-1)?.text.startsWith("say:")) history.at(-1).text += " " + a.text;
        else history.push({ role: "tutor", text: "say: " + a.text });
        lastLine = a.line;
      } else if (a.raw) history.push({ role: "tutor", text: a.raw });
      if (a.type === "image") totals.images++;
      if (a.type === "map") totals.maps++;
      if (a.type === "annotate") { totals.annotate++; if (/"focus"/.test(a.raw || "")) totals.focus++; }
      if (a.type === "say" && /\{show:/.test(a.text)) totals.show++;
      // Visual density: board visuals plus in-speech visual cues, against say lines.
      const cues = a.type === "say" ? (a.text.match(/\{(show|zoom|trace):/g) || []).length : 0;
      if (!TEXT_ONLY.has(a.type)) totals.visuals++;
      totals.cues += cues;
      if (a.type === "say" && a.line !== lastSayLine) { totals.says++; run = cues ? 0 : run + 1; lastSayLine = a.line; }
      else if (a.type === "say" && cues) run = 0;
      if (!TEXT_ONLY.has(a.type)) run = 0;
      totals.maxSaysWithoutVisual = Math.max(totals.maxSaysWithoutVisual, run);
    }
    if (actions.some((a) => a.type === "end" && a.value === "wait")) {
      history.push({ role: "student", text: "(answered the question correctly)", via: "typed" });
    }
  }
  console.log("\nTOTALS", JSON.stringify(totals));
  if (!totals.images || !totals.annotate || !totals.show) process.exitCode = 1;
} finally {
  clearTimeout(timer);
  fs.rmSync(dir, { recursive: true, force: true });
}
