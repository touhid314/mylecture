import type { Readable } from "node:stream";

export type StorageObjectHead = {
  exists: boolean;
  lastModifiedMs: number | null;
};

export interface RenderStorageProvider {
  isConfigured(): boolean;
  objectHead(key: string): Promise<StorageObjectHead>;
  objectExists(key: string): Promise<boolean>;
  uploadFile(key: string, localFilePath: string, contentType: string): Promise<void>;
  uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void>;
  downloadToFile(key: string, localFilePath: string): Promise<void>;
  downloadPrefixToDir(prefix: string, localDir: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
