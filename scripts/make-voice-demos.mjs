// Pre-records the voice-menu demo for every bundled voice, so pressing play
// never has to generate speech.
//   node scripts/make-voice-demos.mjs [--force] [--only kokoro|omnivoice]
// Output: electron/tts/demos/kokoro/<voice>.mp3 and
//         electron/tts/voices/<voice>/demo.mp3 (and voices-dev/<voice>/demo.mp3).
// Uses the local models in MyLecture's userData (%APPDATA%/MyLecture/models).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const { DEMO_TEXT, kokoroDemoFile, omniDemoFile } = await import(new URL("../electron/tts/demos.js", import.meta.url));
const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
const userData = process.env.MYLECTURE_USERDATA || path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "MyLecture");
const modelDir = path.join(userData, "models");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-demos-"));

function toMp3(wav, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k", out]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}

if (only !== "omnivoice") {
  const src = fs.readFileSync(path.join(root, "electron/tts/index.js"), "utf8");
  const voices = [...src.slice(src.indexOf("KOKORO_VOICES"), src.indexOf("];", src.indexOf("KOKORO_VOICES"))).matchAll(/\["([a-z]{2}_\w+)"/g)].map((m) => m[1]);
  const todo = voices.filter((v) => force || !fs.existsSync(kokoroDemoFile(v)));
  if (todo.length) {
    const { env } = await import("@huggingface/transformers");
    const { KokoroTTS } = await import("kokoro-js");
    env.cacheDir = modelDir;
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
    for (const voice of todo) {
      const wav = path.join(tmp, `${voice}.wav`);
      await (await tts.generate(DEMO_TEXT, { voice, speed: 1 })).save(wav);
      toMp3(wav, kokoroDemoFile(voice));
      console.log("kokoro", voice);
    }
  }
}

if (only !== "kokoro") {
  const { OmniVoice, OMNIVOICE_VOICES } = await import(new URL("../electron/tts/omnivoice.js", import.meta.url));
  const todo = OMNIVOICE_VOICES.filter(([id]) => force || !fs.existsSync(omniDemoFile(id)));
  if (todo.length) {
    const omni = new OmniVoice({ modelDir, getSettings: () => ({}) });
    try {
      for (const [id] of todo) {
        const wav = path.join(tmp, `${id}.wav`);
        await omni.synth(DEMO_TEXT, wav, { voice: id, speed: 1 });
        toMp3(wav, omniDemoFile(id));
        console.log("omnivoice", id);
      }
    } finally {
      omni.stop();
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log("done");
process.exit(0);
