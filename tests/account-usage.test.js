import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createUsageService } from "../electron/usage.js";
import { UsagePanel } from "../app/js/usage.js";
import { bus } from "../app/js/ui.js";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const quota = remaining => ({ available: true, checkedAt: new Date().toISOString(), groups: [
  { name: "Claude", buckets: [{ name: "5h", window: "5h", remaining }] },
] });

test("invalidation drops cached Claude quotas and late requests cannot restore them or clear newer pending work", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mylecture-account-usage-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "fixture-only" } }));
  const requests = [];
  const read = createUsageService(null, null, { claudeHome: dir, fetch: () => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  } });
  const waitForFetch = async count => {
    for (let i = 0; i < 100 && requests.length < count; i++) await new Promise(done => setTimeout(done, 5));
    assert.equal(requests.length, count);
  };
  const finish = (index, used) => requests[index].resolve({ ok: true, json: async () => ({ five_hour: { utilization: used } }) });
  const old = read("claude-code");
  await waitForFetch(1);
  read.invalidate("claude-code");
  const current = read("claude-code");
  assert.notEqual(current, old);
  await waitForFetch(2);
  finish(0, 90);
  await old;
  assert.equal(read("claude-code"), current, "old completion must preserve current deduplication");
  finish(1, 20);
  assert.equal((await current).groups[0].buckets[0].remaining, 80);
  assert.equal((await read("claude-code")).groups[0].buckets[0].remaining, 80);
  assert.equal(requests.length, 2);
  read.invalidate("claude-code");
  const fresh = read("claude-code");
  await waitForFetch(3);
  read.invalidate("claude-code");
  const newest = read("claude-code");
  await waitForFetch(4);
  finish(3, 40);
  await newest;
  finish(2, 99);
  await fresh;
  assert.equal((await read("claude-code")).groups[0].buckets[0].remaining, 60, "late old result must not overwrite the new cache");
  assert.equal(requests.length, 4);
});

test("invalidation also detaches pending CLI usage without deleting its replacement", async () => {
  const requests = [];
  const read = createUsageService({ get: () => ({ exe: () => "fixture" }) }, () => {
    const request = deferred(); requests.push(request); return request.promise;
  });
  const old = read("antigravity");
  read.invalidate("antigravity");
  const current = read("antigravity");
  requests[0].resolve({ ok: false });
  await old;
  assert.equal(read("antigravity"), current);
  requests[1].resolve({ ok: false });
  await current;
  assert.equal(requests.length, 2);
});

class Element {
  constructor() { this.children = []; this.attributes = {}; this.disabled = false; }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : child).join(""); }
}

function panelFixture(t, settings) {
  const previous = Object.fromEntries(["Node", "document", "window", "setInterval"].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  const calls = [];
  globalThis.Node = Element;
  globalThis.document = { createElement: () => new Element(), createElementNS: () => new Element(), createTextNode: String, addEventListener() {} };
  globalThis.window = { addEventListener() {}, ml: { gen: { onEvent() {} }, engines: { usage: id => {
    const request = deferred(); calls.push({ id, ...request }); return request.promise;
  } } } };
  globalThis.setInterval = () => 0;
  const subscribe = bus.on.bind(bus);
  t.mock.method(bus, "on", (event, listener) => {
    const unsubscribe = subscribe(event, listener);
    t.after(unsubscribe);
    return unsubscribe;
  });
  const state = { settings };
  const panel = new UsagePanel({ state });
  return { state, panel, calls };
}

test("same-provider revision changes immediately clear quotas and reject late UI results", async t => {
  const { state, panel, calls } = panelFixture(t, { engine: "claude-code", models: { "claude-code": "claude" }, connected: { "claude-code": true }, accountRevision: { "claude-code": 1 } });
  calls[0].resolve(quota(90));
  await Promise.resolve();
  assert.match(panel.summary.textContent, /90%/);
  const old = panel.refresh();
  assert.doesNotMatch(panel.summary.textContent, /90%/);
  assert.equal(panel.summary.attributes["aria-label"], undefined);
  state.settings = { ...state.settings, accountRevision: { "claude-code": 2 } };
  bus.emit("settings-changed");
  assert.equal(calls.length, 3);
  calls[2].resolve(quota(60));
  await Promise.resolve();
  calls[1].resolve(quota(10));
  await old;
  assert.match(panel.summary.textContent, /60%/);
  assert.doesNotMatch(panel.body.textContent, /10.0%/);
});

test("no provider and disconnected subscriptions never request quotas, and disconnect rejects late results", async t => {
  const { state, panel, calls } = panelFixture(t, { engine: null });
  assert.equal(calls.length, 0);
  for (const engine of ["antigravity", "codex", "claude-code"]) {
    state.settings = { engine, connected: { [engine]: false } };
    await panel.refresh();
    assert.equal(calls.length, 0);
    assert.match(panel.body.textContent, /Connect this account/);
  }
  state.settings.connected["claude-code"] = true;
  const pending = panel.refresh();
  assert.equal(calls.length, 1);
  state.settings = { ...state.settings, connected: { "claude-code": false } };
  await panel.refresh();
  calls[0].resolve(quota(99));
  await pending;
  assert.doesNotMatch(panel.summary.textContent, /99%/);
  assert.equal(panel.refreshButton.disabled, false);
  assert.equal(panel.pendingKey, null);
  assert.equal(calls.length, 1);
});

test("a revision change rejects a response even before the settings event refreshes the panel", async t => {
  const { state, panel, calls } = panelFixture(t, { engine: "codex", connected: { codex: true }, accountRevision: { codex: 1 } });
  state.settings.accountRevision.codex++;
  calls[0].resolve(quota(99));
  await Promise.resolve();
  assert.doesNotMatch(panel.summary.textContent, /99%/);
  assert.doesNotMatch(panel.body.textContent, /99.0%/);
  assert.equal(panel.refreshButton.disabled, false);
});
