import type { RenderStorageProvider } from "./types.ts";
import { getSupabaseRenderStorage } from "./supabase-provider.ts";
import { getR2RenderStorage } from "./r2-provider.ts";
import { createDualRenderStorage } from "./dual-provider.ts";

export type { RenderStorageProvider } from "./types.ts";

function getStorageBackend(): string {
  return (process.env.STORAGE_BACKEND ?? "supabase").trim().toLowerCase();
}

let cached: RenderStorageProvider | null = null;

export function getRenderStorage(): RenderStorageProvider {
  if (cached) return cached;
  cached =
    getStorageBackend() === "r2"
      ? createDualRenderStorage(getR2RenderStorage(), getSupabaseRenderStorage())
      : getSupabaseRenderStorage();
  return cached;
}

export function isStorageConfigured(): boolean {
  return getRenderStorage().isConfigured();
}
