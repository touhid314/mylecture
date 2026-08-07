import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  listIntermediateKeys,
  putIntermediateText,
  readIntermediateText,
  useLocalIntermediateStorage,
} from "./storage.ts";
import type {
  LectureGenCreateRequest,
  LectureGenEditRequest,
  LectureGenJobRecord,
} from "./types.ts";

export type PersistedJobManifest = LectureGenJobRecord & {
  createRequest?: LectureGenCreateRequest | null;
  lastEditRequest?: LectureGenEditRequest | null;
};

function manifestKey(generationId: string): string {
  return `${generationId}/manifest.json`;
}

function localRoot(): string {
  return (
    process.env.LECTUREGEN_LOCAL_STORAGE_DIR?.trim() ||
    path.join(process.cwd(), ".lecturegen")
  );
}

function localManifestPath(generationId: string): string {
  return path.join(localRoot(), generationId, "manifest.json");
}

export async function saveJobManifest(manifest: PersistedJobManifest): Promise<void> {
  const body = JSON.stringify(manifest);
  await putIntermediateText(manifestKey(manifest.id), body, "application/json");
}

export async function loadJobManifest(
  generationId: string,
): Promise<PersistedJobManifest | null> {
  if (useLocalIntermediateStorage()) {
    const filePath = localManifestPath(generationId);
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as PersistedJobManifest;
  }

  const key = manifestKey(generationId);
  const raw = await readIntermediateText(key);
  if (!raw) return null;
  return JSON.parse(raw) as PersistedJobManifest;
}

export async function listPersistedGenerationIds(): Promise<string[]> {
  if (useLocalIntermediateStorage()) {
    const root = localRoot();
    if (!existsSync(root)) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, entry.name, "manifest.json");
      if (existsSync(manifestPath)) {
        ids.push(entry.name);
      }
    }
    return ids;
  }

  const keys = await listIntermediateKeys("");
  const ids = new Set<string>();
  for (const key of keys) {
    if (!key.endsWith("/manifest.json")) continue;
    const generationId = key.slice(0, -"/manifest.json".length);
    if (generationId && !generationId.includes("/")) {
      ids.add(generationId);
    }
  }
  return [...ids];
}

export async function ensureLocalManifestDir(generationId: string): Promise<void> {
  if (useLocalIntermediateStorage()) {
    await mkdir(path.dirname(localManifestPath(generationId)), { recursive: true });
  }
}

/** Local-only helper for tests. */
export async function writeLocalManifestForTest(
  generationId: string,
  manifest: PersistedJobManifest,
): Promise<void> {
  const filePath = localManifestPath(generationId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(manifest), "utf-8");
}
