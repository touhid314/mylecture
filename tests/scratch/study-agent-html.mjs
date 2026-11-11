// Manual native-provider smoke check; requires a connected Claude account.
import { claudeCode } from "../../electron/engines/claude-code.js";
import { TutorService } from "../../electron/tutor/service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-live-agent-"));
const actions = [];
const service = new TutorService({
  engines: new Map([["claude-code", claudeCode]]),
  getSettings: () => ({ engine: "claude-code", connected: { "claude-code": true } }),
  sessions: { dir: () => dir },
  send: (_, event) => {
    if (event.type === "action") { actions.push(event.action); console.log("ACTION", event.action.type); }
    if (event.type === "error") console.log("ERROR", event.message);
  },
});
const timer = setTimeout(() => service.cancel(), 90000);
try {
  const result = await service.turn({ turnId: "agent-smoke", sessionId: "smoke", topic: "An interactive circle", task: {
    kind: "start",
    text: "Developer smoke check: speak only one brief sentence. Use your native file-writing tool to create visual.html inside the lesson workspace, containing an HTML button that changes a circle's color. Then publish it with html#demo and end: wait. Do not search, use the browser, make a plan or ask questions for this short check.",
  } });
  const published = actions.some((a) => a.type === "html" && a.data?.src);
  console.log("RESULT", JSON.stringify(result), "NATIVE_FILE", fs.existsSync(path.join(dir, "visual.html")), "HTML_PUBLISHED", published);
  if (!result.ok || !published) process.exitCode = 1;
} finally {
  clearTimeout(timer);
  fs.rmSync(dir, { recursive: true, force: true });
}
