import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertSafeRelativePath,
  safeExtractTarGz,
} from "./safe-tar-extract.ts";

const TAR_CMD = process.platform === "win32" ? "tar.exe" : "tar";

function createTarHeader(memberName: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(memberName, 0, 100, "utf-8");
  header.write("0000644\0", 100, 8, "utf-8");
  header.write("0000000\0", 108, 8, "utf-8");
  header.write("0000000\0", 116, 8, "utf-8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  header.write("        ", 148, 8, "utf-8");
  header.write("0", 156, 1, "utf-8");
  header.write("ustar\0", 257, 6, "utf-8");
  header.write("00", 263, 2, "utf-8");

  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += i >= 148 && i < 156 ? 32 : header[i]!;
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");
  return header;
}

function buildTarGz(
  members: Array<{ name: string; content: string }>,
): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    const content = Buffer.from(member.content, "utf-8");
    blocks.push(createTarHeader(member.name, content.length));
    blocks.push(content);
    const remainder = content.length % 512;
    if (remainder !== 0) {
      blocks.push(Buffer.alloc(512 - remainder));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function runTar(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TAR_CMD, args, {
      cwd,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar failed with code ${code ?? "unknown"}`));
    });
  });
}

test("assertSafeRelativePath rejects traversal and absolute paths", () => {
  assert.throws(
    () => assertSafeRelativePath("../evil.txt"),
    /path traversal/,
  );
  assert.throws(
    () => assertSafeRelativePath("assets/../../evil.txt"),
    /path traversal/,
  );
  assert.throws(
    () => assertSafeRelativePath("/etc/passwd"),
    /absolute path/,
  );
  assert.throws(
    () => assertSafeRelativePath("assets\\..\\evil.txt"),
    /path traversal/,
  );
  assert.throws(
    () => assertSafeRelativePath("C:\\unsafe.txt"),
    /absolute path/,
  );
  assert.doesNotThrow(() => assertSafeRelativePath("index.html"));
  assert.doesNotThrow(() => assertSafeRelativePath("assets/x.png"));
  assert.doesNotThrow(() => assertSafeRelativePath("./index.html"));
});

test("safeExtractTarGz extracts normal workspace files", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-good-src-"));
  const archivePath = path.join(workDir, "bundle.tar.gz");
  const destDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-good-dest-"));

  try {
    await mkdir(path.join(workDir, "assets"), { recursive: true });
    await writeFile(path.join(workDir, "index.html"), "<html></html>", "utf-8");
    await writeFile(path.join(workDir, "assets", "x.png"), "png", "utf-8");
    await runTar(["-czf", archivePath, "-C", workDir, "."]);

    await safeExtractTarGz(archivePath, destDir);

    assert.equal(
      await readFile(path.join(destDir, "index.html"), "utf-8"),
      "<html></html>",
    );
    assert.equal(
      await readFile(path.join(destDir, "assets", "x.png"), "utf-8"),
      "png",
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(destDir, { recursive: true, force: true });
  }
});

test("safeExtractTarGz rejects archives with traversal members", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-bad-traversal-"));
  const archivePath = path.join(workDir, "bad.tar.gz");
  const destDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-bad-dest-"));

  try {
    await writeFile(
      archivePath,
      buildTarGz([{ name: "../evil.txt", content: "bad" }]),
    );

    await assert.rejects(
      () => safeExtractTarGz(archivePath, destDir),
      /path traversal|Unsafe archive member/,
    );
    await assert.rejects(() => access(path.join(destDir, "evil.txt")));
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(destDir, { recursive: true, force: true });
  }
});

test("safeExtractTarGz rejects archives with absolute members", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-bad-abs-"));
  const archivePath = path.join(workDir, "bad.tar.gz");
  const destDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-bad-abs-dest-"));

  try {
    const absoluteMember =
      process.platform === "win32" ? "C:/unsafe.txt" : "/etc/passwd";
    await writeFile(
      archivePath,
      buildTarGz([{ name: absoluteMember, content: "bad" }]),
    );

    await assert.rejects(
      () => safeExtractTarGz(archivePath, destDir),
      /absolute path|Unsafe archive member/,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(destDir, { recursive: true, force: true });
  }
});

test("safeExtractTarGz rejects archives with symlink members", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-bad-symlink-"));
  const archivePath = path.join(workDir, "bad.tar.gz");
  const destDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-bad-symlink-dest-"));

  try {
    await writeFile(path.join(workDir, "target.txt"), "secret", "utf-8");
    try {
      await symlink("target.txt", path.join(workDir, "link.txt"));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EPERM" || err.code === "ENOENT") {
        return;
      }
      throw error;
    }
    await runTar(["-czf", archivePath, "-C", workDir, "link.txt"]);

    await assert.rejects(
      () => safeExtractTarGz(archivePath, destDir),
      /symlink/,
    );
    await assert.rejects(() => access(path.join(destDir, "link.txt")));
    await assert.rejects(() => access(path.join(destDir, "target.txt")));
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(destDir, { recursive: true, force: true });
  }
});
