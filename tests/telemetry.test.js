import test from "node:test";
import assert from "node:assert/strict";
import { sendLaunchPing, isTelemetryConfigured, launchPingSuppressed } from "../electron/telemetry.js";

function recorder(result = { ok: true }) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, data: JSON.parse(init.body) });
    if (result instanceof Error) throw result;
    return result;
  };
  return { requests, fetchImpl };
}

test("missing or unsafe collector URLs never send traffic", async () => {
  for (const endpoint of ["", "not a URL", "http://example.test", "https://user:secret@example.test", "https://example.test/?key=secret", "https://example.test/#fragment", "file:///tmp/events"]) {
    const r = recorder();
    assert.equal(await sendLaunchPing({ endpoint, version: "0.1.0", fetchImpl: r.fetchImpl }), false);
    assert.equal(r.requests.length, 0, endpoint);
    assert.equal(isTelemetryConfigured(endpoint), false);
  }
  assert.equal(isTelemetryConfigured("https://stats.example.test"), true);
  assert.equal(isTelemetryConfigured("http://localhost:4567"), true);
  assert.equal(isTelemetryConfigured("http://127.0.0.1:4567"), true);
  assert.equal(isTelemetryConfigured("http://localhost.attacker.test"), false);
});

test("opted-out launches send nothing", async () => {
  const r = recorder();
  assert.equal(await sendLaunchPing({ endpoint: "https://stats.example.test", version: "0.1.0", enabled: false, fetchImpl: r.fetchImpl }), false);
  assert.equal(r.requests.length, 0);
});

test("a launch sends exactly one minimal ping with no identifier", async () => {
  const r = recorder();
  assert.equal(await sendLaunchPing({ endpoint: "https://stats.example.test/metrics/", version: "0.1.0", platform: "win32", fetchImpl: r.fetchImpl }), true);
  assert.equal(r.requests.length, 1);
  const [{ url, init, data }] = r.requests;
  assert.equal(url, "https://stats.example.test/metrics/v1/events");
  assert.deepEqual(data, { schema: 1, version: "0.1.0", platform: "win32" });
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.referrerPolicy, "no-referrer");
});

test("collector errors and timeouts are silent with no retries", async () => {
  const failing = recorder(new Error("offline"));
  assert.equal(await sendLaunchPing({ endpoint: "https://stats.example.test", version: "0.1.0", fetchImpl: failing.fetchImpl }), false);
  assert.equal(failing.requests.length, 1);

  const rejected = recorder({ ok: false });
  assert.equal(await sendLaunchPing({ endpoint: "https://stats.example.test", version: "0.1.0", fetchImpl: rejected.fetchImpl }), false);
  assert.equal(rejected.requests.length, 1);

  let calls = 0;
  const hanging = (_url, init) => { calls++; return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))); };
  assert.equal(await sendLaunchPing({ endpoint: "https://stats.example.test", version: "0.1.0", fetchImpl: hanging, timeoutMs: 10 }), false);
  assert.equal(calls, 1);
});

test("only plain packaged launches are counted", () => {
  assert.equal(launchPingSuppressed({ isPackaged: true, argv: ["MyLecture.exe"], env: {} }), false);
  assert.equal(launchPingSuppressed({ isPackaged: false, argv: [], env: {} }), true);
  assert.equal(launchPingSuppressed({ isPackaged: true, argv: ["MyLecture.exe", "--dev"], env: {} }), true);
  assert.equal(launchPingSuppressed({ isPackaged: true, argv: ["MyLecture.exe", "--smoke-test"], env: {} }), true);
  for (const name of ["MYLECTURE_PROFILE", "CI"]) {
    assert.equal(launchPingSuppressed({ isPackaged: true, argv: [], env: { [name]: "1" } }), true, name);
  }
});
