import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gatePlayableLecture, isPlayableScene, withAvailableNarration, writePlaybackSnapshot } from "../electron/scene-readiness.js";

const narrated = (extra = {}) => ({ beats: [{ text: "Hello", audio: "a-good-key", dur: 1, ...extra }] });

test("playable scenes require every narrated cue, finite timing and a safe cached audio key", () => {
  const exists = key => key === "a-good-key";
  assert.equal(isPlayableScene(narrated(), exists), true);
  for (const beat of [{ audio: "" }, { audio: "missing" }, { audio: "../escape" }, { audio: "x.wav" }, { dur: 0 }, { dur: -1 }, { dur: NaN }, { dur: Infinity }, { dur: "1" }]) {
    assert.equal(isPlayableScene(narrated(beat), exists), false);
  }
  assert.equal(isPlayableScene({ beats: [] }, exists), false);
  assert.equal(isPlayableScene({ beats: [narrated().beats[0], { text: "Pending" }] }, exists), false);
  assert.equal(isPlayableScene(narrated(), () => { throw Error("missing cache"); }), false);
});

test("intentional visual-only cues are playable without narration audio", () => {
  const unavailable = () => { throw Error("must not access audio"); };
  assert.equal(isPlayableScene({ beats: [{ visualOnly: true, dur: 2 }] }, unavailable), true);
  assert.equal(isPlayableScene({ beats: [{ segment: { kind: "visual-only" }, dur: 2 }] }, unavailable), true);
  assert.equal(isPlayableScene({ beats: [{ visualOnly: true, dur: 0 }] }, unavailable), false);
});

test("one unfinished scene withholds the whole video without mutating persisted scenes or indices", () => {
  const lecture = { id: "p", status: "ready", duration: 3, scenes: [narrated(), narrated({ audio: "missing" }), narrated()], chat: [{ text: "Keep me" }] };
  const before = structuredClone(lecture);
  const gated = gatePlayableLecture(lecture, key => key === "a-good-key");
  assert.deepEqual(gated.scenes, []);
  assert.equal(gated.status, "partial");
  assert.equal(gated.narrationPending, true);
  assert.equal(gated.duration, 0);
  assert.equal(gated.chat, lecture.chat);
  assert.deepEqual(lecture, before);
  const repaired = gatePlayableLecture(lecture, () => true);
  assert.equal(repaired.narrationPending, false);
  assert.equal(repaired.scenes, lecture.scenes);
  assert.equal(repaired.scenes.length, 3);
});

test("real cache files are required; empty files and directories cannot unlock playback", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-readiness-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lecture = { scenes: [narrated()], duration: 1, status: "ready" };
  assert.equal(withAvailableNarration(lecture, dir).narrationPending, true);
  const file = path.join(dir, "a-good-key.wav");
  fs.writeFileSync(file, "");
  assert.equal(withAvailableNarration(lecture, dir).narrationPending, true);
  fs.writeFileSync(file, Buffer.alloc(46));
  assert.equal(withAvailableNarration(lecture, dir).narrationPending, false);
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.equal(withAvailableNarration(lecture, dir).narrationPending, true);
  assert.equal(withAvailableNarration(lecture, undefined).narrationPending, true);
});

test("an empty project still opens normally", () => {
  assert.equal(gatePlayableLecture(null, () => false), null);
  const lecture = { status: "generating", scenes: [] };
  assert.equal(gatePlayableLecture(lecture, () => false).status, "generating");
  assert.equal(gatePlayableLecture(lecture, () => false).narrationPending, false);
});

test("playback snapshots stay paired with the resolved HTML while mutable sources change", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-playback-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = "<!doctype html><p>Original narration</p>";
  const after = "<!doctype html><p>Changed narration</p>";
  fs.writeFileSync(path.join(dir, "index1.html"), before);
  const first = writePlaybackSnapshot(dir, "index1.html", before);
  assert.match(first, /^\.playback-index1-[a-f0-9]{24}\.html$/);
  fs.writeFileSync(path.join(dir, "index1.html"), after);
  assert.equal(fs.readFileSync(path.join(dir, first), "utf8"), before);
  assert.equal(writePlaybackSnapshot(dir, "index1.html", before), first);
  assert.notEqual(writePlaybackSnapshot(dir, "index1.html", after), first);
  for (const name of ["../index1.html", "sub/index1.html", "index.html", "index1.html/other", ".playback-index1.html"]) {
    assert.throws(() => writePlaybackSnapshot(dir, name, before), /Invalid playback/);
  }
});
