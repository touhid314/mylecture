import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import type { RenderStorageProvider } from "./types.ts";

let client: SupabaseClient | null = null;

function getSupabaseUrl(): string | undefined {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    undefined
  );
}

function getServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
}

function getBucket(): string {
  return process.env.SUPABASE_VIDEO_BUCKET?.trim() || "videos";
}

function getClient(): SupabaseClient {
  if (client) return client;

  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  if (!url || !key) {
    throw new Error("Supabase storage is not configured");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node 20 in Docker has no native WebSocket; `ws` is required for realtime-js init.
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
  return client;
}

function createSupabaseRenderStorage(): RenderStorageProvider {
  return {
    isConfigured(): boolean {
      return Boolean(getSupabaseUrl() && getServiceRoleKey());
    },

    async uploadFile(
      key: string,
      localFilePath: string,
      contentType: string,
    ): Promise<void> {
      const buffer = await readFile(localFilePath);
      await this.uploadBuffer(key, buffer, contentType);
    },

    async uploadBuffer(
      key: string,
      buffer: Buffer,
      contentType: string,
    ): Promise<void> {
      const { error } = await getClient()
        .storage.from(getBucket())
        .upload(key, buffer, { contentType, upsert: true });

      if (error) {
        throw new Error(`Upload failed for ${key}: ${error.message}`);
      }
    },

    async downloadToFile(key: string, localFilePath: string): Promise<void> {
      const { data, error } = await getClient()
        .storage.from(getBucket())
        .download(key);

      if (error || !data) {
        throw new Error(
          `Download failed for ${key}: ${error?.message ?? "no data"}`,
        );
      }

      await mkdir(path.dirname(localFilePath), { recursive: true });
      const buffer = Buffer.from(await data.arrayBuffer());
      await writeFile(localFilePath, buffer);
    },

    async list(prefix: string): Promise<string[]> {
      const { data, error } = await getClient()
        .storage.from(getBucket())
        .list(prefix);

      if (error || !data) {
        return [];
      }

      return data
        .filter((entry) => entry.metadata !== null)
        .map((entry) => `${prefix}/${entry.name}`);
    },

    async downloadPrefixToDir(prefix: string, localDir: string): Promise<void> {
      const files = await this.list(prefix);
      await mkdir(localDir, { recursive: true });

      for (const objectPath of files) {
        const basename = path.basename(objectPath);
        await this.downloadToFile(objectPath, path.join(localDir, basename));
      }
    },
  };
}

let storage: RenderStorageProvider | null = null;

export function getSupabaseRenderStorage(): RenderStorageProvider {
  if (!storage) {
    storage = createSupabaseRenderStorage();
  }
  return storage;
}
