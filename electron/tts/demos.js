// Pre-recorded voice demos for the voice menus. Pressing play reads a saved
// file; nothing is generated during playback.
//   Kokoro:    electron/tts/demos/kokoro/<voice>.mp3   (scripts/make-voice-demos.mjs)
//   OmniVoice: <voice folder>/demo.mp3  (bundled: the same script; the user's
//              own voices: recorded when the voice is added)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { omniVoiceFolder } from "./omnivoice.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_TEXT = "Hello! This is my voice. Let's learn something new together.";
const safe = (id) => /^[\w-]+$/.test(String(id));

export function kokoroDemoFile(voice) {
  return path.join(here, "demos", "kokoro", `${voice}.mp3`);
}

export function omniDemoFile(id, customDir) {
  const folder = omniVoiceFolder(id, customDir) || path.join(here, "voices", id);
  return path.join(folder, "demo.mp3");
}

export function demoFile(engine, voice, customDir) {
  if (!safe(voice)) return null;
  if (engine === "kokoro") return kokoroDemoFile(voice);
  if (engine === "omnivoice") return omniDemoFile(voice, customDir);
  return null;
}

// The saved demo as a data: URL (small MP3s; allowed by the renderer CSP), or null.
export function readDemo(engine, voice, customDir) {
  const file = demoFile(engine, voice, customDir);
  if (!file || !fs.existsSync(file)) return null;
  return "data:audio/mpeg;base64," + fs.readFileSync(file).toString("base64");
}
