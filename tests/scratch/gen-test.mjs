import fs from "node:fs";
import { antigravity } from "../../electron/engines/antigravity.js";
import { systemPrompt, userPrompt } from "../../electron/prompt.js";
import { StreamParser } from "../../electron/stream-parser.js";

const q = process.argv[2] || "Explain how binary search works";
const model = process.argv[3] || "gemini-3.8-flash-low";
const t0 = Date.now();
const ms = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let first = true;
const parser = new StreamParser({
  title: (t) => console.log(ms(), "TITLE", t),
  beat: (b) => console.log(ms(), `  beat s${b.scene}.${b.index}`, b.text.slice(0, 70)),
  sceneEnd: (e) => console.log(ms(), "SCENE END", e.index, e.scene.title, `html=${e.scene.html.length} js=${e.scene.js.length}`),
});
const r = await antigravity.generate({
  system: systemPrompt({ theme: process.env.ML_THEME || "dark", teachingStyle: process.env.ML_STYLE || "default" }),
  user: userPrompt({ question: q }),
  model,
  onDelta: (d) => {
    if (first) { console.log(ms(), "FIRST TOKEN"); first = false; }
    parser.push(d);
  },
  onStatus: (s) => console.log(ms(), s),
});
const out = parser.end();
console.log(ms(), "DONE", r.usage);
fs.writeFileSync(new URL("./last-gen.json", import.meta.url), JSON.stringify(out, null, 2));
fs.writeFileSync(new URL("./last-gen.txt", import.meta.url), r.text);
