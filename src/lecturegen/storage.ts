import { createReadStream, createWriteStream, existsSync } from "node:fs";
import type { Readable } from "node:stream";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import type { LectureGenTransferPurpose } from "./types.ts";

const SIGNED_URL_TTL_SECONDS = 900;

type BucketKind = "intermediate" | "output";

let intermediateClient: S3Client | null = null;
let outputClient: S3Client | null = null;

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function getEndpoint(): string | undefined {
  const explicit = readEnv("LECTUREGEN_R2_ENDPOINT") || readEnv("R2_ENDPOINT");
  if (explicit) return explicit;
  const accountId = readEnv("LECTUREGEN_R2_ACCOUNT_ID") || readEnv("R2_ACCOUNT_ID");
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  return undefined;
}

function getAccessKeyId(kind: BucketKind): string | undefined {
  if (kind === "output") {
    return (
      readEnv("WEBSITE_OUTPUT_R2_ACCESS_KEY_ID") ||
      readEnv("R2_ACCESS_KEY_ID") ||
      undefined
    );
  }
  return (
    readEnv("LECTUREGEN_R2_ACCESS_KEY_ID") ||
    readEnv("R2_ACCESS_KEY_ID") ||
    undefined
  );
}

function getSecretAccessKey(kind: BucketKind): string | undefined {
  if (kind === "output") {
    return (
      readEnv("WEBSITE_OUTPUT_R2_SECRET_ACCESS_KEY") ||
      readEnv("R2_SECRET_ACCESS_KEY") ||
      undefined
    );
  }
  return (
    readEnv("LECTUREGEN_R2_SECRET_ACCESS_KEY") ||
    readEnv("R2_SECRET_ACCESS_KEY") ||
    undefined
  );
}

function getIntermediateBucket(): string | undefined {
  return readEnv("LECTUREGEN_R2_BUCKET") || undefined;
}

function getOutputBucket(): string | undefined {
  return (
    readEnv("WEBSITE_OUTPUT_R2_BUCKET") ||
    readEnv("R2_PRIVATE_BUCKET") ||
    undefined
  );
}

function getClient(kind: BucketKind): S3Client {
  if (kind === "intermediate") {
    if (intermediateClient) return intermediateClient;
    const endpoint = getEndpoint();
    const accessKeyId = getAccessKeyId("intermediate");
    const secretAccessKey = getSecretAccessKey("intermediate");
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("LectureGen intermediate storage is not configured");
    }
    intermediateClient = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    return intermediateClient;
  }

  if (outputClient) return outputClient;
  const endpoint = getEndpoint();
  const accessKeyId = getAccessKeyId("output");
  const secretAccessKey = getSecretAccessKey("output");
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Website output storage is not configured");
  }
  outputClient = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return outputClient;
}

function localRoot(): string {
  return readEnv("LECTUREGEN_LOCAL_STORAGE_DIR") || path.join(process.cwd(), ".lecturegen");
}

export function isIntermediateStorageConfigured(): boolean {
  if (!getIntermediateBucket()) {
    return !requiresDurableIntermediateStorage();
  }
  return Boolean(
    getEndpoint() && getAccessKeyId("intermediate") && getSecretAccessKey("intermediate"),
  );
}

export function isOutputStorageConfigured(): boolean {
  const bucket = getOutputBucket();
  if (bucket && getEndpoint() && getAccessKeyId("output") && getSecretAccessKey("output")) {
    return true;
  }
  return false;
}

export function useLocalIntermediateStorage(): boolean {
  return !getIntermediateBucket() && !requiresDurableIntermediateStorage();
}

export function requiresDurableIntermediateStorage(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    readEnv("LECTUREGEN_REQUIRE_R2") === "1" ||
    readEnv("LECTUREGEN_VALIDATE_STARTUP") === "1"
  );
}

function versionPrefix(generationId: string, sourceVersion: number): string {
  return `${generationId}/v${sourceVersion}`;
}

