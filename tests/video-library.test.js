import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listRenderedVideos } from "../electron/video-library.js";

test("Library lists MP4 files and excludes lessons, HTML, partial renders, and missing files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-library-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ["Lesson.html", "lecture.json", "Captions.srt", "Pending.mp4.rendering", "Finished.mp4", "Uppercase.MP4"]) {
    fs.writeFileSync(path.join(directory, name), "fixture");
  }
  fs.writeFileSync(path.join(directory, "Empty.mp4"), "");
  fs.mkdirSync(path.join(directory, "Folder.mp4"));
  assert.deepEqual(listRenderedVideos(directory).map((v) => v.title).sort(), ["Finished", "Uppercase"]);
  fs.unlinkSync(path.join(directory, "Finished.mp4"));
  assert.equal(listRenderedVideos(directory).length, 1);
  assert.deepEqual(listRenderedVideos(path.join(directory, "missing")), []);
});
