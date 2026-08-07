import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveTtsProvider,
  resolveTtsVoice,
} from "./tts-provider.ts";
import {
  downloadFromTransferUrl,
  isLectureGenWorkerConfigured,
  requestLectureGenResolvedAudioList,
  requestLectureGenResolvedSceneList,
  requestLectureGenTransfer,
  resolvedObjectKey,
  uploadToTransferUrl,
} from "./lecturegen-worker-client.ts";
import { safeExtractTarGz } from "./utils/safe-tar-extract.ts";
import { getRenderStorage } from "./utils/storage/index.ts";
import { isVideoJobActive } from "./video-job-db.ts";
import { writeLectureCaptionsVtt } from "./captions-vtt.ts";
import {
  isIndexHtmlName,
  resolvedSiblingPathForIndex,
} from "./coursegen/paths.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MAX_PROCESS_OUTPUT_TAIL = 65_536;
const CALLBACK_FETCH_TIMEOUT_MS = 10_000;

const CHILD_ENV_BLOCKLIST = new Set([
  "DATABASE_URL",
  "RENDER_CALLBACK_TOKEN",
  "RENDER_WORKER_TOKEN",
  "R2_SECRET_ACCESS_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
]);

export type JobRunResult =
  | { ok: true; cancelled?: boolean }
  | { ok: false; error: string };

export type JobPhase = "preview" | "final";

export type JobRequestBody = {
  jobId?: string;
  userId?: string | null;
  phase?: JobPhase;
  storageBase?: string;
  generationId?: string;
  sourceVersion?: number;
  voice?: string;
  audioWorkers?: number;
  kokoroDevice?: string;
  chunkWorkers?: number;
  fps?: number;
  meteringOperationId?: string;
};

export type JobParams = {
  jobId: string;
  userId: string | null;
  phase: JobPhase;
  storageBase: string;
  generationId: string | null;
  sourceVersion: number | null;
  ttsProvider: string;
  voice: string;
  audioWorkers: number;
  kokoroDevice: string;
  chunkWorkers: number;
  fps: number;
  meteringOperationId: string | null;
};

type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type CallbackPayload = Record<string, unknown>;

const MAX_AUDIO_WORKERS = 8;
const MAX_CHUNK_WORKERS = 16;
const MAX_FPS = 60;

function clampPositiveInt(value: number, max: number, fallback: number): number {
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

const subprocessTimeoutMs = readEnvInt(
  "RENDER_WORKER_SUBPROCESS_TIMEOUT_MS",
  1_800_000,
);

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function childEnv(kokoroDevice: string, chunkWorkers: number): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of CHILD_ENV_BLOCKLIST) {
    delete env[key];
  }
  if (!env.GOOGLE_API_KEY && env.GEMINI_API_KEY) {
    env.GOOGLE_API_KEY = env.GEMINI_API_KEY;
  }
  env.KOKORO_DEVICE = kokoroDevice;
  env.KOKORO_CHUNK_WORKERS = String(chunkWorkers);
  return env;
}

function jobOk(cancelled = false): JobRunResult {
  return cancelled ? { ok: true, cancelled: true } : { ok: true };
}

function runProcess(
  args: string[],
  options: {
    kokoroDevice: string;
    chunkWorkers: number;
    onOutput?: (chunk: string) => void;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--import", "tsx", ...args], {
      cwd: repoRoot,
      env: childEnv(options.kokoroDevice, options.chunkWorkers),
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(error);
    };

    const appendCapturedOutput = (current: string, chunk: string) => {
      const combined = current + chunk;
      if (combined.length <= MAX_PROCESS_OUTPUT_TAIL) {
        return combined;
      }
      return combined.slice(-MAX_PROCESS_OUTPUT_TAIL);
    };

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout = appendCapturedOutput(stdout, text);
      options.onOutput?.(text);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr = appendCapturedOutput(stderr, text);
      options.onOutput?.(text);
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("close", (code) => {
      finish({ code, stdout, stderr });
    });

    if (subprocessTimeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill("SIGKILL");
        fail(
          new Error(
            `Subprocess timed out after ${subprocessTimeoutMs}ms and was terminated.`,
          ),
        );
      }, subprocessTimeoutMs);
    }
  });
}

