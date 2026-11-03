// Isolated model-output stub used only by study-answer-workflow.cjs.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { antigravity } from "../../electron/engines/antigravity.js";
const dir = process.env.ML_TEST_DIR;
if (!dir) throw new Error("ML_TEST_DIR is required");
fs.mkdirSync(dir, { recursive: true });
app.setPath("userData", dir);
app.setPath("videos", dir);
fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ voiceEngine: "system", length: "deep", onboarded: true }));
globalThis.studyTestCalls = [];
antigravity.generate = async ({ system, user, signal, onDelta }) => {
  globalThis.studyTestCalls.push({ system, user });
  if (system.includes("# Study conversation")) {
    const text = user.includes("Explain multiplication in detail")
      ? "Multiplication combines equal groups. For example, 3 groups of 4 contain 12 objects.\n\nYou can count the objects one at a time, add 4 + 4 + 4, or write 3 × 4 = 12. Each notation describes the same equal groups."
      : "4.";
    const mid = Math.max(1, Math.floor(text.length / 2));
    onDelta(text.slice(0, mid));
    await new Promise(r => setTimeout(r, 300));
    onDelta(text.slice(mid));
    return { text };
  }
  if (system.includes("# Study answer adaptation")) {
    return await new Promise((_resolve, reject) => {
      const stop = () => reject(Object.assign(new Error("Stopped by streaming test"), { aborted: true }));
      signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
    });
  }
  return { text: JSON.stringify({ title: "Study answer", description: "Test answer metadata" }) };
};
await import("../../electron/main.js");
