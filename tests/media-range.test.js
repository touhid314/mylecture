import test from "node:test";
import assert from "node:assert/strict";
import { mediaRange, contentType } from "../electron/media-range.js";

test("Range requests resolve to byte windows so media stays seekable", () => {
  assert.equal(mediaRange(null, 100), null);
  assert.equal(mediaRange("items=0-1", 100), null);
  assert.deepEqual(mediaRange("bytes=0-", 100), { ok: true, start: 0, end: 99, size: 100 });
  assert.deepEqual(mediaRange("bytes=10-19", 100), { ok: true, start: 10, end: 19, size: 100 });
  assert.deepEqual(mediaRange("bytes=90-500", 100), { ok: true, start: 90, end: 99, size: 100 });
  assert.deepEqual(mediaRange("bytes=-30", 100), { ok: true, start: 70, end: 99, size: 100 });
  assert.equal(mediaRange("bytes=100-", 100).ok, false);
  assert.equal(mediaRange("bytes=5-2", 100).ok, false);
  assert.equal(contentType("x/MUSIC.MP3"), "audio/mpeg");
  assert.equal(contentType("clip.webm"), "video/webm");
});
