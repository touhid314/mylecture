import test from "node:test";
import assert from "node:assert/strict";
import { createTutorParser, takeSentences, lineToAction, parseLooseJson } from "../electron/tutor/protocol.js";
import { buildTurn, formatHistory, filesContext, TUTOR_SYSTEM } from "../electron/tutor/prompt.js";
import { compileExpr, checkNumber, checkText, parseNumber } from "../app/js/study/expr.js";
import { titleScore } from "../electron/tutor/images.js";
import { textAnchor } from "../app/js/study/scene.js";

function parseAll(text, chunk = 7) {
  const out = [];
  const p = createTutorParser((a) => out.push(a));
  for (let i = 0; i < text.length; i += chunk) p.feed(text.slice(i, i + chunk));
  p.end();
  return out;
}

test("say lines stream sentence by sentence before the line ends", () => {
  const seen = [];
  const p = createTutorParser((a) => seen.push(a));
  p.feed("say: Okay, so the first idea is really simple, honestly, once you see the picture. Now the second idea takes");
  assert.equal(seen.length, 1, "first sentence is emitted while the line is still streaming");
  assert.match(seen[0].text, /^Okay, so the first idea/);
  p.feed(" a bit longer to explain.\nwrite: ## Heading\n");
  p.end();
  assert.deepEqual(seen.map((a) => a.type), ["say", "say", "write"]);
  assert.equal(seen[1].text, "Now the second idea takes a bit longer to explain.");
  assert.equal(seen[0].line, seen[1].line);
});

test("board, interactive and control lines parse", () => {
  const acts = parseAll([
    'plan: ["Intro", "Core idea"]',
    "section: 1",
    "page: The big picture",
    "math: e^{i\\pi} + 1 = 0",
    'plot: {"fns": ["x^2"], "x": [-2, 2],}',
    'ask: {"id": "q1", "type": "mcq", "q": "Pick", "options": ["a", "b"], "answer": 1}',
    'scene: {"items": [{"type": "emoji", "id": "car", "char": "🚗", "x": 10, "y": 10}]}',
    "pause: 1.5",
    "end: wait",
  ].join("\n"));
  assert.deepEqual(acts.map((a) => a.type), ["plan", "section", "page", "math", "plot", "ask", "scene", "pause", "end"]);
  assert.deepEqual(acts[0].items, ["Intro", "Core idea"]);
  assert.equal(acts[4].data.fns[0], "x^2", "trailing commas are tolerated");
  assert.equal(acts[5].data.answer, 1);
  assert.equal(acts[7].seconds, 1.5);
  assert.equal(acts[8].value, "wait");
});

test("prose without a command is spoken, fences are ignored", () => {
  assert.equal(lineToAction("Well, let's begin.").type, "say");
  assert.equal(lineToAction("```"), null);
  assert.equal(parseLooseJson('```json\n{"a": 1}\n```').a, 1);
});

test("short sentences are grouped so the voice isn't choppy", () => {
  const [s] = takeSentences("Right. So. Now look at this equation here, it's the key. Okay? ", { final: true });
  assert.ok(s.every((x) => x.length >= 20 || s.length === 1));
});

test("the prompt carries plan, history and the task", () => {
  const user = buildTurn({ topic: "Derivatives", plan: ["Idea", "Rules"], section: 1, history: [{ role: "tutor", text: "say: Hi." }, { role: "student", text: "why?", via: "voice" }], task: { kind: "continue" } });
  assert.match(user, /1\. Idea\s+<- current section/);
  assert.match(user, /STUDENT \(voice\): why\?/);
  assert.match(user, /Continue the lesson/);
  assert.match(TUTOR_SYSTEM, /end: continue/);
  const long = Array.from({ length: 3000 }, (_, i) => ({ role: "tutor", text: i % 2 ? `say: sentence number ${i} with some words` : `write: note ${i}` }));
  const h = formatHistory(long);
  assert.ok(h.length < 70000);
  assert.match(h, /write: note 0/, "early board notes are kept");
});