function localPathForKey(key: string): string {
  return path.join(localRoot(), key.replace(/\//g, path.sep));
}

export function sourceHtmlKey(generationId: string, sourceVersion: number): string {
  return `${versionPrefix(generationId, sourceVersion)}/raw.html`;
}

export function resolvedHtmlKey(generationId: string, sourceVersion: number): string {
  return `${versionPrefix(generationId, sourceVersion)}/resolved/resolved.html`;
}

export function resolvedAudioPrefix(generationId: string, sourceVersion: number): string {
  return `${versionPrefix(generationId, sourceVersion)}/resolved/audio`;
}

export function resolvedCaptionsKey(generationId: string, sourceVersion: number): string {
  return `${versionPrefix(generationId, sourceVersion)}/resolved/captions.vtt`;
}

export function workspacePrefix(generationId: string, sourceVersion: number): string {
  return `${versionPrefix(generationId, sourceVersion)}/workspace`;
}

export function workspaceBundleKey(generationId: string, sourceVersion: number): string {
  return `${versionPrefix(generationId, sourceVersion)}/.workspace-bundle.tar.gz`;
}

/** Ensure transfer keys stay scoped to the requested generation/version workspace. */
export function assertWorkspaceDownloadScope(
  generationId: string,
  sourceVersion: number,
  objectKey: string,
): void {
  const requiredPrefix = `${workspacePrefix(generationId, sourceVersion)}/`;
  const normalized = objectKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith(requiredPrefix)) {
    throw new Error(`workspace_download key must be under ${requiredPrefix}`);
  }
}

export function resolvedObjectPrefix(
  generationId: string,
  sourceVersion: number,
): string {
  return `${versionPrefix(generationId, sourceVersion)}/resolved/`;
}

export function jobManifestKey(generationId: string): string {
  return `${generationId}/manifest.json`;
}

/** Validate worker transfer keys stay under the resolved prefix for a version. */
export function assertResolvedTransferKey(
  generationId: string,
  sourceVersion: number,
  objectKey: string,
): string {
  const normalized = objectKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid objectKey");
  }
  const requiredPrefix = resolvedObjectPrefix(generationId, sourceVersion);
  if (!normalized.startsWith(requiredPrefix) || normalized === requiredPrefix) {
    throw new Error(`objectKey must be under ${requiredPrefix}`);
  }
  if (normalized.includes("/workspace/") || normalized.includes("/workspace")) {
    throw new Error("workspace keys cannot be signed via resolved transfers");
  }
  return normalized;
}

export async function readIntermediateText(key: string): Promise<string | null> {
  if (useLocalIntermediateStorage()) {
    const filePath = localPathForKey(key);
    if (!existsSync(filePath)) return null;
    return readFile(filePath, "utf-8");
  }

  const bucket = getIntermediateBucket();
  if (!bucket) return null;

  try {
    const response = await getClient("intermediate").send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body) return null;
    return await response.Body.transformToString();
  } catch {
    return null;
  }
}

export async function putIntermediateText(key: string, body: string, contentType: string): Promise<void> {
  if (useLocalIntermediateStorage()) {
    const filePath = localPathForKey(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body, "utf-8");
    return;
  }

  const bucket = getIntermediateBucket();
  if (!bucket) throw new Error("LECTUREGEN_R2_BUCKET is not configured");

  await getClient("intermediate").send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(body, "utf-8"),
      ContentType: contentType,
    }),
  );
}

export async function putIntermediateFile(key: string, localFilePath: string, contentType: string): Promise<void> {
  if (useLocalIntermediateStorage()) {
    const filePath = localPathForKey(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    const data = await readFile(localFilePath);
    await writeFile(filePath, data);
    return;
  }

  const bucket = getIntermediateBucket();
  if (!bucket) throw new Error("LECTUREGEN_R2_BUCKET is not configured");

  await new Upload({
    client: getClient("intermediate"),
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localFilePath),
      ContentType: contentType,
    },
  }).done();
}

export async function downloadIntermediateToFile(key: string, localFilePath: string): Promise<void> {
  if (useLocalIntermediateStorage()) {
    const source = localPathForKey(key);
    if (!existsSync(source)) {
      throw new Error(`Local object not found: ${key}`);
    }
    await mkdir(path.dirname(localFilePath), { recursive: true });
    const data = await readFile(source);
    await writeFile(localFilePath, data);
    return;
  }

  const bucket = getIntermediateBucket();
  if (!bucket) throw new Error("LECTUREGEN_R2_BUCKET is not configured");

  const response = await getClient("intermediate").send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) throw new Error(`Object not found: ${key}`);
  await mkdir(path.dirname(localFilePath), { recursive: true });
  const body = response.Body as NodeJS.ReadableStream;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(localFilePath);
    body.pipe(out);
    body.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => resolve());
  });
}

export async function openIntermediateReadStream(
  key: string,
): Promise<{ stream: Readable; contentLength: number }> {
  if (useLocalIntermediateStorage()) {
    const filePath = localPathForKey(key);
    if (!existsSync(filePath)) {
      throw new Error(`Local object not found: ${key}`);
    }
    const fileStat = await stat(filePath);
    return { stream: createReadStream(filePath), contentLength: fileStat.size };
  }

  const bucket = getIntermediateBucket();
  if (!bucket) throw new Error("LECTUREGEN_R2_BUCKET is not configured");

  const response = await getClient("intermediate").send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) throw new Error(`Object not found: ${key}`);
  const contentLength = response.ContentLength ?? 0;
  return { stream: response.Body as Readable, contentLength };
}

