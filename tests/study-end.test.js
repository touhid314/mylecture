import test from "node:test";
import assert from "node:assert/strict";
import { createTutorParser } from "../electron/tutor/protocol.js";
import { TutorService } from "../electron/tutor/service.js";

const TRAIL = "I opened the 2008 crisis lesson with this first segment.\n- **Bullet** summary\nwrite: ## Not shown\nask: {\"id\":\"q\",\"type\":\"short\",\"q\":\"x\"}\n";

function tutor(chunks, { onSignal } = {}) {
  const events = [];
  const service = new TutorService({
    engines: new Map([["api", { generate: async (opts) => {
      onSignal?.(opts.signal);
      for (const chunk of chunks) {
        if (opts.signal.aborted) return { aborted: true };
        opts.onDelta(chunk);
      }
      return {};
    } }]]),
    getSettings: () => ({ engine: "api" }),
    send: (_, event) => events.push(event),
  });
  const run = () => service.turn({ turnId: "end-1", topic: "2008 crisis", task: { kind: "start" } });
  const actions = () => events.filter((e) => e.type === "action").map((e) => e.action);
  return { events, run, actions };
}

test("parser drops everything after the first end line, in the same or later chunks", () => {
  const seen = [];
  const p = createTutorParser((a) => seen.push(a));
  p.feed("say: Here is the first idea of the lesson.\nend: wait\n" + TRAIL.slice(0, 20));
  p.feed(TRAIL.slice(20));
  p.feed("say: More chatter.");
  p.end();
  assert.deepEqual(seen.map((a) => a.type), ["say", "end"]);
  assert.equal(seen[1].value, "wait");
  assert.equal(p.dropped, TRAIL.length + "say: More chatter.".length);
});

test("text after end: wait is not published and the turn still finishes ok", async () => {
  for (const chunks of [
    ["say: The crisis began in housing.\nend: wait\n" + TRAIL],            // same delta
    ["say: The crisis began in housing.\n", "end: wait\n", ...TRAIL.match(/.{1,9}/gs)], // later deltas
    ["say: The crisis began in housing.\nend: w", "ait\nI opened", " the lesson..."], // end split across deltas
  ]) {
    let signal;
    const t = tutor(chunks, { onSignal: (s) => { signal = s; } });
    const res = await t.run();
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(t.actions().map((a) => a.type), ["say", "end"]);
    assert.equal(t.actions()[1].value, "wait");
    assert.ok(!t.events.some((e) => e.type === "aborted" || e.type === "error"));
    assert.ok(t.events.some((e) => e.type === "done"));
    assert.ok(signal.aborted, "the engine is told to stop after the end line");
  }
});

test("a normal segment is unchanged", async () => {
  const script = "say: Okay, so the first idea is really simple once you see it. Now the second idea takes a bit longer.\nwrite: ## Heading\npause: 1\nend: continue";
  const t = tutor(script.match(/.{1,7}/gs));
  const res = await t.run();
  assert.deepEqual(res, { ok: true });
  const types = t.actions().map((a) => a.type).filter((k, i, all) => k !== "say" || all[i - 1] !== "say");
  assert.deepEqual(types, ["say", "write", "pause", "end"]);
  assert.equal(t.actions().filter((a) => a.type === "say").map((a) => a.text).join(" "), "Okay, so the first idea is really simple once you see it. Now the second idea takes a bit longer.");
  assert.equal(t.actions().filter((a) => a.type === "end").length, 1);
  assert.ok(!t.actions().some((a) => a.implicit));
});

test("an engine that throws when stopped after end still finishes ok", async () => {
  const events = [];
  const service = new TutorService({
    engines: new Map([["api", { generate: async (opts) => {
      opts.onDelta("say: Short and sweet, that's the idea here.\nend: done\nextra");
      opts.signal.throwIfAborted();
      return {};
    } }]]),
    getSettings: () => ({ engine: "api" }),
    send: (_, event) => events.push(event),
  });
  const res = await service.turn({ turnId: "end-2", topic: "x", task: { kind: "start" } });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(events.filter((e) => e.type === "action").map((e) => e.action.type), ["say", "end"]);
});
