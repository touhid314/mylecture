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
      } catch (err) {
        console.warn(
          `[storage] downloadToFile fallback to Supabase for key: ${key} (${err instanceof Error ? err.message : String(err)})`,
        );
        await fallback.downloadToFile(key, localFilePath);
      }
    },

    async list(prefix: string): Promise<string[]> {
      let primaryKeys: string[] = [];
      let fallbackKeys: string[] = [];
      let primaryFailed = false;
      try {
        primaryKeys = await primary.list(prefix);
      } catch (err) {
        primaryFailed = true;
        console.warn(
          `[storage] primary list failed for prefix "${prefix}": ${err instanceof Error ? err.message : String(err)}`,
        );
        primaryKeys = [];
      }
      try {
        fallbackKeys = await fallback.list(prefix);
      } catch (err) {
        console.warn(
          `[storage] fallback list failed for prefix "${prefix}": ${err instanceof Error ? err.message : String(err)}`,
        );
        fallbackKeys = [];
      }
      if (primaryFailed && fallbackKeys.length > 0) {
        console.warn(`[storage] list using Supabase results for prefix: ${prefix}`);
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
