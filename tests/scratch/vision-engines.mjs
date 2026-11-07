// Checks that each connected subscription engine sees a picture in text mode
// (the live tutor's path). Real (tiny) requests:
//   node tests/scratch/vision-engines.mjs <image.png> [claude-code|codex|antigravity ...]
import { claudeCode } from "../../electron/engines/claude-code.js";
import { codex } from "../../electron/engines/codex.js";
import { antigravity } from "../../electron/engines/antigravity.js";

const [img, ...only] = process.argv.slice(2);
const engines = { "claude-code": claudeCode, codex, antigravity };
for (const [id, engine] of Object.entries(engines)) {
  if (only.length && !only.includes(id)) continue;
  const t0 = Date.now();
  try {
    let out = "";
    await engine.generate({
      system: "Answer in at most five words.",
      user: "What shape and colour is in the attached picture?",
      effort: "low",
      images: [{ path: img, mime: "image/png" }],
      onDelta: (d) => { out += d; },
    });
    console.log(id, `${Date.now() - t0}ms`, JSON.stringify(out.trim()));
  } catch (e) {
    console.log(id, "FAILED", String(e?.message || e).slice(0, 300));
  }
}
