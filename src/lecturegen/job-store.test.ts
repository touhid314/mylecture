import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  appendJobLog,
  createJobRecord,
  flushPersist,
  getJobRecord,
  setJobStatus,
  slimAttachmentsForManifest,
  __testOnly_resetPersistBlocks,
  __testOnly_setPersistSaveGate,
  __testOnly_setTombstonePersistFail,
} from "./job-store.ts";
import { loadJobManifest } from "./job-manifest.ts";
import { finalizeJobDeletion } from "./reaper.ts";

test("persist writes are serialized per generation id", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-persist-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const record = createJobRecord({ prompt: "ordered writes" }, "ide");
    appendJobLog(record.id, "line-1");
    appendJobLog(record.id, "line-2");
    appendJobLog(record.id, "line-3");
    setJobStatus(record.id, "generating");
    await flushPersist(record.id);

    const loaded = await loadJobManifest(record.id);
    const inMemory = getJobRecord(record.id);
    assert.equal(loaded?.logs.length, 3);
    assert.equal(inMemory?.logs.at(-1), "line-3");
    assert.ok((loaded?.manifestRevision ?? 0) >= 1);
  } finally {
    if (previous === undefined) {
      delete process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
    } else {
      process.env.LECTUREGEN_LOCAL_STORAGE_DIR = previous;
    }
    delete process.env.LECTUREGEN_R2_BUCKET;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("delete blocks in-flight persist from resurrecting manifest", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-delete-race-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const record = createJobRecord({ prompt: "delete race" }, "ide");
    await flushPersist(record.id);
    assert.ok(await loadJobManifest(record.id));

    let releaseGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    __testOnly_setPersistSaveGate(() => gate);

    appendJobLog(record.id, "line-after-gate");
    const deletePromise = finalizeJobDeletion(record.id);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(releaseGate, "persist gate should be armed");
    releaseGate();

    await deletePromise;

    assert.equal(getJobRecord(record.id), null);
    assert.equal(await loadJobManifest(record.id), null);
    assert.equal(
      existsSync(path.join(tempRoot, record.id, "manifest.json")),
      false,
    );
  } finally {
    __testOnly_resetPersistBlocks();
    if (previous === undefined) {
      delete process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
    } else {
      process.env.LECTUREGEN_LOCAL_STORAGE_DIR = previous;
    }
    delete process.env.LECTUREGEN_R2_BUCKET;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("tombstone persist failure keeps job and throws", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-tombstone-fail-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const record = createJobRecord({ prompt: "tombstone fail" }, "ide");
    await flushPersist(record.id);

    __testOnly_setTombstonePersistFail(new Error("storage outage"));

    await assert.rejects(
      () => finalizeJobDeletion(record.id),
      /storage outage/,
    );

    const stillThere = getJobRecord(record.id);
    assert.ok(stillThere);
    assert.ok(stillThere.deleteRequestedAt);
    // Soft persist may have written earlier state without tombstone; deletion must not proceed.
    assert.ok(await loadJobManifest(record.id));
  } finally {
    __testOnly_resetPersistBlocks();
    if (previous === undefined) {
      delete process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
    } else {
      process.env.LECTUREGEN_LOCAL_STORAGE_DIR = previous;
    }
    delete process.env.LECTUREGEN_R2_BUCKET;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("slimAttachmentsForManifest strips dataBase64", () => {
  const slimmed = slimAttachmentsForManifest([
    {
      filename: "diagram.png",
      mimeType: "image/png",
      kind: "image",
      dataBase64: "aGVsbG8=",
    },
  ]);
  assert.deepEqual(slimmed, [
    { filename: "diagram.png", mimeType: "image/png", kind: "image" },
  ]);
});

test("persisted manifest omits attachment dataBase64", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-slim-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const record = createJobRecord({
      prompt: "slim manifest",
      generationLength: "90s",
      websiteJobId: "site-1",
      attachments: [
        {
          filename: "ref.pdf",
          mimeType: "application/pdf",
          kind: "file",
          dataBase64: "cGRm",
        },
      ],
    }, "website");
    setJobStatus(record.id, "generating");
    await flushPersist(record.id);

    const loaded = await loadJobManifest(record.id);
    assert.ok(loaded?.createRequest);
    assert.equal(loaded.createRequest.prompt, "slim manifest");
    assert.equal(loaded.createRequest.generationLength, "90s");
    assert.equal(loaded.createRequest.websiteJobId, "site-1");
    assert.deepEqual(loaded.createRequest.attachments, [
      { filename: "ref.pdf", mimeType: "application/pdf", kind: "file" },
    ]);
    assert.equal(
      (loaded.createRequest.attachments?.[0] as { dataBase64?: string }).dataBase64,
      undefined,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
    } else {
      process.env.LECTUREGEN_LOCAL_STORAGE_DIR = previous;
    }
    delete process.env.LECTUREGEN_R2_BUCKET;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
