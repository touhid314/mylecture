// Actual local synthesis through both app voice backends; preserves user settings.
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
app.setName("MyLecture");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-voice-app-")));
app.whenReady().then(main);
async function main() {
const { TTSService, wavInfo } = await import("../../electron/tts/index.js");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-voices-"));
const settings = { voiceEngine: "kokoro", voice: "af_heart", omnivoiceVoice: "maruf", voiceSpeed: 1 };
const tts = new TTSService({ cacheDir: out, modelDir: path.join(app.getPath("appData"), "MyLecture", "models"), getSettings: () => settings });
tts.on("status", st => console.log("STATUS", JSON.stringify({ kokoro: st.kokoro.state, omnivoice: st.omnivoice })));
let code = 0;
try {
  for (const engine of ["kokoro", "omnivoice"]) {
    settings.voiceEngine = engine;
    const start = Date.now();
    const r = await tts.synth("Equal areas in equal times explain how a planet moves around the Sun.", { engine });
    const buf = fs.readFileSync(r.file), info = wavInfo(buf);
    let peak = 0;
    for (let i = info.dataOffset; i + 1 < info.dataOffset + info.dataBytes; i += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
    if (r.engine !== engine || r.dur < 1 || peak < 100) throw new Error(`${engine} did not produce real audio`);
    const cached = await tts.synth("Equal areas in equal times explain how a planet moves around the Sun.", { engine });
    if (cached.key !== r.key) throw new Error("Cache mismatch");
    console.log("SYNTH_OK", JSON.stringify({ ...r, bytes: buf.length, peak, sampleRate: info.sampleRate, elapsedMs: Date.now() - start }));
    const warmStart = Date.now();
    const worker = engine === "omnivoice" ? tts.omni.child.pid : tts.worker.pid;
    const second = await tts.synth("The same warm voice worker records the next sentence.", { engine });
    if (second.engine !== engine || second.key === r.key || second.dur < 1) throw new Error("Warm synthesis failed");
    if (worker !== (engine === "omnivoice" ? tts.omni.child.pid : tts.worker.pid)) throw new Error("Worker restarted between clips");
    console.log("WARM_SYNTH_OK", JSON.stringify({ engine, dur: second.dur, elapsedMs: Date.now() - warmStart, worker }));
  }
  console.log("VOICES_E2E_OK", out);
} catch (e) { console.error(e); code = 1; }
finally { tts.stop(); app.exit(code); }
}
