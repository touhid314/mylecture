import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  });
  return client;
}

export function isStorageConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getServiceRoleKey());
}

export async function uploadFile(
  objectPath: string,
  localFilePath: string,
  contentType: string,
): Promise<void> {
  const buffer = await readFile(localFilePath);
  await uploadBuffer(objectPath, buffer, contentType);
}

export async function uploadBuffer(
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await getClient()
    .storage.from(getBucket())
    .upload(objectPath, buffer, { contentType, upsert: true });

  if (error) {
    throw new Error(`Upload failed for ${objectPath}: ${error.message}`);
  }
}

export async function downloadToFile(
  objectPath: string,
  localFilePath: string,
): Promise<void> {
  const { data, error } = await getClient()
    .storage.from(getBucket())
    .download(objectPath);

  if (error || !data) {
    throw new Error(
      `Download failed for ${objectPath}: ${error?.message ?? "no data"}`,
    );
  }

  await mkdir(path.dirname(localFilePath), { recursive: true });
  const buffer = Buffer.from(await data.arrayBuffer());
  await writeFile(localFilePath, buffer);
}

export async function listFiles(prefix: string): Promise<string[]> {
  const { data, error } = await getClient()
    .storage.from(getBucket())
    .list(prefix);

  if (error || !data) {
    return [];
  }

  return data
    .filter((entry) => entry.metadata !== null)
    .map((entry) => `${prefix}/${entry.name}`);
}

export async function downloadPrefixToDir(
  prefix: string,
  localDir: string,
): Promise<void> {
  const files = await listFiles(prefix);
  await mkdir(localDir, { recursive: true });

  for (const objectPath of files) {
    const basename = path.basename(objectPath);
    await downloadToFile(objectPath, path.join(localDir, basename));
  }
}
