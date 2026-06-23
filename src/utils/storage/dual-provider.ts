import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { RenderStorageProvider } from "./types.ts";

export function createDualRenderStorage(
  primary: RenderStorageProvider,
  fallback: RenderStorageProvider,
): RenderStorageProvider {
  const storage: RenderStorageProvider = {
    isConfigured(): boolean {
      return primary.isConfigured();
    },

    async uploadFile(
      key: string,
      localFilePath: string,
      contentType: string,
    ): Promise<void> {
      await primary.uploadFile(key, localFilePath, contentType);
    },

    async uploadBuffer(
      key: string,
      buffer: Buffer,
      contentType: string,
    ): Promise<void> {
      await primary.uploadBuffer(key, buffer, contentType);
    },

    async downloadToFile(key: string, localFilePath: string): Promise<void> {
      try {
        await primary.downloadToFile(key, localFilePath);
      } catch {
        await fallback.downloadToFile(key, localFilePath);
      }
    },

    async list(prefix: string): Promise<string[]> {
      let primaryKeys: string[] = [];
      let fallbackKeys: string[] = [];
      try {
        primaryKeys = await primary.list(prefix);
      } catch {
        primaryKeys = [];
      }
      try {
        fallbackKeys = await fallback.list(prefix);
      } catch {
        fallbackKeys = [];
      }
      return [...new Set([...primaryKeys, ...fallbackKeys])];
    },

    async downloadPrefixToDir(prefix: string, localDir: string): Promise<void> {
      const keys = await storage.list(prefix);
      await mkdir(localDir, { recursive: true });
      for (const key of keys) {
        await storage.downloadToFile(
          key,
          path.join(localDir, path.basename(key)),
        );
      }
    },
  };
  return storage;
}
