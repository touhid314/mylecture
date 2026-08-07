import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  loadJobManifest,
  listPersistedGenerationIds,
  writeLocalManifestForTest,
} from "./job-manifest.ts";

test("job manifest round-trips through local storage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-manifest-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const manifest = {
      id: "job-123",
      ownerRole: "website" as const,
      status: "source_ready" as const,
      sourceVersion: 1,
      lastReadySourceVersion: 1,
      logs: ["ok"],
      usage: null,
      error: null,
      websiteJobId: "web-1",
      websiteStorageBase: "users/u/jobs/web-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createRequest: {
        prompt: "test",
        includeVideo: false,
        includeInteractive: true,
      },
      lastEditRequest: null,
    };

    await writeLocalManifestForTest("job-123", manifest);
    const ids = await listPersistedGenerationIds();
    assert.deepEqual(ids, ["job-123"]);

    const loaded = await loadJobManifest("job-123");
    assert.equal(loaded?.status, "source_ready");
    assert.equal(loaded?.createRequest?.prompt, "test");
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
