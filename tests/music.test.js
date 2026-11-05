import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { normalizeMusic, readMusic, musicMix } from "../electron/music.js";

const project = (meta, files = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-music-"));
  if (meta !== undefined) fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(meta));
  for (const [f, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), data);
  }
  return dir;
};

test("music spec is just the file the agent prepared", () => {
  assert.deepEqual(normalizeMusic("media/a.mp3"), { file: "media/a.mp3" });
  assert.deepEqual(normalizeMusic({ file: "media\\a.mp3", volume: 0.2, duck: true }), { file: "media/a.mp3" });
  assert.equal(normalizeMusic({ volume: 0.2 }), null);
  assert.equal(normalizeMusic(null), null);
});

test("readMusic resolves only existing files inside the project", () => {
  assert.equal(readMusic(project(undefined)), null);
  assert.equal(readMusic(project({ title: "x" })), null);
  assert.equal(readMusic(project({ music: "media/missing.mp3" })), null);
  assert.equal(readMusic(project({ music: "../outside.mp3" })), null);
  const dir = project({ music: { file: "media/song.mp3", volume: 0.25 } }, { "media/song.mp3": "x" });
  const m = readMusic(dir);
  assert.equal(m.path, path.join(dir, "media", "song.mp3"));
});

test("the ffmpeg mix adds the music unchanged and keeps narration length", () => {
  const ff = createRequire(import.meta.url)("ffmpeg-static");
  const dir = project(undefined);
  const n = path.join(dir, "n.wav"), song = path.join(dir, "m.mp3"), out = path.join(dir, "out.m4a");
  const run = (args) => spawnSync(ff, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(run(["-f", "lavfi", "-i", "sine=f=300:d=5", "-ar", "24000", "-ac", "1", n]).status, 0);
  assert.equal(run(["-f", "lavfi", "-i", "sine=f=600:d=8", "-ac", "2", song]).status, 0);
  const mix = musicMix({ file: "m.mp3", path: song }, { narrationInput: 0, musicInput: 1 });
  assert(!/volume|afade|sidechain|stream_loop/.test(mix.graph + mix.inputs.join(" ")), "no app-side changes to the music");
  const r = run(["-i", n, ...mix.inputs, "-filter_complex", mix.graph, "-map", "[aout]", "-c:a", "aac", out]);
  assert.equal(r.status, 0, r.stderr);
  const probe = spawnSync(ff, ["-hide_banner", "-i", out], { encoding: "utf8" }).stderr;
  const [, sec] = probe.match(/Duration: 00:00:(\d+\.\d+)/);
  assert.ok(Math.abs(Number(sec) - 5) < 0.2, probe);
});
