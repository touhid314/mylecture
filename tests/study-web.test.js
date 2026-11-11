import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchWeb, searchResults } from "../electron/tutor/search.js";
import { TutorService } from "../electron/tutor/service.js";
import { ImageFinder } from "../electron/tutor/images.js";
import { sessionSnapshot, pictureRequest } from "../app/js/study/pictures.js";
import { pictureMark } from "../app/js/study/picture-marks.js";
import { lineToAction } from "../electron/tutor/protocol.js";

const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fscience.nasa.gov%2Fwebb%2F&amp;rut=abc">NASA&#x27;s &amp; Webb</a>
<a class="result__snippet">A <b>new</b> discovery.</a>
<a class="result__a" href="javascript:alert(1)">Bad link</a>`;

test("search decodes result links, titles and excerpts, excluding unsafe links", async () => {
  assert.deepEqual(searchResults(html), [{ title: "NASA's & Webb", url: "https://science.nasa.gov/webb/", snippet: "A new discovery." }]);
  const result = await searchWeb("Webb discoveries", { fetcher: async (url, opts) => {
    assert.match(url, /q=Webb%20discoveries/);
    assert.ok(opts.signal);
    return new Response(html);
  } });
  assert.equal(result.results.length, 1);
  assert.ok(Date.parse(result.retrieved));
  await assert.rejects(searchWeb("Webb", { fetcher: async () => new Response("captcha") }), /no usable results/);
  await assert.rejects(searchWeb("Webb", { fetcher: async () => new Response("", { status: 429 }) }), /429/);
});

function tutor(scripts, search) {
  const events = [], prompts = [], requests = [];
  const service = new TutorService({
    engines: new Map([["api", { generate: async (opts) => {
      prompts.push(opts.user);
      requests.push(opts);
      for (const chunk of scripts.shift().match(/.{1,11}/gs)) opts.onDelta(chunk);
      return {};
    } }]]),
    getSettings: () => ({ engine: "api" }),
    send: (_, event) => events.push(event), search,
  });
  const run = () => service.turn({ turnId: "web-1", topic: "Webb", task: { kind: "start" } });
  return { service, events, prompts, requests, run };
}

test("image prefetch never stores a Promise in lesson data, including legacy snapshots", async () => {
  const action = { type: "image", id: "photo", data: { source: { url: "mylecture://app/tutor-img/example.png" } } };
  assert.equal(pictureRequest(action), pictureRequest(action));
  await pictureRequest(action);
  assert.doesNotThrow(() => structuredClone({ board: [action] }));
  const old = { ...action, _image: Promise.resolve(null) };
  assert.throws(() => structuredClone({ board: [old] }));
  const saved = sessionSnapshot({ id: "lesson", board: [old], attachments: [], history: [] });
  assert.deepEqual(structuredClone(saved).board, [action]);
});

test("picture marks parse and bound coordinates without accepting executable styles", () => {
  assert.equal(lineToAction('annotate: {"target":"photo","marks":[{"type":"circle","x":20,"y":30}]}').type, "annotate");
  assert.equal(lineToAction("inspect: human heart").type, "inspect");
  assert.equal(pictureMark({ type: "script" }), null);
  const mark = pictureMark({ type: "circle", x: -9, y: 200, color: "url(example)" });
  assert.equal(mark.x, 0); assert.equal(mark.y, 100); assert.equal(mark.color, "#ef4444");
});

test("inspection sends the downloaded image to vision and binds the displayed picture to it", async () => {
  const t = tutor(["inspect: human heart", 'image#photo: {"query":"human heart"}\nannotate: {"target":"photo","marks":[{"id":"valve","type":"circle","x":40,"y":50}]}\nend: wait']);
  t.service.imageFinder = { dir: path.join(os.tmpdir(), "images"), find: async () => ({ url: "mylecture://app/tutor-img/abc123.png", page: "https://commons.wikimedia.org/wiki/Heart", credit: "Commons" }) };
  await t.run();
  assert.equal(t.requests[1].images[0].path, path.join(os.tmpdir(), "images", "abc123.png"));
  assert.match(t.prompts[1], /actual downloaded picture|downloaded picture is attached/);
  const action = t.events.find((e) => e.action?.type === "image").action;
  assert.equal(action.data.source.url, "mylecture://app/tutor-img/abc123.png");
  assert.ok(t.events.some((e) => e.action?.type === "annotate"));
});

test("tutor pauses for app search, resumes with evidence and emits sources before teaching", async () => {
  const t = tutor([
    "say: I'll look up the latest discoveries.\nsearch: Webb discoveries\nsay: This premature answer must not play.\nend: done",
    'say: The source describes a new discovery.\nimage: {"query":"James Webb telescope","caption":"Webb"}\nend: done',
  ], async (query) => ({ query, results: [{ title: "NASA [Webb]", url: "https://science.nasa.gov/webb/", snippet: "Verified discovery" }] }));
  assert.deepEqual(await t.run(), { ok: true });
  assert.match(t.prompts[1], /Verified discovery/);
  assert.doesNotMatch(t.prompts[1], /premature answer/);
  const actions = t.events.filter((e) => e.type === "action").map((e) => e.action);
  assert.deepEqual(actions.map((a) => a.type), ["say", "write", "say", "image", "end"]);
  assert.match(actions[1].text, /https:\/\/science.nasa.gov/);
  assert.notEqual(actions[0].line, actions[2].line, "speech lines across research passes must stay distinct");
  assert.equal(t.service.turns.size, 0);
});

test("failed web searches let the tutor explain and continue", async () => {
  const t = tutor(["search: Webb", "say: Search is unavailable, so I cannot confirm the latest news.\nend: wait"], async () => { throw new Error("Offline"); });
  await t.run();
  assert.match(t.prompts[1], /Offline/);
  assert.ok(t.events.some((e) => e.action?.text?.includes("unavailable")));
  assert.ok(t.events.filter((e) => e.action?.type === "write").every((e) => e.action.raw?.startsWith("write: ")));
  assert.ok(t.events.some((e) => e.type === "done"));
});

test("research is bounded and cancellation never resumes generation", async () => {
  let calls = 0;
  const t = tutor(Array(4).fill("search: Webb"), async () => { calls++; return { results: [] }; });
  await t.run();
  assert.equal(calls, 3);
  assert.equal(t.prompts.length, 4);
  assert.ok(t.events.filter((e) => e.action?.type === "write").every((e) => e.action.raw?.startsWith("write: ")));
  const c = tutor(["search: Webb"], async (_, { signal }) => {
    c.service.cancel("web-1");
    signal.throwIfAborted();
  });
  assert.deepEqual(await c.run(), { aborted: true });
  assert.equal(c.prompts.length, 1);
  assert.ok(!c.events.some((e) => e.type === "done"));
});

test("pictures download, reject nonimages, fall back and survive a fresh finder offline", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-images-"));
  const original = globalThis.fetch;
  try {
    let downloads = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("commons.wikimedia.org/w/api.php")) return Response.json({ query: { pages: { 1: {
        title: "File:Human heart diagram.png", index: 1,
        imageinfo: [{ thumburl: "https://upload.wikimedia.org/commons.png", descriptionurl: "https://commons.wikimedia.org/wiki/Heart", mime: "image/png", width: 960 }],
      } } } });
      if (String(url).includes("en.wikipedia.org/w/api.php")) return Response.json({ query: { pages: { 2: {
        title: "Human heart", fullurl: "https://en.wikipedia.org/wiki/Heart", thumbnail: { source: "https://upload.wikimedia.org/wiki.png" },
      } } } });
      downloads++;
      if (String(url).includes("commons.png")) return new Response("Rate limited", { headers: { "content-type": "text/html" } });
      return new Response(Buffer.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    };
    const result = await new ImageFinder({ dir }).find("human heart");
    assert.match(result.url, /^mylecture:\/\/app\/tutor-img\/.+\.png$/);
    assert.equal(result.page, "https://en.wikipedia.org/wiki/Heart");
    assert.equal(downloads, 2);
    globalThis.fetch = async () => { throw new Error("Offline"); };
    assert.deepEqual(await new ImageFinder({ dir }).find("human heart"), result);
  } finally {
    globalThis.fetch = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
