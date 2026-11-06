import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { exportProject, importProject } from "../electron/project-archive.js";

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-project-package-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workspaceDir = path.join(dir, "original project");
  const audioDir = path.join(dir, "audio");
  fs.mkdirSync(workspaceDir); fs.mkdirSync(audioDir);
  fs.mkdirSync(path.join(workspaceDir, "attachments"));
  const data = Buffer.alloc(100, 4);
  data.write("RIFF", 0); data.write("WAVE", 8);
  fs.writeFileSync(path.join(audioDir, "clip1.wav"), data);
  fs.writeFileSync(path.join(workspaceDir, "index1.html"), '<img src="attachments/photo.png"><script>const project="mylecture://app/lib/old-project/index1.html";</script>');
  fs.writeFileSync(path.join(workspaceDir, ".playback-index1-test.html"), "Playback snapshot");
  fs.writeFileSync(path.join(workspaceDir, "attachments/photo.png"), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(workspaceDir, "narration-edits.json"), JSON.stringify({ version: 1, files: { "index1.html": { intro: { text: "Caption", ttsText: "Custom pronunciation" } } } }));
  fs.writeFileSync(path.join(workspaceDir, "script.md"), "N: Custom pronunciation");
  fs.writeFileSync(path.join(dir, "settings.json"), "PRIVATE APP SETTINGS");
  const attachment = { name: "photo.png", path: path.join(workspaceDir, "attachments/photo.png") };
  const lecture = { id: "old-project", format: "lecturegen-1", source: "ide", title: "Shared project", renders: ["C:/private/render.mp4"], attachments: [attachment], chat: [{ role: "user", text: "Make this video", attachments: [attachment] }], scenes: [{ kind: "html", file: "index1.html", playbackFile: ".playback-index1-test.html", beats: [{ text: "Caption", ttsText: "Custom pronunciation", spokenText: "Custom pronunciation", audio: "clip1", dur: 2, segment: { id: "intro" } }] }] };
  fs.writeFileSync(path.join(workspaceDir, "lecture.json"), JSON.stringify(lecture));
  const file = path.join(dir, "shared.lecture");
  const libraryDir = path.join(dir, "recipient library"), recipientAudio = path.join(dir, "recipient audio");
  return { dir, workspaceDir, audioDir, lecture, file, libraryDir, recipientAudio, data };
}

test("project sharing round trips sources, assets, narration, chat and portable attachment paths", async t => {
  const f = setup(t);
  await exportProject(f);
  const zip = await JSZip.loadAsync(fs.readFileSync(f.file));
  assert(!Object.keys(zip.files).some(n => n.includes("settings.json")));
  const packed = JSON.parse(await zip.file("project/lecture.json").async("string"));
  assert.equal(packed.attachments[0].path, "./attachments/photo.png");
  const imported = await importProject({ file: f.file, libraryDir: f.libraryDir, audioDir: f.recipientAudio, id: "new-project" });
  assert.equal(imported.id, "new-project");
  assert.equal(imported.title, f.lecture.title);
  assert.equal(imported.renders, undefined);
  assert.equal(imported.scenes[0].beats[0].spokenText, "Custom pronunciation");
  assert.equal(imported.attachments[0].path, path.join(f.libraryDir, "new-project", "attachments", "photo.png"));
  assert.equal(imported.chat[0].attachments[0].path, imported.attachments[0].path);
  assert.deepEqual(fs.readFileSync(path.join(f.recipientAudio, "clip1.wav")), f.data);
  const ws = path.join(f.libraryDir, "new-project");
  assert(fs.readFileSync(path.join(ws, "index1.html"), "utf8").includes("mylecture://app/lib/new-project/"));
  assert.equal(fs.readFileSync(path.join(ws, "script.md"), "utf8"), "N: Custom pronunciation");
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, "narration-edits.json"))).files["index1.html"].intro.ttsText, "Custom pronunciation");
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspaceDir, "lecture.json"))).id, "old-project");
});

test("import never overwrites another project's narration or an existing project", async t => {
  const f = setup(t);
  await exportProject(f);
  fs.mkdirSync(f.recipientAudio);
  const existing = Buffer.from("Different cached recording");
  fs.writeFileSync(path.join(f.recipientAudio, "clip1.wav"), existing);
  const imported = await importProject({ file: f.file, libraryDir: f.libraryDir, audioDir: f.recipientAudio, id: "new-project" });
  const key = imported.scenes[0].beats[0].audio;
  assert.notEqual(key, "clip1");
  assert.deepEqual(fs.readFileSync(path.join(f.recipientAudio, "clip1.wav")), existing);
  assert.deepEqual(fs.readFileSync(path.join(f.recipientAudio, key + ".wav")), f.data);
  const saved = fs.readFileSync(path.join(f.libraryDir, "new-project", "lecture.json"));
  await assert.rejects(importProject({ file: f.file, libraryDir: f.libraryDir, audioDir: f.recipientAudio, id: "new-project" }), /already exists/);
  assert.deepEqual(fs.readFileSync(path.join(f.libraryDir, "new-project", "lecture.json")), saved);
});

test("malformed packages are refused without publishing partial projects", async t => {
  const f = setup(t);
  await exportProject(f);
  const original = fs.readFileSync(f.file);
  for (const [name, mutate, expected] of [
    ["traversal", zip => zip.file("project/../../escaped.txt", "escape"), /Invalid path/],
    ["case collision", zip => zip.file("project/INDEX1.html", "conflict"), /conflicting/],
    ["missing audio", zip => zip.remove("audio/clip1.wav"), /missing narration/],
    ["missing scene", zip => zip.remove("project/index1.html"), /missing index1/],
    ["linked file", zip => zip.file("project/link", "outside", { unixPermissions: 0xa1ff }), /Linked files/],
  ]) {
    const zip = await JSZip.loadAsync(original);
    mutate(zip);
    fs.writeFileSync(f.file, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" }));
    await assert.rejects(importProject({ file: f.file, libraryDir: f.libraryDir, audioDir: f.recipientAudio, id: "bad-project" }), expected, name);
    assert(!fs.existsSync(path.join(f.libraryDir, "bad-project")));
    assert(!fs.existsSync(path.join(f.dir, "escaped.txt")));
  }
});

test("canceling a package export preserves the previous file and removes temporary output", async t => {
  const f = setup(t);
  fs.writeFileSync(f.file, "Previous export");
  const abort = new AbortController();
  setImmediate(() => abort.abort());
  await assert.rejects(exportProject({ ...f, signal: abort.signal }), { name: "AbortError" });
  assert.equal(fs.readFileSync(f.file, "utf8"), "Previous export");
  assert(!fs.readdirSync(f.dir).some(name => name.endsWith(".tmp")));
});
