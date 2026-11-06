import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { registerHooks } from "node:module";

const fixture = { project: null, dir: "", saves: 0 };
globalThis.__narrationFixture = fixture;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: "test:electron-narration", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "test:electron-narration") return { format: "module", shortCircuit: true, source: "export const utilityProcess={};export const BrowserWindow={};export const ipcMain={};" };
    if (url.endsWith("/electron/store.js")) return { format: "module", shortCircuit: true, source: `const f=globalThis.__narrationFixture;export const lectures={get:()=>f.project,dir:()=>f.dir,save:()=>{f.saves++;}};export const getSettings=()=>({});export const paths={};` };
    if (url.endsWith("/electron/generator.js")) return { format: "module", shortCircuit: true, source: 'export const audioUrl=key=>"audio:"+key;export const sceneUrl=(id,file)=>"scene:"+id+"/"+file;' };
    if (url.endsWith("/electron/exporter.js")) return { format: "module", shortCircuit: true, source: "export const exportMp4=()=>{};" };
    return nextLoad(url, context);
  },
});
const { IdeService } = await import("../electron/ide.js");
const { lecturegen, resolveBeats } = await import("../electron/lecturegen/run.js");
const { normalizeForSpeech } = await import("../electron/tts/index.js");
const lg = await lecturegen();
test.after(() => { hooks.deregister(); delete globalThis.__narrationFixture; });

test("all-scene narration returns persisted engine input and normalizes old beats with the real pipeline", async () => {
  const source = "NASA costs $12.50 → **π** × r^2";
  const expected = normalizeForSpeech(lg.normalizeTtsText(source));
  assert.notEqual(expected, source);
  fixture.project = { scenes: [
    { beats: [
      { text: "Caption differs", ttsText: source, segment: { id: "intro" } },
      { text: "Hidden", visualOnly: true, segment: { id: "visual" } },
    ] },
    { beats: [
      { text: "Caption two", ttsText: "Changed source", spokenText: "Exact previously submitted text", segment: { id: "detail" } },
      { text: "An intentionally silent cue", spokenText: "", segment: { id: "silent" } },
      { text: "No editable section" },
    ] },
  ] };
  const ide = new IdeService({ send() {} });
  assert.deepEqual(await ide.narration("project"), [
    { sceneIndex: 0, beatIndex: 0, sectionId: "intro", spokenText: expected, caption: "Caption differs" },
    { sceneIndex: 1, beatIndex: 0, sectionId: "detail", spokenText: "Exact previously submitted text", caption: "Caption two" },
    { sceneIndex: 1, beatIndex: 1, sectionId: "silent", spokenText: "", caption: "An intentionally silent cue" },
    { sceneIndex: 1, beatIndex: 2, sectionId: null, spokenText: "No editable section", caption: "No editable section" },
  ]);
});

test("resolve and narration edits persist exact spoken strings while preserving caption and source text", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-narration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fixture.dir = dir;
  const raw = { id: "part1", kind: "narration+visual", text: "Caption with numbers: 42", ttsText: "**NASA** → 42" };
  const synth = async input => ({ key: crypto.createHash("sha1").update(input).digest("hex"), dur: 1, spokenText: normalizeForSpeech(input) });
  const page = { addInitScript: async () => {}, goto: async () => {}, evaluate: async () => [raw], close: async () => {} };
  const beats = await resolveBeats({ lg, browser: { newPage: async () => page }, workspaceDir: dir, file: "index1.html", tts: { synth } });
  assert.equal(beats[0].spokenText, normalizeForSpeech(lg.normalizeTtsText(raw.ttsText)));
  assert.equal(beats[0].text, raw.text);
  assert.equal(beats[0].ttsText, raw.ttsText);
  fixture.project = { id: "project", scenes: [{ file: "index1.html", beats }] };
  const ide = new IdeService({ tts: { synth }, send() {} });
  const originalAudio = beats[0].audio;
  const requested = "Dr. Mark Tehranipoor explains **π** × 3";
  await ide.editNarration("project", { sceneIndex: 0, sectionId: "part1", text: raw.text, ttsText: requested });
  assert.equal(beats[0].spokenText, normalizeForSpeech(requested));
  assert.notEqual(beats[0].audio, originalAudio);
  assert.equal(beats[0].text, raw.text);
  assert.equal(beats[0].ttsText, requested);
  await ide.editNarration("project", { sceneIndex: 0, sectionId: "part1", text: "  Exact caption spacing  ", ttsText: requested });
  assert.equal(beats[0].text, "  Exact caption spacing  ");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "narration-edits.json"))).files["index1.html"].part1.ttsText, requested);
  const reloaded = await resolveBeats({ lg, browser: { newPage: async () => page }, workspaceDir: dir, file: "index1.html", tts: { synth } });
  assert.equal(reloaded[0].spokenText, normalizeForSpeech(requested), "manual pronunciation survives re-resolving the scene");
  assert.equal(reloaded[0].audio, beats[0].audio);
  await ide.editNarration("project", { sceneIndex: 0, sectionId: "part1", text: "", ttsText: "Audio-only narration" });
  assert.equal(beats[0].text, "");
  assert.equal(beats[0].spokenText, "Audio-only narration");
  const resolved = await resolveBeats({ lg, browser: { newPage: async () => page }, workspaceDir: dir, file: ".playback-index1-fixture.html", sourceFile: "index1.html", tts: { synth } });
  assert.equal(resolved[0].text, "");
  assert.equal(resolved[0].spokenText, "Audio-only narration");
});