test("plot expressions are safe and correct", () => {
  const f = (e, v) => compileExpr(e, ["x", "a"])(v);
  assert.equal(f("-x^2", { x: 3 }), -9);
  assert.equal(f("2x+1", { x: 2 }), 5);
  assert.equal(f("(x+1)(x-1)", { x: 3 }), 8);
  assert.equal(f("a*sin(pi/2)", { a: 2 }), 2);
  assert.equal(f("5!", {}), 120);
  assert.throws(() => compileExpr("constructor"));
  assert.throws(() => compileExpr("alert(1)"));
  assert.throws(() => compileExpr("x.constructor"));
});

test("long saved lessons tolerate missing history text from old board messages", () => {
  const history = Array.from({ length: 1500 }, (_, i) => ({ role: "tutor", text: `say: Previous lesson sentence ${i} explaining the current topic in detail.` }));
  history.push({ role: "tutor" }, null, { role: "tutor", text: null });
  history.push({ role: "student", text: "Please continue the explanation.", via: "voice" });
  const prompt = buildTurn({ topic: "Saved lesson", history, task: { kind: "student", text: "Continue" } });
  assert.match(prompt, /Please continue the explanation/);
  assert.doesNotMatch(prompt, /undefined|null/);
});

test("answers are checked leniently", () => {
  assert.equal(checkNumber("3/4", 0.75), true);
  assert.equal(checkNumber("41", 42), false);
  assert.equal(checkNumber("42.1", 42, 0.2), true);
  assert.equal(parseNumber("2^10"), 1024);
  assert.equal(checkText("$3x^2$", "3x^2"), true);
  assert.equal(checkText("something else", "3x^2"), null, "unclear answers go to the tutor");
});

test("image search prefers titles that match the query", () => {
  assert.ok(titleScore("human heart anatomy diagram", "File:Diagram of the human heart.svg") >= 0.6);
  assert.ok(titleScore("Earth axial tilt seasons", "File:Equation of Time clock prototype.jpg") < 0.3);
});

test("scene text near left edge or shape left margin left-aligns instead of clipping", () => {
  const recap = [
    { type: "text", id: "s1", x: 40, y: 45, text: "1. Sunlight contains all colors as waves", size: 15 },
    { type: "text", id: "s2", x: 300, y: 100, text: "Centered label", size: 20 },
  ];
  assert.equal(textAnchor(recap[0], recap, 600), "start");
  assert.equal(textAnchor(recap[1], recap, 600), "middle");
});

test("the parser announces what comes next before that line finishes", () => {
  const seen = [];
  const p = createTutorParser((a) => seen.push(a.type), { onUpcoming: (k) => seen.push(`next:${k}`) });
  p.feed("say: Okay, so the first idea is really simple, honestly, once you see the picture. Now watch the car as it");
  p.feed(" speeds up along the road.\nscene#road: {\"w\": 600, \"items\": [");
  // The say line goes on (announced once), then a scene starts streaming.
  assert.deepEqual(seen, ["say", "next:say", "say", "next:scene"]);
  p.feed("]}\nend: continue\n");
  p.end();
  assert.deepEqual(seen, ["say", "next:say", "say", "next:scene", "scene", "end"]);
});

test("shared pictures and documents are included in the tutor turn prompt", () => {
  const attachments = [
    { name: "old.png", mime: "image/png" },
    { name: "p1.png", mime: "image/png" },
    { name: "p2.jpg", mime: "image/jpeg" },
    { name: "p3.webp", mime: "image/webp" },
    { name: "p4.gif", mime: "image/gif" },
    { name: "notes.pdf", mime: "application/pdf", text: "Key theorem: a^2 + b^2 = c^2." },
  ];
  const ctx = filesContext(attachments);
  assert.match(ctx, /old\.png: a picture shared earlier/);
  assert.match(ctx, /p4\.gif: a picture, attached to this message/);
  assert.match(ctx, /notes\.pdf:\n<<<\nKey theorem: a\^2 \+ b\^2 = c\^2\.\n>>>/);
  const turn = buildTurn({ topic: "Pythagoras", task: { kind: "start", text: "Help me" }, attachments });
  assert.match(turn, /FILES THE STUDENT SHARED/);
});
