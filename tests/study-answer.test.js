import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { studyPrompts, withEngine } from "../electron/lecturegen/run.js";

test("Study removes runtime budgeting while retaining the original teaching instructions", () => {
  const original = fs.readFileSync(new URL("../electron/lecturegen/src/prompts/ansgen_system.md", import.meta.url), "utf8");
  const p = studyPrompts({ system: original, user: "Request Topic: What is 2 + 2?\nRequested Length: 5:00", purpose: "lecturegen_answer_generator", history: [{ question: "What is addition?", answer: "Combining quantities." }] });
  assert(!p.user.includes("Requested Length"));
  assert(!p.system.includes("1 minute of talking"));
  assert(p.system.includes("you never skip a logical link"));
  assert(p.system.includes("simple question may need one sentence"));
  assert(p.user.includes("Combining quantities."));
});

test("Study visuals adapt the completed answer without a duration target", () => {
  const p = studyPrompts({ system: "Original visual rules\n- Remember, about 150 words of narration = 1 minute", user: "Requested Length: 2:00\n\nHere is the concept explanation (narration):\n4.", purpose: "lecturegen_script_writer" });
  assert(p.system.includes("Original visual rules"));
  assert(p.system.includes("without adding unrelated material or omitting its reasoning"));
  assert(!p.user.includes("Requested Length"));
  assert(p.user.endsWith("4."));
});

test("Create transport preserves its duration and prompts exactly", async () => {
  const request = { system: "Original visual rules", user: "Requested Length: 3:00", purpose: "lecturegen_script_writer" };
  let received;
  const engine = { generate: async payload => { received = payload; return { text: "script" }; } };
  await withEngine({ engine, signal: new AbortController().signal }, () => globalThis.__ML_LLM__.generate(request));
  assert.equal(received.system, request.system);
  assert.equal(received.user, request.user);
});
