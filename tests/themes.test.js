import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setUserThemesDir, listThemes, getTheme, saveTheme, deleteTheme, themeInstructions, normalizeLook } from "../electron/lecturegen/themes.js";
import { resolveStyleResource, lecturegenCatalog } from "../electron/lecturegen/run.js";

function userDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-themes-"));
  setUserThemesDir(dir);
  t.after(() => { setUserThemesDir(""); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test("built-in themes list with names, looks and readable instructions; hidden ones stay out", t => {
  userDir(t);
  const themes = listThemes();
  assert.equal(themes[0].id, "default");
  for (const id of ["default", "light", "3b1b", "reel", "hand-drawn", "thin-line"]) assert.ok(themes.some(x => x.id === id), id);
  for (const id of ["none", "sat-tutor", "fonts-colors"]) assert.ok(!themes.some(x => x.id === id), id);
  const b = getTheme("3b1b");
  assert.equal(b.name, "3Blue1Brown");
  assert.equal(b.builtin, true);
  assert.equal(b.edited, false);
  assert.match(b.look.background, /^#[0-9a-f]{6}$/);
  assert.ok(!b.instructions.includes("&#x20;"), "rich-text escapes are cleaned for editing");
  assert.equal(lecturegenCatalog().themes[0].id, "auto");
});

test("an unedited built-in reaches the agent exactly as written", t => {
  userDir(t);
  const original = fs.readFileSync(new URL("../electron/lecturegen/resources/themes/light.md", import.meta.url), "utf8").trim();
  assert.equal(resolveStyleResource("light", "themes"), original);
  assert.equal(themeInstructions("light"), original);
});

test("editing a built-in overrides it, adds its colors and font, and reset restores the original", t => {
  const dir = userDir(t);
  const before = getTheme("light");
  const saved = saveTheme({ ...before, name: "Light", instructions: "Paper white, generous margins.", look: { ...before.look, accents: ["#ff0000", "#00ff00", "#0000ff"], font: "Georgia" } });
  assert.equal(saved.id, "light");
  assert.equal(saved.edited, true);
  assert.ok(fs.existsSync(path.join(dir, "light.json")));
  const prompt = resolveStyleResource("light", "themes");
  assert.match(prompt, /^Paper white, generous margins\./);
  assert.match(prompt, /Accent colors: #ff0000, #00ff00, #0000ff/);
  assert.match(prompt, /Font family: 'Georgia'/);
  const r = deleteTheme("light");
  assert.equal(r.restored.edited, false);
  assert.equal(getTheme("light").instructions, before.instructions);
});

test("users add, rename and delete their own themes; bad input is rejected", t => {
  userDir(t);
  const mine = saveTheme({ name: "Chalkboard", instructions: "Green chalkboard, chalk handwriting.", look: { background: "#1f3b2d", text: "#f5f5f0", font: "Caveat" } });
  assert.match(mine.id, /^my-chalkboard-[0-9a-f]{6}$/);
  assert.equal(mine.builtin, false);
  assert.equal(mine.look.background, "#1f3b2d");
  assert.equal(mine.look.accents.length, 3, "missing colors fall back to defaults");
  assert.ok(listThemes().some(x => x.id === mine.id && x.name === "Chalkboard"));
  assert.match(resolveStyleResource(mine.id, "themes"), /Green chalkboard[\s\S]*Background: #1f3b2d/);
  assert.equal(saveTheme({ ...mine, name: "Blackboard" }).name, "Blackboard");
  deleteTheme(mine.id);
  assert.equal(getTheme(mine.id), null);
  assert.throws(() => saveTheme({ ...mine }), /no longer exists/);
  assert.throws(() => saveTheme({ name: "", instructions: "x" }), /name/);
  assert.throws(() => saveTheme({ name: "x", instructions: "  " }), /Describe/);
  assert.throws(() => saveTheme({ id: "../evil", name: "x", instructions: "y" }), /Unknown theme/);
  // An unknown theme id still falls back to the default theme for old projects.
  assert.equal(resolveStyleResource(mine.id, "themes"), resolveStyleResource("default", "themes"));
});

test("looks keep only valid colors and a plain font name", () => {
  const look = normalizeLook({ background: "red", text: "#ABCDEF", accents: ["#123456", "nope"], font: "Comic<script> Neue" });
  assert.equal(look.text, "#abcdef");
  assert.match(look.background, /^#[0-9a-f]{6}$/);
  assert.equal(look.accents[0], "#123456");
  assert.match(look.accents[1], /^#[0-9a-f]{6}$/);
  assert.equal(look.font, "Comicscript Neue");
});
