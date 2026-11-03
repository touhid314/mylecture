import { KokoroTTS, env } from "kokoro-js";
const t0 = Date.now();
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: process.env.DT, device: process.env.DEV });
console.log("load ms", Date.now() - t0);
for (const s of ["Binary search finds a target by repeatedly halving the search range.", "Each comparison throws away half of the remaining elements, so even a million items take only about twenty steps."]) {
  const t1 = Date.now();
  const audio = await tts.generate(s, { voice: "af_heart" });
  console.log("gen ms", Date.now() - t1, "audio s", (audio.audio.length / audio.sampling_rate).toFixed(2), audio.sampling_rate);
}
