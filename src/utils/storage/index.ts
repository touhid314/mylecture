import type { RenderStorageProvider } from "./types.ts";
import { getSupabaseRenderStorage } from "./supabase-provider.ts";
import { getR2RenderStorage } from "./r2-provider.ts";
import { createDualRenderStorage } from "./dual-provider.ts";

export type { RenderStorageProvider } from "./types.ts";

// STORAGE_BACKEND: supabase (default) | r2 (R2 primary + Supabase fallback) | r2-only (R2 only)
function getStorageBackend(): string {
  return (process.env.STORAGE_BACKEND ?? "supabase").trim().toLowerCase();
}

let cached: RenderStorageProvider | null = null;

export function getRenderStorage(): RenderStorageProvider {
  if (cached) return cached;
  const backend = getStorageBackend();
  if (backend === "r2") {
    cached = createDualRenderStorage(getR2RenderStorage(), getSupabaseRenderStorage());
  } else if (backend === "r2-only") {
    cached = getR2RenderStorage();
  } else {
    cached = getSupabaseRenderStorage();
  }
  return cached;
}

export function isStorageConfigured(): boolean {
  return getRenderStorage().isConfigured();
}
