import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deleteGenerationArtifacts } from "./generation-runner.ts";

test("deleteGenerationArtifacts removes prefix even without in-memory job record", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-delete-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  const generationId = "orphan-gen";
  const artifactDir = path.join(tempRoot, generationId, "v1", "workspace");
  const artifactPath = path.join(artifactDir, "index.html");

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(artifactPath, "<html></html>", "utf-8");
    await deleteGenerationArtifacts(generationId);
    const entries = await readdir(tempRoot).catch(() => []);
    assert.equal(entries.includes(generationId), false);
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
