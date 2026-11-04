import test from "node:test";
import assert from "node:assert/strict";
import { accountRemovalPatch, accountRevisionPatch } from "../electron/account-connections.js";

test("removing the selected account selects only a connected and freshly ready alternative", () => {
  const settings = { engine: "codex", connected: { codex: true, antigravity: true, "claude-code": true }, accountRevision: { codex: 2, antigravity: 4 } };
  assert.deepEqual(accountRemovalPatch(settings, "codex", ["claude-code"]), {
    connected: { codex: false }, accountRevision: { codex: 3 }, engine: "claude-code",
  });
  assert.equal(settings.connected.codex, true, "The helper must not mutate caller state");
  assert.equal(settings.accountRevision.codex, 2);
  assert.equal(accountRemovalPatch(settings, "codex", ["unrecognized", "codex"]).engine, "");
});

test("removing the last usable account clears selection even if a different CLI is signed in", () => {
  const settings = { engine: "claude-code", connected: { "claude-code": true, codex: false } };
  assert.deepEqual(accountRemovalPatch(settings, "claude-code", ["codex", "antigravity"]), {
    connected: { "claude-code": false }, accountRevision: { "claude-code": 1 }, engine: "",
  });
  assert.equal(accountRemovalPatch({ engine: "codex", connected: { codex: true, antigravity: true } }, "codex").engine, "");
});

test("removing a nonselected account does not change the selected provider or unrelated maps", () => {
  const settings = { engine: "api", connected: { codex: true }, accountRevision: { "claude-code": 10 }, api: { apiKey: "untouched" } };
  const patch = accountRemovalPatch(settings, "codex");
  assert.deepEqual(patch, { connected: { codex: false }, accountRevision: { codex: 1 } });
  assert.equal(Object.hasOwn(patch, "api"), false);
  assert.equal(Object.hasOwn(patch, "engine"), false);
});

test("revisions invalidate previous checks and normalize malformed stored values", () => {
  assert.deepEqual(accountRevisionPatch({ accountRevision: { codex: 8 } }, "codex"), { accountRevision: { codex: 9 } });
  for (const value of [undefined, null, -1, 1.5, NaN, "8", Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(accountRevisionPatch({ accountRevision: { antigravity: value } }, "antigravity"), { accountRevision: { antigravity: 1 } });
  }
});

test("unknown provider IDs are rejected before producing settings patches", () => {
  for (const id of ["api", "unknown", "__proto__", "constructor", null, undefined]) {
    assert.throws(() => accountRemovalPatch({}, id), /Unknown account provider/);
    assert.throws(() => accountRevisionPatch({}, id), /Unknown account provider/);
  }
});
