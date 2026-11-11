import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadFile } from "../electron/components.js";

// A fetch that answers with the given responses in turn.
function fakeFetch(t, replies) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    if (r.status !== 200) return new Response("busy", { status: r.status, headers: r.headers || {} });
    return new Response(r.body, { status: 200, headers: { "content-length": String(Buffer.byteLength(r.body)) } });
  });
  return calls;
}

test("downloads retry rate limits, server errors and dropped connections, honouring Retry-After", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-download-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "hermes.zip");
  const calls = fakeFetch(t, [{ status: 429, headers: { "retry-after": "7" } }, { status: 502 }, new TypeError("fetch failed"), { status: 200, body: "zip-bytes" }]);
  const waits = [];
  await downloadFile("https://example.test/hermes.zip", file, { wait: async (ms) => { waits.push(ms); } });
  assert.equal(calls.length, 4);
  assert.equal(fs.readFileSync(file, "utf8"), "zip-bytes");
  // Retry-After (7 s), then growing waits.
  assert.deepEqual(waits, [7000, 4000, 8000]);
});

test("downloads give up after a few attempts, and never retry a missing file", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-download-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const busy = fakeFetch(t, [{ status: 429 }]);
  await assert.rejects(downloadFile("https://example.test/a", path.join(dir, "a"), { attempts: 3, wait: async () => {} }), /HTTP 429/);
  assert.equal(busy.length, 3);
  t.mock.restoreAll();
  const missing = fakeFetch(t, [{ status: 404 }]);
  await assert.rejects(downloadFile("https://example.test/b", path.join(dir, "b"), { wait: async () => {} }), /HTTP 404/);
  assert.equal(missing.length, 1);
});
