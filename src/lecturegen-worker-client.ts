export type LectureGenTransferPurpose =
  | "source_download"
  | "workspace_download"
  | "resolved_upload"
  | "resolved_download"
  | "resolved_audio_list";

export function isLectureGenWorkerConfigured(): boolean {
  return Boolean(
    process.env.LECTUREGEN_URL?.trim() && process.env.LECTUREGEN_WORKER_TOKEN?.trim(),
  );
}

function lectureGenUrl(): string {
  const base = process.env.LECTUREGEN_URL?.trim();
  if (!base) {
    throw new Error("LECTUREGEN_URL is not configured");
  }
  return base.replace(/\/$/, "");
}

function workerHeaders(): HeadersInit {
  const token = process.env.LECTUREGEN_WORKER_TOKEN?.trim();
  if (!token) {
    throw new Error("LECTUREGEN_WORKER_TOKEN is not configured");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function requestLectureGenTransfer(opts: {
  generationId: string;
  sourceVersion: number;
  purpose: LectureGenTransferPurpose;
  objectKey?: string;
}): Promise<{ url: string; method: "GET" | "PUT"; expiresAt: string }> {
  const endpoint = `${lectureGenUrl()}/v1/jobs/${opts.generationId}/transfers`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      purpose: opts.purpose,
      sourceVersion: opts.sourceVersion,
      objectKey: opts.objectKey,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LectureGen transfer failed (${response.status}): ${text}`);
  }

  return (await response.json()) as {
    url: string;
    method: "GET" | "PUT";
    expiresAt: string;
  };
}

export async function requestLectureGenResolvedAudioList(opts: {
  generationId: string;
  sourceVersion: number;
}): Promise<string[]> {
  const endpoint = `${lectureGenUrl()}/v1/jobs/${opts.generationId}/transfers`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      purpose: "resolved_audio_list",
      sourceVersion: opts.sourceVersion,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LectureGen audio list failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as { objectKeys?: string[] };
  return body.objectKeys ?? [];
}

export async function downloadFromTransferUrl(url: string, destPath: string): Promise<void> {
  if (url.startsWith("file://")) {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(url.replace(/^file:\/\//, ""), destPath);
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Transfer download failed: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const { writeFile, mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, bytes);
}

export async function uploadToTransferUrl(
  url: string,
  localFilePath: string,
  contentType: string,
): Promise<void> {
  if (url.startsWith("file://")) {
    const { copyFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const dest = url.replace(/^file:\/\//, "");
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(localFilePath, dest);
    return;
  }

  const { readFile } = await import("node:fs/promises");
  const body = await readFile(localFilePath);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!response.ok) {
    throw new Error(`Transfer upload failed: HTTP ${response.status}`);
  }
}

export function resolvedObjectKey(
  generationId: string,
  sourceVersion: number,
  relativePath: string,
): string {
  return `${generationId}/v${sourceVersion}/resolved/${relativePath}`;
}
