import test from "node:test";
import assert from "node:assert/strict";
import { StreamParser, parseAll, repairHtml } from "../electron/stream-parser.js";

test("repairHtml closes dangling style tags", () => {
  const bad = "<style>.s .big { color: red; }<div class='s'>Hello</div>";
  const fixed = repairHtml(bad);
  assert.ok(fixed.includes("</style>"));
  assert.ok(fixed.includes("<div class='s'>Hello</div>"));
});

test("parseAll parses title, scenes, beats, html, and js", () => {
  const input = `
<ml-title>Test Lesson</ml-title>
<ml-scene title="Scene One">
  <ml-say>Hello, this is beat one.</ml-say>
  <ml-say>And this is beat two.</ml-say>
  <ml-html>
    <style>.s { color: #fff; }</style>
    <div class="s ml-fill"><h1>Title</h1></div>
  </ml-html>
  <ml-js>
    const el = ML.$('h1');
    function render(s) { ML.show(el, s.at(0)); }
  </ml-js>
</ml-scene>
`;
  const result = parseAll(input);
  assert.equal(result.title, "Test Lesson");
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].title, "Scene One");
  assert.equal(result.scenes[0].beats.length, 2);
  assert.equal(result.scenes[0].beats[0].text, "Hello, this is beat one.");
  assert.ok(result.scenes[0].html.includes("<h1>Title</h1>"));
  assert.ok(result.scenes[0].js.includes("function render"));
});
