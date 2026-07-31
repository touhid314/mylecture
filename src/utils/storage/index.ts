import type { RenderStorageProvider } from "./types.ts";
import { getSupabaseRenderStorage } from "./supabase-provider.ts";
import { getR2RenderStorage } from "./r2-provider.ts";
import { createDualRenderStorage } from "./dual-provider.ts";

export type { RenderStorageProvider } from "./types.ts";

// STORAGE_BACKEND: supabase (default) | r2 (R2 primary + Supabase fallback) | r2-only (R2 only)
// Must match mylecture-website/src/lib/storage/index.ts so website uploads and worker reads use the same backend.
export function getStorageBackend(): string {
  if (process.env.STORAGE_BACKEND) {
    return process.env.STORAGE_BACKEND.trim().toLowerCase();
  }
  if (process.env.R2_PRIVATE_BUCKET && process.env.R2_SECRET_ACCESS_KEY) {
    return "r2-only";
  }
  if (process.env.R2_BUCKET_NAME && process.env.R2_SECRET_ACCESS_KEY) {
    return "r2-only";
  }
  return "supabase";
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
