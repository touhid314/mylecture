import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { RenderStorageProvider } from "./types.ts";

let client: S3Client | null = null;

function getEndpoint(): string | undefined {
  const explicit = process.env.R2_ENDPOINT?.trim();
  if (explicit) return explicit;

  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  if (accountId) {
    return `https://${accountId}.r2.cloudflarestorage.com`;
  }

  return undefined;
}

function getAccessKeyId(): string | undefined {
  return process.env.R2_ACCESS_KEY_ID?.trim() || undefined;
}

function getSecretAccessKey(): string | undefined {
  return process.env.R2_SECRET_ACCESS_KEY?.trim() || undefined;
}

function getPrivateBucket(): string | undefined {
  return process.env.R2_PRIVATE_BUCKET?.trim() || undefined;
}

function getClient(): S3Client {
  if (client) return client;

  const endpoint = getEndpoint();
  const accessKeyId = getAccessKeyId();
  const secretAccessKey = getSecretAccessKey();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 storage is not configured");
  }

  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return client;
}

function createR2RenderStorage(): RenderStorageProvider {
  return {
    isConfigured(): boolean {
      return Boolean(
        getEndpoint() &&
          getAccessKeyId() &&
          getSecretAccessKey() &&
          getPrivateBucket(),
      );
    },

    async objectHead(key: string) {
      const bucket = getPrivateBucket();
      if (!bucket) {
        return { exists: false, lastModifiedMs: null };
      }

      try {
        const res = await getClient().send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
        return {
          exists: true,
          lastModifiedMs: res.LastModified?.getTime() ?? null,
        };
      } catch {
        return { exists: false, lastModifiedMs: null };
      }
    },

    async objectExists(key: string): Promise<boolean> {
      return (await this.objectHead(key)).exists;
    },

    async uploadFile(
      key: string,
      localFilePath: string,
      contentType: string,
    ): Promise<void> {
      const bucket = getPrivateBucket();
      if (!bucket) {
        throw new Error("R2 private bucket is not configured");
      }

      await new Upload({
        client: getClient(),
        params: {
          Bucket: bucket,
          Key: key,
          Body: createReadStream(localFilePath),
          ContentType: contentType,
        },
      }).done();
    },

    async uploadBuffer(
      key: string,
      buffer: Buffer,
      contentType: string,
    ): Promise<void> {
      const bucket = getPrivateBucket();
      if (!bucket) {
        throw new Error("R2 private bucket is not configured");
      }

      await getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
    },

    async downloadToFile(key: string, localFilePath: string): Promise<void> {
      const bucket = getPrivateBucket();
      if (!bucket) {
        throw new Error("R2 private bucket is not configured");
      }

      const res = await getClient().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      if (!res.Body) {
        throw new Error(`Download failed for ${key}: no data`);
      }

      await mkdir(path.dirname(localFilePath), { recursive: true });
      await pipeline(res.Body as Readable, createWriteStream(localFilePath));
    },

    async list(prefix: string): Promise<string[]> {
      const bucket = getPrivateBucket();
      if (!bucket) {
        return [];
      }

      const keys: string[] = [];
      let continuationToken: string | undefined;

      do {
        const res = await getClient().send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );

        for (const obj of res.Contents ?? []) {
          if (obj.Key) {
            keys.push(obj.Key);
          }
        }

        continuationToken = res.IsTruncated
          ? res.NextContinuationToken
          : undefined;
      } while (continuationToken);

      return keys;
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

export function getR2RenderStorage(): RenderStorageProvider {
  if (!storage) {
    storage = createR2RenderStorage();
  }
  return storage;
}
