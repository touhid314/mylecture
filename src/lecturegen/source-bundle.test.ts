import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { workspaceHasBundleableHtml } from "./source-bundle.ts";

test("workspaceHasBundleableHtml accepts multipart index HTML", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "lecturegen-bundle-"));
  try {
    await writeFile(path.join(workspaceDir, "index1.html"), "<html></html>", "utf-8");
    await writeFile(path.join(workspaceDir, "index2.html"), "<html></html>", "utf-8");
    assert.equal(workspaceHasBundleableHtml(workspaceDir), true);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("workspaceHasBundleableHtml accepts interactive.html without index.html", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "lecturegen-bundle-"));
  try {
    await writeFile(path.join(workspaceDir, "interactive.html"), "<html></html>", "utf-8");
    assert.equal(workspaceHasBundleableHtml(workspaceDir), true);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("workspaceHasBundleableHtml accepts game.html without index.html", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "lecturegen-bundle-"));
  try {
    await writeFile(path.join(workspaceDir, "game.html"), "<html></html>", "utf-8");
    assert.equal(workspaceHasBundleableHtml(workspaceDir), true);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("workspaceHasBundleableHtml rejects workspace with no entry HTML", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "lecturegen-bundle-"));
  try {
    await writeFile(path.join(workspaceDir, "notes.txt"), "no html", "utf-8");
    assert.equal(workspaceHasBundleableHtml(workspaceDir), false);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
