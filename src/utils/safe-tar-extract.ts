import { spawn } from "node:child_process";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TAR_CMD = process.platform === "win32" ? "tar.exe" : "tar";

function isUnsafeAbsolutePath(normalized: string): boolean {
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("/")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(normalized);
}

/** Reject relative paths that escape their parent (storage keys, archive members). */
export function assertSafeRelativePath(
  relativePath: string,
  label = "path",
): void {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".") {
    return;
  }
  if (isUnsafeAbsolutePath(normalized)) {
    throw new Error(`Unsafe ${label} (absolute path): ${relativePath}`);
  }
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Unsafe ${label} (path traversal): ${relativePath}`);
  }
}

function isPathInside(parent: string, child: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function runTar(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TAR_CMD, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `tar ${args.join(" ")} failed with code ${code ?? "unknown"}: ${stderr.trim()}`,
        ),
      );
    });
  });
}

function normalizeMemberPath(memberPath: string): string {
  return memberPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function listAndValidateMembers(archivePath: string): Promise<void> {
  const { stdout } = await runTar(["-tzf", archivePath]);
  for (const member of stdout.split(/\r?\n/).filter(Boolean)) {
    assertSafeRelativePath(normalizeMemberPath(member), "archive member");
  }
}

async function validateExtractedTree(rootDir: string): Promise<void> {
  async function walk(currentDir: string, relativeBase: string): Promise<void> {
    if (!isPathInside(rootDir, currentDir)) {
      throw new Error(`Unsafe archive extraction escaped destination: ${relativeBase}`);
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      const relativePath = relativeBase
        ? path.join(relativeBase, entry.name)
        : entry.name;

      if (!isPathInside(rootDir, entryPath)) {
        throw new Error(`Unsafe archive member path: ${relativePath}`);
      }

      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Unsafe archive member (symlink): ${relativePath}`);
      }

      if (stats.isDirectory()) {
        await walk(entryPath, relativePath);
      }
    }
  }

  await walk(rootDir, "");
}

async function moveValidatedTreeIntoDest(
  stagingDir: string,
  destDir: string,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(stagingDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(stagingDir, entry.name);
    const dest = path.join(destDir, entry.name);
    try {
      await rename(src, dest);
    } catch {
      if (entry.isDirectory()) {
        await cp(src, dest, { recursive: true });
      } else {
        await copyFile(src, dest);
      }
    }
  }
}

/** Extract a .tar.gz archive into destDir with path-traversal and symlink guards. */
export async function safeExtractTarGz(
  archivePath: string,
  destDir: string,
): Promise<void> {
  await listAndValidateMembers(archivePath);
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), "safe-tar-staging-"));
  try {
    await mkdir(stagingDir, { recursive: true });
    await runTar(["-xzf", archivePath, "-C", stagingDir]);
    await validateExtractedTree(stagingDir);
    await moveValidatedTreeIntoDest(stagingDir, destDir);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
