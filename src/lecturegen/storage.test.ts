import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertResolvedTransferKey,
  assertWorkspaceDownloadScope,
  isIntermediateStorageConfigured,
  resolvedObjectPrefix,
  useLocalIntermediateStorage,
  workspaceBundleKey,
  workspacePrefix,
} from "./storage.ts";

test("production storage fails closed when intermediate R2 is absent", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBucket = process.env.LECTUREGEN_R2_BUCKET;
  process.env.NODE_ENV = "production";
  delete process.env.LECTUREGEN_R2_BUCKET;
  try {
    assert.equal(isIntermediateStorageConfigured(), false);
    assert.equal(useLocalIntermediateStorage(), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousBucket === undefined) delete process.env.LECTUREGEN_R2_BUCKET;
    else process.env.LECTUREGEN_R2_BUCKET = previousBucket;
  }
});

test("assertResolvedTransferKey accepts keys under resolved prefix", () => {
  const key = assertResolvedTransferKey(
    "gen-1",
    2,
    "gen-1/v2/resolved/audio/clip.wav",
  );
  assert.equal(key, "gen-1/v2/resolved/audio/clip.wav");
});

test("assertResolvedTransferKey rejects traversal and workspace keys", () => {
  const prefix = resolvedObjectPrefix("gen-1", 2);
  assert.throws(() =>
    assertResolvedTransferKey("gen-1", 2, `${prefix}../raw.html`),
  );
  assert.throws(() =>
    assertResolvedTransferKey("gen-1", 2, "gen-1/v2/workspace/index.html"),
  );
  assert.throws(() =>
    assertResolvedTransferKey("gen-1", 2, "other-gen/v2/resolved/raw.html"),
  );
});

test("workspace bundle key is isolated to generation/version", () => {
  assert.equal(
    workspaceBundleKey("gen-a", 3),
    "gen-a/v3/.workspace-bundle.tar.gz",
  );
  assert.notEqual(
    workspaceBundleKey("gen-a", 3),
    workspaceBundleKey("gen-b", 3),
  );
});

test("assertWorkspaceDownloadScope rejects other workspace prefixes", () => {
  const key = `${workspacePrefix("gen-1", 2)}/assets/icon.svg`;
  assert.doesNotThrow(() => assertWorkspaceDownloadScope("gen-1", 2, key));
  assert.throws(() =>
    assertWorkspaceDownloadScope("gen-1", 2, `${workspacePrefix("gen-1", 1)}/assets/icon.svg`),
  );
  assert.throws(() =>
    assertWorkspaceDownloadScope("gen-1", 2, `${workspacePrefix("gen-2", 2)}/assets/icon.svg`),
  );
});
