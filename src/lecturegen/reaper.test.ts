import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createJobRecord,
  getJobRecord,
  markDeleteRequested,
} from "./job-store.ts";
import {
  reapIdeRetentionJobs,
  reapSupersededVersions,
  reapTombstonedJobs,
} from "./reaper.ts";

test("reapSupersededVersions keeps v1 when lastReadySourceVersion is 2", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-reaper-superseded-v2-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  const generationId = "gen-superseded-v2";
  const versionDir = (version: number) =>
    path.join(tempRoot, generationId, `v${version}`);

  try {
    for (const version of [1, 2]) {
      await mkdir(versionDir(version), { recursive: true });
      await writeFile(
        path.join(versionDir(version), "raw.html"),
        `<html>v${version}</html>`,
        "utf-8",
      );
    }

    await reapSupersededVersions(generationId, 2);

    assert.equal(existsSync(versionDir(1)), true);
    assert.equal(existsSync(versionDir(2)), true);
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

test("reapSupersededVersions keeps current and previous version artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-reaper-superseded-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  const generationId = "gen-superseded";
  const versionDir = (version: number) =>
    path.join(tempRoot, generationId, `v${version}`);

  try {
    for (const version of [1, 2, 3, 4]) {
      await mkdir(versionDir(version), { recursive: true });
      await writeFile(
        path.join(versionDir(version), "raw.html"),
        `<html>v${version}</html>`,
        "utf-8",
      );
    }

    await reapSupersededVersions(generationId, 4);

    assert.equal(existsSync(versionDir(1)), false);
    assert.equal(existsSync(versionDir(2)), false);
    assert.equal(existsSync(versionDir(3)), true);
    assert.equal(existsSync(versionDir(4)), true);
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

test("reapTombstonedJobs does not age-delete website-linked jobs without tombstone", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-reaper-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const record = createJobRecord({
      prompt: "retain me",
      websiteJobId: "site-job-1",
    }, "website");
    const job = getJobRecord(record.id);
    assert.ok(job);
    job.status = "source_ready";
    job.updatedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const reaped = await reapTombstonedJobs();
    assert.equal(reaped, 0);
    assert.ok(getJobRecord(record.id));
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

test("reapTombstonedJobs removes jobs with deleteRequestedAt after grace", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-reaper-"));
  const previous = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const record = createJobRecord({
      prompt: "delete me",
      websiteJobId: "site-job-2",
    }, "website");
    markDeleteRequested(record.id);
    const job = getJobRecord(record.id);
    assert.ok(job);
    job.deleteRequestedAt = Date.now() - 120_000;

    const reaped = await reapTombstonedJobs();
    assert.equal(reaped, 1);
    assert.equal(getJobRecord(record.id), null);
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

test("reapIdeRetentionJobs expires non-website source_ready jobs after TTL", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lecturegen-reaper-"));
  const previousStorage = process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
  process.env.LECTUREGEN_LOCAL_STORAGE_DIR = tempRoot;
  process.env.LECTUREGEN_R2_BUCKET = "";

  try {
    const record = createJobRecord({ prompt: "ide job" }, "ide");
    const job = getJobRecord(record.id);
    assert.ok(job);
    job.status = "source_ready";
    job.updatedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const reaped = await reapIdeRetentionJobs();
    assert.equal(reaped, 1);
    assert.equal(getJobRecord(record.id), null);
  } finally {
    if (previousStorage === undefined) {
      delete process.env.LECTUREGEN_LOCAL_STORAGE_DIR;
    } else {
      process.env.LECTUREGEN_LOCAL_STORAGE_DIR = previousStorage;
    }
    delete process.env.LECTUREGEN_R2_BUCKET;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