export async function uploadWorkspaceDir(
  generationId: string,
  sourceVersion: number,
  workspaceDir: string,
): Promise<void> {
  const prefix = workspacePrefix(generationId, sourceVersion);
  const entries = await readdir(workspaceDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(entry.parentPath ?? entry.path, entry.name);
    const rel = path.relative(workspaceDir, fullPath).replace(/\\/g, "/");
    const key = `${prefix}/${rel}`;
    const ext = path.extname(rel).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".md"
          ? "text/markdown; charset=utf-8"
          : "application/octet-stream";
    await putIntermediateFile(key, fullPath, contentType);
  }
}

export async function putOutputText(key: string, body: string, contentType: string): Promise<void> {
  const bucket = getOutputBucket();
  if (!bucket || !isOutputStorageConfigured()) {
    throw new Error("Website output storage is not configured on LectureGen host");
  }

  await getClient("output").send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(body, "utf-8"),
      ContentType: contentType,
    }),
  );
}

export async function listIntermediateKeys(prefix: string): Promise<string[]> {
  const normalizedPrefix = prefix
    ? prefix.endsWith("/")
      ? prefix
      : `${prefix}/`
    : "";

  if (useLocalIntermediateStorage()) {
    const rootDir = localPathForKey(normalizedPrefix);
    if (!existsSync(rootDir)) {
      return [];
    }

    const keys: string[] = [];
    async function walk(dir: string, keyPrefix: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const key = `${keyPrefix}${entry.name}`;
        if (entry.isDirectory()) {
          await walk(fullPath, `${key}/`);
        } else if (entry.isFile()) {
          keys.push(key);
        }
      }
    }
    await walk(rootDir, normalizedPrefix);
    return keys;
  }

  const bucket = getIntermediateBucket();
  if (!bucket) return [];

  const client = getClient("intermediate");
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of listed.Contents ?? []) {
      if (item.Key && !item.Key.endsWith("/")) {
        keys.push(item.Key);
      }
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

export async function removeIntermediatePrefix(prefix: string): Promise<void> {
  if (useLocalIntermediateStorage()) {
    const dir = localPathForKey(prefix);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
    return;
  }

  const bucket = getIntermediateBucket();
  if (!bucket) return;

  const client = getClient("intermediate");
  let continuationToken: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (listed.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

function transferKey(
  generationId: string,
  sourceVersion: number,
  purpose: LectureGenTransferPurpose,
  objectKey?: string,
): string {
  if (purpose === "source_download") {
    return sourceHtmlKey(generationId, sourceVersion);
  }
  if (purpose === "workspace_download") {
    return workspaceBundleKey(generationId, sourceVersion);
  }
  if (purpose === "resolved_download") {
    if (objectKey) {
      return assertResolvedTransferKey(generationId, sourceVersion, objectKey);
    }
    return resolvedHtmlKey(generationId, sourceVersion);
  }
  if (!objectKey) {
    throw new Error("objectKey is required for resolved_upload transfers");
  }
  return assertResolvedTransferKey(generationId, sourceVersion, objectKey);
}

export async function createSignedTransferUrl(opts: {
  generationId: string;
  sourceVersion: number;
  purpose: LectureGenTransferPurpose;
  objectKey?: string;
}): Promise<{ url: string; method: "GET" | "PUT"; expiresAt: string }> {
  const key = transferKey(opts.generationId, opts.sourceVersion, opts.purpose, opts.objectKey);
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  if (useLocalIntermediateStorage()) {
    const filePath = localPathForKey(key);
    if (
      opts.purpose === "source_download" ||
      opts.purpose === "workspace_download" ||
      opts.purpose === "resolved_download"
    ) {
      if (!existsSync(filePath)) {
        throw new Error(`Object not found: ${key}`);
      }
    } else {
      await mkdir(path.dirname(filePath), { recursive: true });
    }
    return {
      url: `file://${filePath}`,
      method: opts.purpose === "resolved_upload" ? "PUT" : "GET",
      expiresAt,
    };
  }

  const bucket = getIntermediateBucket();
  if (!bucket) throw new Error("LECTUREGEN_R2_BUCKET is not configured");
  const client = getClient("intermediate");
  const command =
    opts.purpose === "resolved_upload"
      ? new PutObjectCommand({ Bucket: bucket, Key: key })
      : new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(client, command, { expiresIn: SIGNED_URL_TTL_SECONDS });
  return {
    url,
    method: opts.purpose === "resolved_upload" ? "PUT" : "GET",
    expiresAt,
  };
}

export async function intermediateObjectExists(key: string): Promise<boolean> {
  if (useLocalIntermediateStorage()) {
    try {
      await stat(localPathForKey(key));
      return true;
    } catch {
      return false;
    }
  }

  const bucket = getIntermediateBucket();
  if (!bucket) return false;
  try {
    await getClient("intermediate").send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}
