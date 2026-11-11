import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareHtml } from "../electron/tutor/html.js";
import { TutorService } from "../electron/tutor/service.js";

test("HTML revisions are immutable, retain relative assets and reject files outside the lesson", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ml-html-"));
  try {
    fs.mkdirSync(path.join(workspace, "scenes"));
    const file = path.join(workspace, "scenes", "demo.html");
    fs.writeFileSync(file, "<body><img src='picture.png'>First<script>document.body.dataset.ran='yes'</script></body>");
    const first = prepareHtml({ file: "scenes/demo.html" }, { workspace, sessionId: "lesson" });
    fs.writeFileSync(file, "<body>Second</body>");
    const second = prepareHtml({ file: "scenes/demo.html" }, { workspace, sessionId: "lesson" });
    assert.notEqual(first.src, second.src);
    assert.match(first.src, /lesson\/scenes\/\.visual-/);
    const saved = fs.readFileSync(path.join(workspace, "scenes", first.src.split("/").pop()), "utf8");
    assert.match(saved, /First/);
    assert.match(saved, /picture.png/);
    assert.match(saved, /tutor:point/);
    assert.match(saved, /dataset.ran/);
    assert.throws(() => prepareHtml({ file: "../outside.html" }, { workspace, sessionId: "lesson" }), /inside/);
    assert.throws(() => prepareHtml({ html: "" }, { workspace, sessionId: "lesson" }), /Provide/);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

test("connected tutor engines get native agent workspaces and can publish HTML files", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ml-tutor-agent-"));
  try {
    const events = [];
    let request;
    const service = new TutorService({
      engines: new Map([["claude-code", { generate: async (opts) => {
        request = opts;
        fs.writeFileSync(path.join(opts.workspace, "visual.html"), "<body><canvas></canvas><script>window.animation=true</script></body>");
        opts.onDelta('say: Watch this picture.\nhtml#demo: {"file":"visual.html","height":300}\nend: wait');
        return {};
      } }]]),
      getSettings: () => ({ engine: "claude-code", connected: { "claude-code": true } }),
      sessions: { dir: () => workspace },
      send: (_, event) => events.push(event),
    });
    assert.deepEqual(await service.turn({ turnId: "html", sessionId: "lesson", task: { kind: "start" }, topic: "Demo" }), { ok: true });
    assert.equal(request.workspace, workspace);
    const action = events.find((e) => e.action?.type === "html").action;
    assert.match(action.data.src, /^mylecture:\/\/app\/tutor-file\/lesson\/\.visual-/);
    assert.doesNotThrow(() => structuredClone(action));
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
