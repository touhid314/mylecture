// Isolated app entry for the real Electron integration check.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
const dir = process.env.ML_TEST_DIR;
if (!dir) throw new Error("ML_TEST_DIR is required");
fs.mkdirSync(dir, { recursive: true });
app.setPath("userData", dir);
app.setPath("videos", dir);
if (process.env.ML_TEST_HIDDEN === "1") app.on("browser-window-created", (_event, win) => win.hide());
fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ voiceEngine: "system", onboarded: true }));
await import("../../electron/main.js");
