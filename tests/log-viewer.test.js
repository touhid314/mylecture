import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

class Element {
  constructor(tag, attributes = {}, children = []) {
    this.tag = tag; this.children = children.flat().filter(value => value != null);
    this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100;
    Object.assign(this, attributes);
  }
  get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : String(child)).join(""); }
  set textContent(text) { this.children = [String(text)]; }
}
const fixture = { dialog: null, notices: [] };
globalThis.__logViewerFixture = {
  h: (tag, attributes, ...children) => new Element(tag, attributes, children),
  modal: options => { fixture.dialog = options; return { close: () => options.onClose() }; },
  toast: (...arguments_) => fixture.notices.push(arguments_),
};
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith("/app/js/ui.js")) return { format: "module", shortCircuit: true, source: "export const h=globalThis.__logViewerFixture.h; export const modal=globalThis.__logViewerFixture.modal; export const toast=globalThis.__logViewerFixture.toast;" };
  return next(url, context);
} });
const { showLiveLog } = await import("../app/js/logs.js");
const originalWindow = globalThis.window;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const descendants = node => node.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
const button = label => descendants(fixture.dialog.body).find(node => node.tag === "button" && node.textContent === label);
const output = () => descendants(fixture.dialog.body).find(node => node.tag === "pre");

test.after(() => {
  hooks.deregister(); delete globalThis.__logViewerFixture;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
});

function setup() {
  let text = '{"event":"app.ready"}\n', listener, reads = 0, unsubscribed = 0, opens = 0, copied = "";
  globalThis.window = { ml: { logs: {
    read: async () => { reads++; return { text, file: "/local/logs/app.log", truncated: false }; },
    onEntry: fn => { listener = fn; return () => { unsubscribed++; listener = null; }; },
    openFolder: async () => { opens++; },
  } } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  fixture.notices = [];
  return { emit: () => listener?.({ line: "new" }), setText: value => { text = value; }, reads: () => reads, unsubscribed: () => unsubscribed, opens: () => opens, copied: () => copied };
}

test("live viewer reads local text safely, coalesces events and cleans up its subscription", async () => {
  const h = setup();
  const dialog = showLiveLog(); await flush();
  assert.match(output().textContent, /app.ready/);
  assert.equal(h.reads(), 1);
  h.setText('<script>never execute</script>\n{"event":"new"}');
  output().scrollHeight = 500; output().clientHeight = 100; output().scrollTop = 100;
  h.emit(); h.emit(); h.emit();
  await new Promise(resolve => setTimeout(resolve, 280)); await flush();
  assert.equal(h.reads(), 2);
  assert.equal(output().textContent, '<script>never execute</script>\n{"event":"new"}');
  assert.equal(output().innerHTML, undefined);
  assert.equal(output().scrollTop, 100, "updates preserve a reader's scrolled position");
  assert.equal(h.copied(), "");
  await button("Copy log").onclick();
  assert.equal(h.copied(), output().textContent);
  await button("Open logs folder").onclick(); assert.equal(h.opens(), 1);
  h.emit(); dialog.close();
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(h.unsubscribed(), 1);
  assert.equal(h.reads(), 2);
});

test("pause stops live reads while manual refresh works and large logs stay bounded", async () => {
  const h = setup();
  const dialog = showLiveLog(); await flush();
  button("Pause live updates").onclick();
  h.emit();
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(h.reads(), 1);
  h.setText("prefix\n" + "line🙂\n".repeat(40000));
  await button("Refresh").onclick();
  assert.equal(h.reads(), 2);
  assert.ok(new TextEncoder().encode(output().textContent).length <= 128 * 1024);
  assert.ok(!output().textContent.includes("prefix"));
  assert.match(descendants(fixture.dialog.body).find(node => node.role === "status").textContent, /Paused.*128 KB/);
  dialog.close();
});

test("closing rejects a late read and errors do not erase the last useful log", async () => {
  setup();
  let resolveRead;
  window.ml.logs.read = () => new Promise(resolve => { resolveRead = resolve; });
  const dialog = showLiveLog();
  const pre = output();
  dialog.close(); resolveRead({ text: "late update", file: "app.log" }); await flush();
  assert.equal(pre.textContent, "Loading logs…");
  setup();
  const second = showLiveLog(); await flush();
  const previous = output().textContent;
  window.ml.logs.read = async () => { throw new Error("unavailable"); };
  await button("Refresh").onclick();
  assert.equal(output().textContent, previous);
  assert.match(descendants(fixture.dialog.body).find(node => node.role === "status").textContent, /Could not read/);
  second.close();
});
