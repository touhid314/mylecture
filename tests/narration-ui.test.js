import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

class FakeElement {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.value = "";
    this.disabled = false;
    this.readOnly = false;
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("on") && typeof value === "function") this.addEventListener(key.slice(2), value);
      else this[key === "class" ? "className" : key] = value;
    }
    this.append(...children);
  }
  append(...children) { this.children.push(...children.flat().filter(child => child != null && child !== false)); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async dispatch(type) {
    for (const handler of this.listeners[type] || []) await handler({ target: this, currentTarget: this });
  }
  get textContent() { return this.children.map(child => child instanceof FakeElement ? child.textContent : String(child)).join(""); }
  set textContent(value) { this.children = [String(value)]; }
}

const harness = { dialog: null, notices: [] };
const dependencyKey = "__narrationUiDependencies";
globalThis[dependencyKey] = {
  h: (tag, attrs, ...children) => new FakeElement(tag, attrs, children),
  modal: options => { harness.dialog = options; },
  toast: (...args) => harness.notices.push(args),
};
const noop = "() => {}";
const stubs = {
  "markdown.js": { markdownEl: noop, renderInline: noop, onFileLink: noop },
  "connect.js": { connectPanel: noop, anyConnected: noop },
  "api-key.js": { showApiKeyDialog: noop },
  "ui.js": {
    h: `globalThis.${dependencyKey}.h`, modal: `globalThis.${dependencyKey}.modal`, toast: `globalThis.${dependencyKey}.toast`,
    icon: noop, fmtTime: noop, fmtDate: noop, popMenu: noop, confirmBox: noop, bus: "{}",
  },
  "player.js": { Player: "class {}" },
  "usage.js": { UsagePanel: "class {}" },
  "attachments.js": { AttachmentPicker: "class {}", attachmentNames: noop },
};
const previousWindow = globalThis.window;
globalThis.window = { MLTimeline: {} };
const hooks = registerHooks({
  load(url, context, nextLoad) {
    for (const [file, exports] of Object.entries(stubs)) {
      if (url.endsWith(`/app/js/${file}`)) return {
        format: "module", shortCircuit: true,
        source: Object.entries(exports).map(([name, value]) => `export const ${name} = ${value};`).join("\n"),
      };
    }
    return nextLoad(url, context);
  },
});
const { CreateView } = await import("../app/js/create.js");
test.after(() => {
  hooks.deregister();
  delete globalThis[dependencyKey];
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

const entries = () => [
  { sceneIndex: 0, beatIndex: 0, sectionId: "mass", spokenText: "  E equals m c squared.  ", caption: "E = mc²" },
  { sceneIndex: 0, beatIndex: 1, sectionId: "pause", spokenText: "", caption: "A silent visual" },
  { sceneIndex: 1, beatIndex: 0, sectionId: "energy", spokenText: "Energy is conserved.", caption: "ΔE = 0" },
  { sceneIndex: 1, beatIndex: 1, sectionId: null, spokenText: "Legacy narration", caption: "Legacy caption" },
];
function descendants(node, predicate) {
  return node.children.flatMap(child => child instanceof FakeElement ? [ ...(predicate(child) ? [child] : []), ...descendants(child, predicate) ] : []);
}
const rows = () => descendants(harness.dialog.body, node => node.className === "narration-beat");
const buttons = () => descendants(harness.dialog.body, node => node.tagName === "BUTTON");
async function openEditor(editNarration = async () => { throw Error("Unexpected regeneration"); }, sceneIndex = 0) {
  harness.dialog = null;
  harness.notices = [];
  const reads = [], applied = [], seeks = [];
  globalThis.window.ml = { ide: { narration: async id => { reads.push(id); return entries(); }, editNarration } };
  const view = {
    project: { lecture: { id: "lecture-7", scenes: [{ beats: [] }, { beats: [] }] } },
    sceneIndex, liveJob: null, job: null, player: { pause() {}, beatStart: (si, bi) => si * 10 + bi, seek: t => seeks.push(t) },
    _applyProject: project => applied.push(project),
  };
  await CreateView.prototype.editNarration.call(view);
  return { reads, applied, seeks, view };
}

test("narration editor shows only the selected scene and preserves exact spoken text", async () => {
  const { reads } = await openEditor();
  assert.deepEqual(reads, ["lecture-7"]);
  assert.equal(harness.dialog.title, "Edit narration");
  const headings = descendants(harness.dialog.body, node => node.tagName === "H3");
  assert.deepEqual(headings.map(node => node.textContent), ["Scene 1"]);
  assert.equal(rows().length, 2);
  assert.equal(descendants(harness.dialog.body, node => node.tagName === "SELECT").length, 0);
  rows().forEach((row, index) => {
    const [line, caption] = row.children;
    const [spoken] = line.children;
    assert.equal(spoken.tagName, "TEXTAREA");
    assert.equal(spoken.value, entries()[index].spokenText);
    assert.equal(caption.className, "narration-caption");
    assert.equal(caption.textContent, entries()[index].caption);
  });
  assert.equal(buttons().length, 2);
  assert.ok(buttons().every(button => button.disabled));
});

test("selecting the second scene shows its narration and legacy rows only", async () => {
  await openEditor(undefined, 1);
  assert.deepEqual(descendants(harness.dialog.body, node => node.tagName === "H3").map(node => node.textContent), ["Scene 2"]);
  assert.equal(rows().length, 2);
  assert.equal(rows()[0].children[0].children[0].value, "Energy is conserved.");
  assert.equal(rows()[1].children[0].children[0].readOnly, true);
  assert.equal(descendants(rows()[1], node => node.tagName === "BUTTON").length, 0);
});

test("regenerating a later scene sends its cue and unchanged caption, then displays returned normalized narration", async () => {
  const calls = [];
  let finish;
  const { applied, seeks } = await openEditor((id, request) => {
    calls.push({ id, request });
    return new Promise(resolve => { finish = resolve; });
  }, 1);
  const [line, caption] = rows()[0].children;
  const [spoken, button] = line.children;
  spoken.value = "Updated energy narration.";
  await spoken.dispatch("input");
  assert.equal(button.disabled, false);
  const pending = button.dispatch("click");
  assert.equal(spoken.readOnly, true);
  assert.ok(buttons().every(item => item.disabled));
  assert.deepEqual(calls, [{ id: "lecture-7", request: { sceneIndex: 1, sectionId: "energy", text: "ΔE = 0", ttsText: "Updated energy narration." } }]);
  const project = { lecture: { scenes: [{ beats: [] }, { beats: [{ spokenText: "Updated, normalized energy narration." }] }] } };
  finish(project);
  await pending;
  assert.deepEqual(applied, [project]);
  assert.deepEqual(seeks, [10], "preview returns to the regenerated cue");
  assert.equal(spoken.value, "Updated, normalized energy narration.");
  assert.equal(caption.textContent, "ΔE = 0");
  assert.equal(spoken.readOnly, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Regenerate");
  assert.deepEqual(harness.notices, []);
});

test("regeneration failure preserves the edited narration and enables retry", async () => {
  const { applied } = await openEditor(async () => { throw Error("Voice unavailable"); });
  const [spoken, button] = rows()[0].children[0].children;
  spoken.value = "Narration to retry.";
  await spoken.dispatch("input");
  await button.dispatch("click");
  assert.equal(spoken.value, "Narration to retry.");
  assert.equal(spoken.readOnly, false);
  assert.equal(button.disabled, false);
  assert.deepEqual(applied, []);
  assert.deepEqual(harness.notices, [["Voice unavailable", { kind: "bad" }]]);
});
