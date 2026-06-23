import type { Readable } from "node:stream";

export interface RenderStorageProvider {
  isConfigured(): boolean;
  uploadFile(key: string, localFilePath: string, contentType: string): Promise<void>;
  uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void>;
  downloadToFile(key: string, localFilePath: string): Promise<void>;
  downloadPrefixToDir(prefix: string, localDir: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