function formatProcessFailure(label: string, result: ProcessResult): string {
  const parts = [`${label} exited with code ${result.code ?? "unknown"}`];
  if (result.stderr.trim()) {
    parts.push(`stderr:\n${result.stderr.trim()}`);
  }
  if (result.stdout.trim()) {
    parts.push(`stdout:\n${result.stdout.trim()}`);
  }
  return parts.join("\n\n");
}

function errorFromProcessResult(
  label: string,
  result: ProcessResult,
  fallback: string,
): string {
  console.error(formatProcessFailure(label, result));
  const stderr = result.stderr.trim();
  const runtimeMatch = stderr.match(/RuntimeError:\s*(.+)$/m);
  if (runtimeMatch?.[1]) {
    return sanitizeCallbackError(runtimeMatch[1].trim(), fallback);
  }
  const errorMatch = stderr.match(/Error:\s*(.+)$/m);
  if (errorMatch?.[1]) {
    return sanitizeCallbackError(errorMatch[1].trim(), fallback);
  }
  return fallback;
}

function parseDurationSeconds(stdout: string): number | null {
  const match = stdout.match(/Timeline duration:\s*([\d.]+)s/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function sanitizeCallbackError(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;
  return raw
    .replace(/[A-Za-z]:[\\/][^\s\n]+/g, "[path]")
    .replace(/\/(?:tmp|var|Users|home|app)[^\s\n]*/g, "[path]")
    .slice(0, 500)
    .trim() || fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postCallback(payload: CallbackPayload): Promise<boolean> {
  const url = process.env.WEBSITE_CALLBACK_URL?.trim();
  if (!url) {
    console.warn(
      "WEBSITE_CALLBACK_URL is not set; skipping callback for job",
      payload.jobId,
    );
    return false;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const callbackToken = process.env.RENDER_CALLBACK_TOKEN?.trim();
  if (callbackToken) {
    headers.Authorization = `Bearer ${callbackToken}`;
  }

  const body = JSON.stringify(payload);
  const backoffs = [0, 1000, 2000];

  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) {
      await sleep(backoffs[attempt]);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CALLBACK_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      if (response.ok) {
        console.log(
          `Callback delivered for job ${payload.jobId} (${payload.status})`,
        );
        return true;
      }
      console.warn(
        `Callback attempt ${attempt + 1} failed for job ${payload.jobId}: HTTP ${response.status}`,
      );
    } catch (error) {
      console.warn(
        `Callback attempt ${attempt + 1} failed for job ${payload.jobId}:`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.error(`Callback failed after retries for job ${payload.jobId}`);
  return false;
}

export async function notifyRenderJobFailed(
  jobId: string,
  phase: JobPhase,
  error: string,
  lectureGen?: { generationId: string; sourceVersion: number } | null,
  meteringOperationId?: string | null,
): Promise<void> {
  const extras =
    lectureGen?.generationId && lectureGen.sourceVersion != null
      ? {
          generationId: lectureGen.generationId,
          sourceVersion: lectureGen.sourceVersion,
          idempotencyKey: `${jobId}:${phase}:${lectureGen.sourceVersion}`,
          timestamp: new Date().toISOString(),
        }
      : {};
  await postCallback({
    jobId,
    phase,
    status: "failed",
    error: sanitizeCallbackError(error, "Render job failed"),
    ...(meteringOperationId ? { meteringOperationId } : {}),
    ...extras,
  });
}

export function resolveJobParams(body: JobRequestBody): JobParams {
  const jobId =
    typeof body.jobId === "string" && body.jobId.trim()
      ? body.jobId.trim()
      : "";
  const storageBase =
    typeof body.storageBase === "string" && body.storageBase.trim()
      ? body.storageBase.trim()
      : "";
  const phase = body.phase;

  if (!jobId) throw new Error("jobId is required");
  if (!storageBase) throw new Error("storageBase is required");
  if (phase !== "preview" && phase !== "final") {
    throw new Error('phase must be "preview" or "final"');
  }

  const ttsProvider = resolveTtsProvider(body.voice);
  const voice = resolveTtsVoice(ttsProvider, body.voice);
  const audioWorkers = clampPositiveInt(
    typeof body.audioWorkers === "number" ? body.audioWorkers : 0,
    MAX_AUDIO_WORKERS,
    1,
  );
  const kokoroDevice =
    typeof body.kokoroDevice === "string" && body.kokoroDevice.trim()
      ? body.kokoroDevice.trim()
      : process.env.KOKORO_DEVICE?.trim() || "cpu";
  const chunkWorkers = clampPositiveInt(
    typeof body.chunkWorkers === "number"
      ? body.chunkWorkers
      : readEnvInt("KOKORO_CHUNK_WORKERS", 1),
    MAX_CHUNK_WORKERS,
    readEnvInt("KOKORO_CHUNK_WORKERS", 1),
  );
  const defaultFps = phase === "preview" ? 15 : 30;
  const fps = clampPositiveInt(
    typeof body.fps === "number" ? Math.floor(body.fps) : 0,
    MAX_FPS,
    defaultFps,
  );

  return {
    jobId,
    userId: typeof body.userId === "string" ? body.userId : null,
    phase,
    storageBase,
    generationId:
      typeof body.generationId === "string" && body.generationId.trim()
        ? body.generationId.trim()
        : null,
    sourceVersion:
      typeof body.sourceVersion === "number" && Number.isInteger(body.sourceVersion)
        ? body.sourceVersion
        : null,
    ttsProvider,
    voice,
    audioWorkers,
    kokoroDevice,
    chunkWorkers,
    fps,
    meteringOperationId:
      typeof body.meteringOperationId === "string" && body.meteringOperationId.trim()
        ? body.meteringOperationId.trim()
        : null,
  };
}

export function jobParamsFromQueueRow(row: {
  videoJobId: string;
  phase: string;
  storageBase: string;
  generationId?: string | null;
  sourceVersion?: number | null;
  voice: string | null;
  audioWorkers: number;
  kokoroDevice: string;
  chunkWorkers: number;
  fps: number | null;
  meteringOperationId?: string | null;
}): JobParams {
  const phase = row.phase;
  if (phase !== "preview" && phase !== "final") {
    throw new Error(`Invalid queue phase: ${row.phase}`);
  }

  const ttsProvider = resolveTtsProvider(row.voice);

  return {
    jobId: row.videoJobId,
    userId: null,
    phase,
    storageBase: row.storageBase,
    generationId: row.generationId?.trim() || null,
    sourceVersion:
      typeof row.sourceVersion === "number" ? row.sourceVersion : null,
    ttsProvider,
    voice: resolveTtsVoice(ttsProvider, row.voice),
    audioWorkers: clampPositiveInt(row.audioWorkers, MAX_AUDIO_WORKERS, 1),
    kokoroDevice: row.kokoroDevice.trim() || "cpu",
    chunkWorkers: clampPositiveInt(
      row.chunkWorkers,
      MAX_CHUNK_WORKERS,
      readEnvInt("KOKORO_CHUNK_WORKERS", 1),
    ),
    fps: clampPositiveInt(
      row.fps ?? (phase === "preview" ? 15 : 30),
      MAX_FPS,
      phase === "preview" ? 15 : 30,
    ),
    meteringOperationId:
      typeof row.meteringOperationId === "string" && row.meteringOperationId.trim()
        ? row.meteringOperationId.trim()
        : null,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isStoredArtifactCurrent(
  artifactKey: string,
  sourceKey: string,
): Promise<boolean> {
  const storage = getRenderStorage();
  const [artifact, source] = await Promise.all([
    storage.objectHead(artifactKey),
    storage.objectHead(sourceKey),
  ]);

  if (!artifact.exists || !source.exists) {
    return false;
  }

  if (
    artifact.lastModifiedMs === null ||
    source.lastModifiedMs === null
  ) {
    return true;
  }

  return artifact.lastModifiedMs >= source.lastModifiedMs;
}

async function ensureVideoJobActive(jobId: string): Promise<boolean> {
  const active = await isVideoJobActive(jobId);
  if (!active) {
    console.log(
      `Video job ${jobId} was deleted or cancelled; stopping render work`,
    );
    return false;
  }
  return true;
}

function usesLectureGenPipeline(params: JobParams): boolean {
  return Boolean(params.generationId && params.sourceVersion);
}

function callbackExtras(params: JobParams): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (params.meteringOperationId) {
    extras.meteringOperationId = params.meteringOperationId;
  }
  if (!usesLectureGenPipeline(params)) return extras;
  return {
    ...extras,
    generationId: params.generationId,
    sourceVersion: params.sourceVersion,
    idempotencyKey: `${params.jobId}:${params.phase}:${params.sourceVersion}`,
    timestamp: new Date().toISOString(),
  };
}

async function downloadWorkspaceIntoDir(
  params: JobParams,
  destDir: string,
): Promise<void> {
  if (!usesLectureGenPipeline(params)) {
    const destPath = path.join(destDir, "index.html");
    await getRenderStorage().downloadToFile(
      `${params.storageBase}/raw.html`,
      destPath,
    );
    return;
  }

  if (!isLectureGenWorkerConfigured()) {
    throw new Error("LectureGen worker transfers are not configured");
  }

  const transfer = await requestLectureGenTransfer({
    generationId: params.generationId!,
    sourceVersion: params.sourceVersion!,
    purpose: "workspace_download",
  });
  const bundlePath = path.join(destDir, ".workspace-bundle.tar.gz");
  await downloadFromTransferUrl(transfer.url, bundlePath);
  await safeExtractTarGz(bundlePath, destDir);
  await rm(bundlePath, { force: true }).catch(() => {});
}

async function downloadSourceHtml(
  params: JobParams,
  destPath: string,
): Promise<void> {
  const workDir = path.dirname(destPath);
  await downloadWorkspaceIntoDir(params, workDir);
}

export async function listSourceScenePaths(workDir: string): Promise<string[]> {
  return (await readdir(workDir))
    .filter((name) => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(workDir, name));
}

async function uploadResolvedArtifacts(
  params: JobParams,
  resolvedHtmlPaths: string[],
  audioDir: string,
  captionsPath: string,
): Promise<void> {
  if (resolvedHtmlPaths.length === 0) {
    throw new Error("No resolved HTML scenes were produced");
  }

  if (!usesLectureGenPipeline(params)) {
    const { storageBase } = params;
    const resolvedHtmlPath = `${storageBase}/resolved/resolved.html`;
    const resolvedAudioPrefix = `${storageBase}/resolved/audio`;
    const captionsStoragePath = `${storageBase}/resolved/captions.vtt`;

    await getRenderStorage().uploadFile(
      resolvedHtmlPath,
      resolvedHtmlPaths[0],
      "text/html",
    );

    if (await fileExists(audioDir)) {
      const audioFiles = await readdir(audioDir);
      for (const name of audioFiles) {
        await getRenderStorage().uploadFile(
          `${resolvedAudioPrefix}/${name}`,
          path.join(audioDir, name),
          "audio/wav",
        );
      }
    }

    if (await fileExists(captionsPath)) {
      await getRenderStorage().uploadFile(
        captionsStoragePath,
        captionsPath,
        "text/vtt",
      );
    }
    return;
  }

  const generationId = params.generationId!;
  const sourceVersion = params.sourceVersion!;

  for (const resolvedHtml of resolvedHtmlPaths) {
    const resolvedKey = resolvedObjectKey(
      generationId,
      sourceVersion,
      path.basename(resolvedHtml),
    );
    const resolvedTransfer = await requestLectureGenTransfer({
      generationId,
      sourceVersion,
      purpose: "resolved_upload",
      objectKey: resolvedKey,
    });
    await uploadToTransferUrl(resolvedTransfer.url, resolvedHtml, "text/html");
  }

  if (await fileExists(audioDir)) {
    const audioFiles = await readdir(audioDir);
    for (const name of audioFiles) {
      const audioKey = resolvedObjectKey(
        generationId,
        sourceVersion,
        `audio/${name}`,
      );
      const transfer = await requestLectureGenTransfer({
        generationId,
        sourceVersion,
        purpose: "resolved_upload",
        objectKey: audioKey,
      });
      await uploadToTransferUrl(
        transfer.url,
        path.join(audioDir, name),
        "audio/wav",
      );
    }
  }

  if (await fileExists(captionsPath)) {
    const captionsKey = resolvedObjectKey(
      generationId,
      sourceVersion,
      "captions.vtt",
    );
    const transfer = await requestLectureGenTransfer({
      generationId,
      sourceVersion,
      purpose: "resolved_upload",
      objectKey: captionsKey,
    });
    await uploadToTransferUrl(transfer.url, captionsPath, "text/vtt");
  }
}

async function downloadResolvedHtml(
  params: JobParams,
  destPath: string,
): Promise<void> {
  if (usesLectureGenPipeline(params)) {
    const transfer = await requestLectureGenTransfer({
      generationId: params.generationId!,
      sourceVersion: params.sourceVersion!,
      purpose: "resolved_download",
      objectKey: resolvedObjectKey(
        params.generationId!,
        params.sourceVersion!,
        "resolved.html",
      ),
    });
    await downloadFromTransferUrl(transfer.url, destPath);
    return;
  }

  await getRenderStorage().downloadToFile(
    `${params.storageBase}/resolved/resolved.html`,
    destPath,
  );
}

async function downloadResolvedScenes(
  params: JobParams,
  workDir: string,
): Promise<string[]> {
  if (!usesLectureGenPipeline(params)) {
    const resolvedHtml = path.join(workDir, "resolved.html");
    await downloadResolvedHtml(params, resolvedHtml);
    return [resolvedHtml];
  }

  const objectKeys = await requestLectureGenResolvedSceneList({
    generationId: params.generationId!,
    sourceVersion: params.sourceVersion!,
  });
  if (objectKeys.length === 0) {
    throw new Error("LectureGen produced no resolved HTML scenes");
  }

  const scenePaths: string[] = [];
  for (const objectKey of objectKeys) {
    const destPath = path.join(workDir, path.basename(objectKey));
    const transfer = await requestLectureGenTransfer({
      generationId: params.generationId!,
      sourceVersion: params.sourceVersion!,
      purpose: "resolved_download",
      objectKey,
    });
    await downloadFromTransferUrl(transfer.url, destPath);
    scenePaths.push(destPath);
  }
  return scenePaths;
}

async function downloadResolvedAudio(
  params: JobParams,
  audioDir: string,
): Promise<void> {
  if (usesLectureGenPipeline(params)) {
    if (!isLectureGenWorkerConfigured()) {
      throw new Error("LectureGen worker transfers are not configured");
    }
    const objectKeys = await requestLectureGenResolvedAudioList({
      generationId: params.generationId!,
      sourceVersion: params.sourceVersion!,
    });
    if (objectKeys.length === 0) {
      return;
    }
    await mkdir(audioDir, { recursive: true });
    for (const objectKey of objectKeys) {
      const transfer = await requestLectureGenTransfer({
        generationId: params.generationId!,
        sourceVersion: params.sourceVersion!,
        purpose: "resolved_download",
        objectKey,
      });
      await downloadFromTransferUrl(
        transfer.url,
        path.join(audioDir, path.basename(objectKey)),
      );
    }
    return;
  }

  await getRenderStorage().downloadPrefixToDir(
    `${params.storageBase}/resolved/audio`,
    audioDir,
  );
}

async function processPreviewJob(
  params: JobParams,
  options?: { notifyOnFailure?: boolean },
): Promise<JobRunResult> {
  const {
    jobId,
    phase,
    storageBase,
    ttsProvider,
    voice,
    audioWorkers,
    kokoroDevice,
    chunkWorkers,
    fps,
  } = params;

  const resolvedHtmlPath = `${storageBase}/resolved/resolved.html`;
  const resolvedAudioPrefix = `${storageBase}/resolved/audio`;
  const captionsStoragePath = `${storageBase}/resolved/captions.vtt`;
  const previewVideoPath = `${storageBase}/preview.mp4`;

  const storage = getRenderStorage();
  const rawHtmlPath = `${storageBase}/raw.html`;
  if (!(await ensureVideoJobActive(jobId))) {
    return jobOk(true);
  }
  if (
    !usesLectureGenPipeline(params) &&
    (await isStoredArtifactCurrent(previewVideoPath, rawHtmlPath))
  ) {
    console.log(
      `Preview artifacts already exist for job ${jobId}; sending callback only`,
    );
    if (!(await ensureVideoJobActive(jobId))) {
      return jobOk(true);
    }
    const paths: Record<string, string> = usesLectureGenPipeline(params)
      ? { previewVideoPath }
      : {
          resolvedHtmlPath,
          resolvedAudioPrefix,
          previewVideoPath,
        };
    if (await storage.objectExists(captionsStoragePath)) {
      paths.captionsPath = captionsStoragePath;
    }
    const delivered = await postCallback({
      jobId,
      phase,
      status: "preview_ready",
      paths,
      ...callbackExtras(params),
    });
    return delivered
      ? jobOk()
      : { ok: false, error: "Could not notify website after preview completed" };
  }

  let workDir: string | null = null;

  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), "mylecture-job-"));
    const sourceHtml = path.join(workDir, "index.html");
    const previewMp4 = path.join(workDir, "preview.mp4");
    const audioDir = path.join(workDir, "audio");
    const captionsPath = path.join(workDir, "captions.vtt");

    await downloadSourceHtml(params, sourceHtml);

    const sourceScenePaths = await listSourceScenePaths(workDir);
    if (sourceScenePaths.length === 0) {
      throw new Error("Downloaded workspace contains no index*.html scenes");
    }

    const resolvedHtmlPaths: string[] = [];
    for (const sourceScenePath of sourceScenePaths) {
      const resolvedScenePath = resolvedSiblingPathForIndex(sourceScenePath);
      const buildResult = await runProcess(
        [
          "src/build-plan.ts",
          "--input",
          sourceScenePath,
          "--out",
          resolvedScenePath,
          "--provider",
          ttsProvider,
          "--audio-workers",
          String(audioWorkers),
          "--voice",
          voice,
        ],
        { kokoroDevice, chunkWorkers },
      );
      if (buildResult.code !== 0) {
        return {
          ok: false,
          error: errorFromProcessResult(
            `build:plan (${path.basename(sourceScenePath)})`,
            buildResult,
            `Build plan failed for ${path.basename(sourceScenePath)}`,
          ),
        };
      }
      resolvedHtmlPaths.push(resolvedScenePath);
    }

    writeLectureCaptionsVtt(workDir);

    if (!(await ensureVideoJobActive(jobId))) {
      return jobOk(true);
    }

    await postCallback({
      jobId,
      phase,
      status: "rendering_preview",
      ...callbackExtras(params),
    });

    if (!(await ensureVideoJobActive(jobId))) {
      return jobOk(true);
    }

    const renderResult = await runProcess(
      [
        "src/render-lecture.ts",
        "--dir",
        workDir,
        "--out",
        previewMp4,
        "--max-short-edge",
        "480",
        "--fps",
        String(fps),
      ],
      { kokoroDevice, chunkWorkers },
    );
    if (renderResult.code !== 0) {
      return {
        ok: false,
        error: errorFromProcessResult(
          "render:video",
          renderResult,
          "Preview render failed",
        ),
      };
    }

    if (!(await ensureVideoJobActive(jobId))) {
      return jobOk(true);
    }

    await uploadResolvedArtifacts(
      params,
      resolvedHtmlPaths,
      audioDir,
      captionsPath,
    );

    if (usesLectureGenPipeline(params) && (await fileExists(captionsPath))) {
      await getRenderStorage().uploadFile(
        captionsStoragePath,
        captionsPath,
        "text/vtt",
      );
    }

    await getRenderStorage().uploadFile(previewVideoPath, previewMp4, "video/mp4");

    const durationSeconds = parseDurationSeconds(renderResult.stdout);
    const callbackPaths: Record<string, string> = {
      previewVideoPath,
    };
    if (!usesLectureGenPipeline(params)) {
      callbackPaths.resolvedHtmlPath = resolvedHtmlPath;
      callbackPaths.resolvedAudioPrefix = resolvedAudioPrefix;
    }
    if (await fileExists(captionsPath)) {
      callbackPaths.captionsPath = captionsStoragePath;
    }
    const callbackPayload: CallbackPayload = {
      jobId,
      phase,
      status: "preview_ready",
      paths: callbackPaths,
      ...callbackExtras(params),
    };
    if (durationSeconds !== null) {
      callbackPayload.durationSeconds = durationSeconds;
    }
    const delivered = await postCallback(callbackPayload);
    return delivered
      ? jobOk()
      : { ok: false, error: "Could not notify website after preview completed" };
  } catch (error) {
    console.error(`Preview job ${jobId} failed:`, error);
    if (!(await isVideoJobActive(jobId))) {
      return jobOk(true);
    }
    const message = sanitizeCallbackError(error, "Preview job failed");
    if (options?.notifyOnFailure !== false) {
      await postCallback({
        jobId,
        phase,
        status: "failed",
        error: message,
        ...callbackExtras(params),
      });
    }
    return { ok: false, error: message };
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function processFinalJob(
  params: JobParams,
  options?: { notifyOnFailure?: boolean },
): Promise<JobRunResult> {
  const { jobId, phase, storageBase, voice, kokoroDevice, chunkWorkers, fps } =
    params;

  const finalVideoPath = `${storageBase}/final.mp4`;
  const resolvedSourcePath = `${storageBase}/resolved/resolved.html`;
  if (!(await ensureVideoJobActive(jobId))) {
    return jobOk(true);
  }
  if (
    !usesLectureGenPipeline(params) &&
    (await isStoredArtifactCurrent(finalVideoPath, resolvedSourcePath))
  ) {
    console.log(
      `Final video already exists for job ${jobId}; sending callback only`,
    );
    const delivered = await postCallback({
      jobId,
      phase,
      status: "ready",
      paths: { finalVideoPath },
      ...callbackExtras(params),
    });
    return delivered
      ? jobOk()
      : { ok: false, error: "Could not notify website after final render completed" };
  }

  let workDir: string | null = null;

  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), "mylecture-job-"));
    const audioDir = path.join(workDir, "audio");
    const captionsPath = path.join(workDir, "captions.vtt");
    const finalMp4 = path.join(workDir, "final.mp4");

    await downloadResolvedScenes(params, workDir);
    await downloadResolvedAudio(params, audioDir);
    await downloadWorkspaceIntoDir(params, workDir);

    try {
      await getRenderStorage().downloadToFile(
        `${storageBase}/resolved/captions.vtt`,
        captionsPath,
      );
    } catch {
      // Captions are optional for final render.
    }

    if (!(await ensureVideoJobActive(jobId))) {
      return jobOk(true);
    }

    const renderResult = await runProcess(
      [
        "src/render-lecture.ts",
        "--dir",
        workDir,
        "--out",
        finalMp4,
        "--fps",
        String(fps),
      ],
      { kokoroDevice, chunkWorkers },
    );
    if (renderResult.code !== 0) {
      return {
        ok: false,
        error: errorFromProcessResult(
          "render:video",
          renderResult,
          "Final render failed",
        ),
      };
    }

    if (!(await ensureVideoJobActive(jobId))) {
      return jobOk(true);
    }

    await getRenderStorage().uploadFile(finalVideoPath, finalMp4, "video/mp4");

    const durationSeconds = parseDurationSeconds(renderResult.stdout);
    const callbackPayload: CallbackPayload = {
      jobId,
      phase,
      status: "ready",
      paths: { finalVideoPath },
      ...callbackExtras(params),
    };
    if (durationSeconds !== null) {
      callbackPayload.durationSeconds = durationSeconds;
    }
    const delivered = await postCallback(callbackPayload);
    return delivered
      ? jobOk()
      : { ok: false, error: "Could not notify website after final render completed" };
  } catch (error) {
    console.error(`Final job ${jobId} failed:`, error);
    if (!(await isVideoJobActive(jobId))) {
      return jobOk(true);
    }
    const message = sanitizeCallbackError(error, "Final job failed");
    if (options?.notifyOnFailure !== false) {
      await postCallback({
        jobId,
        phase,
        status: "failed",
        error: message,
        ...callbackExtras(params),
      });
    }
    return { ok: false, error: message };
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function runJob(
  params: JobParams,
  options?: { notifyOnFailure?: boolean },
): Promise<JobRunResult> {
  if (params.phase === "preview") {
    return processPreviewJob(params, options);
  }
  return processFinalJob(params, options);
}
