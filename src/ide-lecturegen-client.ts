import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LectureGenerationResult } from "../packages/lecture-agent/src/lecturegen.ts";
import { safeExtractTarGz } from "./utils/safe-tar-extract.ts";

function lectureGenUrl(): string {
  const base = process.env.LECTUREGEN_URL?.trim();
  if (!base) throw new Error("LECTUREGEN_URL is not configured");
  return base.replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  const token =
    process.env.LECTUREGEN_IDE_TOKEN?.trim() ||
    process.env.LECTUREGEN_SERVICE_TOKEN?.trim();
  if (!token) {
    throw new Error("LECTUREGEN_IDE_TOKEN or LECTUREGEN_SERVICE_TOKEN is not configured");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function ideHeaders(): HeadersInit {
  const token = process.env.LECTUREGEN_IDE_TOKEN?.trim();
  if (!token) throw new Error("LECTUREGEN_IDE_TOKEN is not configured");
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function isIdeLectureGenRemoteEnabled(): boolean {
  return Boolean(
    process.env.LECTUREGEN_URL?.trim() && process.env.LECTUREGEN_IDE_TOKEN?.trim(),
  );
}

async function mapAttachmentPaths(
  attachmentPaths?: string[],
): Promise<
  Array<{ filename: string; mimeType: string; kind: string; dataBase64: string }> | undefined
> {
  if (!attachmentPaths?.length) return undefined;
  const mapped = await Promise.all(
    attachmentPaths.map(async (filePath) => ({
      filename: path.basename(filePath),
      mimeType: "application/octet-stream",
      kind: "file",
      dataBase64: (await readFile(filePath)).toString("base64"),
    })),
  );
  return mapped;
}

export async function generateLectureViaRemoteService(opts: {
  request: string;
  model: string;
  scriptModel?: string;
  animatorModel?: string;
  workspaceDir: string;
  aspectRatio?: string;
  theme?: string;
  teachingStyle?: string;
  targetSeconds?: number;
  generationLength?: string;
  attachments?: string[];
  includeVideo?: boolean;
  includeInteractive?: boolean;
  includeGame?: boolean;
  enableGetimg?: boolean;
  onLog?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<LectureGenerationResult> {
  const createResponse = await fetch(`${lectureGenUrl()}/v1/jobs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      prompt: opts.request,
      model: opts.model,
      scriptModel: opts.scriptModel,
      animatorModel: opts.animatorModel,
      targetSeconds: opts.targetSeconds,
      generationLength: opts.generationLength,
      aspectRatio: opts.aspectRatio,
      theme: opts.theme,
      teachingStyle: opts.teachingStyle,
      includeVideo: opts.includeVideo,
      includeInteractive: opts.includeInteractive,
      includeGame: opts.includeGame,
      enableGetimg: opts.enableGetimg,
      attachments: await mapAttachmentPaths(opts.attachments),
    }),
    signal: opts.signal,
  });

  if (!createResponse.ok) {
    throw new Error(`LectureGen create failed (${createResponse.status})`);
  }

  const created = (await createResponse.json()) as {
    generationId: string;
    sourceVersion: number;
  };

  const started = Date.now();
  while (Date.now() - started < 3_600_000) {
    if (opts.signal?.aborted) {
      throw new Error("Generation cancelled");
    }

    const statusResponse = await fetch(
      `${lectureGenUrl()}/v1/jobs/${created.generationId}`,
      { headers: authHeaders(), signal: opts.signal },
    );
    if (!statusResponse.ok) {
      throw new Error(`LectureGen status failed (${statusResponse.status})`);
    }

    const status = (await statusResponse.json()) as {
      status: string;
      error: string | null;
      logs: string[];
    };

    for (const line of status.logs.slice(-3)) {
      opts.onLog?.(`${line}\n`);
    }

    if (status.status === "source_ready") break;
    if (status.status === "failed") {
      throw new Error(status.error || "LectureGen generation failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const bundleDir = await mkdtemp(path.join(os.tmpdir(), "ide-lecturegen-bundle-"));
  const bundlePath = path.join(bundleDir, "source.tar.gz");

  try {
    const bundleResponse = await fetch(
      `${lectureGenUrl()}/v1/jobs/${created.generationId}/source-bundle`,
      { headers: ideHeaders(), signal: opts.signal },
    );
    if (!bundleResponse.ok) {
      throw new Error(`LectureGen source bundle failed (${bundleResponse.status})`);
    }

    const bytes = Buffer.from(await bundleResponse.arrayBuffer());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(bundlePath, bytes);
    await safeExtractTarGz(bundlePath, opts.workspaceDir);

    void fetch(`${lectureGenUrl()}/v1/jobs/${created.generationId}`, {
      method: "DELETE",
      headers: ideHeaders(),
    }).catch((error) => {
      console.warn(
        `LectureGen cleanup DELETE failed for ${created.generationId}:`,
        error,
      );
    });

    const indexPath = path.join(opts.workspaceDir, "index.html");
    const interactivePath = path.join(opts.workspaceDir, "interactive.html");
    const gamePath = path.join(opts.workspaceDir, "game.html");
    const { access } = await import("node:fs/promises");

    const hasIndex = await access(indexPath).then(() => true).catch(() => false);
    const hasInteractive = await access(interactivePath).then(() => true).catch(() => false);
    const hasGame = await access(gamePath).then(() => true).catch(() => false);

    const videoFiles = hasIndex ? [indexPath] : [];
    const htmlFiles = [
      ...videoFiles,
      ...(hasInteractive ? [interactivePath] : []),
      ...(hasGame ? [gamePath] : []),
    ];
    const entryFile = videoFiles[0] || (hasInteractive ? interactivePath : hasGame ? gamePath : indexPath);

    return {
      id: created.generationId,
      workspaceDir: opts.workspaceDir,
      entryFile,
      htmlFiles,
      videoFiles,
      interactiveFile: hasInteractive ? interactivePath : undefined,
      gameFile: hasGame ? gamePath : undefined,
      output: "Generated via remote LectureGen service.",
    };
  } finally {
    await rm(bundleDir, { recursive: true, force: true }).catch(() => {});
  }
}
