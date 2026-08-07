import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSignedTransferUrl,
  downloadIntermediateToFile,
  intermediateObjectExists,
  listIntermediateKeys,
  openIntermediateReadStream,
  putIntermediateFile,
  workspacePrefix,
  workspaceBundleKey,
} from "./storage.ts";
import { assertSafeRelativePath } from "../utils/safe-tar-extract.ts";

const bundleBuildPromises = new Map<string, Promise<void>>();

const BUNDLE_ENTRY_FILES = ["index.html", "interactive.html", "game.html"] as const;

/** At least one activity entry HTML must exist; renderer validates index.html separately. */
export function workspaceHasBundleableHtml(workspaceDir: string): boolean {
  return BUNDLE_ENTRY_FILES.some((name) =>
    existsSync(path.join(workspaceDir, name)),
  );
}

export async function downloadWorkspaceFromStorage(
  generationId: string,
  sourceVersion: number,
): Promise<{ workspaceDir: string; cleanup: () => Promise<void> }> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "lecturegen-ws-"));
  const prefix = `${workspacePrefix(generationId, sourceVersion)}/`;
  const indexKey = `${prefix}index.html`;

  try {
    const keys = await listIntermediateKeys(prefix);
    if (keys.length === 0) {
      await downloadIntermediateToFile(indexKey, path.join(workspaceDir, "index.html"));
    } else {
      for (const key of keys) {
        const relativePath = key.slice(prefix.length);
        if (!relativePath) continue;
        assertSafeRelativePath(relativePath, "storage key");
        const destPath = path.join(workspaceDir, relativePath.replace(/\//g, path.sep));
        await mkdir(path.dirname(destPath), { recursive: true });
        await downloadIntermediateToFile(key, destPath);
      }
    }
  } catch {
    await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    throw new Error("Workspace source not found for this version");
  }

  return {
    workspaceDir,
    cleanup: async () => {
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function tarWorkspace(workspaceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "tar.exe" : "tar";
    const args = ["-czf", outputPath, "-C", workspaceDir, "."];
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function createSourceBundleFile(
  workspaceDir: string,
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const bundleDir = await mkdtemp(path.join(os.tmpdir(), "lecturegen-bundle-"));
  const bundlePath = path.join(bundleDir, "source.tar.gz");
  await tarWorkspace(workspaceDir, bundlePath);
  return {
    filePath: bundlePath,
    cleanup: async () => {
      await rm(bundleDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function ensureWorkspaceBundle(
  generationId: string,
  sourceVersion: number,
): Promise<void> {
  const cacheKey = `${generationId}:v${sourceVersion}`;
  const inFlight = bundleBuildPromises.get(cacheKey);
  if (inFlight) {
    await inFlight;
    return;
  }

  const buildPromise = (async () => {
    const bundleKey = workspaceBundleKey(generationId, sourceVersion);
    if (await intermediateObjectExists(bundleKey)) {
      return;
    }

    const { workspaceDir, cleanup } = await downloadWorkspaceFromStorage(
      generationId,
      sourceVersion,
    );
    try {
      if (!workspaceHasBundleableHtml(workspaceDir)) {
        throw new Error(
          "Workspace must contain index.html, interactive.html, or game.html",
        );
      }
      const bundle = await createSourceBundleFile(workspaceDir);
      try {
        await putIntermediateFile(bundleKey, bundle.filePath, "application/gzip");
      } finally {
        await bundle.cleanup();
      }
    } finally {
      await cleanup();
    }
  })();

  bundleBuildPromises.set(cacheKey, buildPromise);
  try {
    await buildPromise;
  } finally {
    bundleBuildPromises.delete(cacheKey);
  }
}

export async function openWorkspaceBundleStream(
  generationId: string,
  sourceVersion: number,
): Promise<{ stream: NodeJS.ReadableStream; contentLength: number }> {
  await ensureWorkspaceBundle(generationId, sourceVersion);
  const bundleKey = workspaceBundleKey(generationId, sourceVersion);
  const { stream, contentLength } = await openIntermediateReadStream(bundleKey);
  return { stream, contentLength };
}

export async function createWorkspaceDownloadTransfer(opts: {
  generationId: string;
  sourceVersion: number;
}): Promise<{ url: string; method: "GET" | "PUT"; expiresAt: string }> {
  await ensureWorkspaceBundle(opts.generationId, opts.sourceVersion);
  return createSignedTransferUrl({
    generationId: opts.generationId,
    sourceVersion: opts.sourceVersion,
    purpose: "workspace_download",
  });
}
