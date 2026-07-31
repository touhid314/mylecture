import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRenderVoice } from "./voice-allowlist.ts";
import { getRenderStorage } from "./utils/storage/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MAX_PROCESS_OUTPUT_TAIL = 65_536;
const CALLBACK_FETCH_TIMEOUT_MS = 10_000;

export type JobPhase = "preview" | "final";

export type JobRequestBody = {
  jobId?: string;
  userId?: string | null;
  phase?: JobPhase;
  storageBase?: string;
  voice?: string;
  audioWorkers?: number;
  kokoroDevice?: string;
  chunkWorkers?: number;
  fps?: number;
};

export type JobParams = {
  jobId: string;
  userId: string | null;
  phase: JobPhase;
  storageBase: string;
  voice: string;
  audioWorkers: number;
  kokoroDevice: string;
  chunkWorkers: number;
  fps: number;
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
  if (!env.GOOGLE_API_KEY && env.GEMINI_API_KEY) {
    env.GOOGLE_API_KEY = env.GEMINI_API_KEY;
  }
  env.KOKORO_DEVICE = kokoroDevice;
  env.KOKORO_CHUNK_WORKERS = String(chunkWorkers);
  return env;
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

function parseDurationSeconds(stdout: string): number | null {
  const match = stdout.match(/Timeline duration:\s*([\d.]+)s/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function sanitizeCallbackError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
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
): Promise<void> {
  await postCallback({
    jobId,
    phase,
    status: "failed",
    error: sanitizeCallbackError(error, "Render job failed"),
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

  const voice = resolveRenderVoice(body.voice);
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
    voice,
    audioWorkers,
    kokoroDevice,
    chunkWorkers,
    fps,
  };
}

export function jobParamsFromQueueRow(row: {
  videoJobId: string;
  phase: string;
  storageBase: string;
  voice: string | null;
  audioWorkers: number;
  kokoroDevice: string;
  chunkWorkers: number;
  fps: number | null;
}): JobParams {
  const phase = row.phase;
  if (phase !== "preview" && phase !== "final") {
    throw new Error(`Invalid queue phase: ${row.phase}`);
  }

  return {
    jobId: row.videoJobId,
    userId: null,
    phase,
    storageBase: row.storageBase,
    voice: resolveRenderVoice(row.voice),
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

async function processPreviewJob(
  params: JobParams,
  options?: { notifyOnFailure?: boolean },
): Promise<boolean> {
  const {
    jobId,
    phase,
    storageBase,
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
  if (await isStoredArtifactCurrent(previewVideoPath, rawHtmlPath)) {
    console.log(
      `Preview artifacts already exist for job ${jobId}; sending callback only`,
    );
    const paths: Record<string, string> = {
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
    });
    return delivered;
  }

  let workDir: string | null = null;

  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), "mylecture-job-"));
    const sourceHtml = path.join(workDir, "index.html");
    const resolvedHtml = path.join(workDir, "resolved.html");
    const previewMp4 = path.join(workDir, "preview.mp4");
    const audioDir = path.join(workDir, "audio");
    const captionsPath = path.join(workDir, "captions.vtt");

    await getRenderStorage().downloadToFile(`${storageBase}/raw.html`, sourceHtml);

    const buildResult = await runProcess(
      [
        "src/build-plan.ts",
        "--input",
        sourceHtml,
        "--out",
        resolvedHtml,
        "--audio-workers",
        String(audioWorkers),
        "--voice",
        voice,
      ],
      { kokoroDevice, chunkWorkers },
    );
    if (buildResult.code !== 0) {
      console.error(formatProcessFailure("build:plan", buildResult));
      throw new Error("Build plan failed");
    }

    await postCallback({
      jobId,
      phase,
      status: "rendering_preview",
    });

    const previewFramesDir = path.join(workDir, "frames");
    const renderResult = await runProcess(
      [
        "src/render-video.ts",
        "--html",
        resolvedHtml,
        "--out",
        previewMp4,
        "--no-auto-build",
        "--no-auto-viewport",
        "--tts-voice",
        voice,
        "--width",
        "854",
        "--height",
        "480",
        "--fps",
        String(fps),
        "--frames-dir",
        previewFramesDir,
      ],
      { kokoroDevice, chunkWorkers },
    );
    if (renderResult.code !== 0) {
      console.error(formatProcessFailure("render:video", renderResult));
      throw new Error("Preview render failed");
    }

    await getRenderStorage().uploadFile(resolvedHtmlPath, resolvedHtml, "text/html");

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

    let captionsUploaded = false;
    if (await fileExists(captionsPath)) {
      await getRenderStorage().uploadFile(captionsStoragePath, captionsPath, "text/vtt");
      captionsUploaded = true;
    }

    await getRenderStorage().uploadFile(previewVideoPath, previewMp4, "video/mp4");

    const durationSeconds = parseDurationSeconds(renderResult.stdout);
    const callbackPaths: Record<string, string> = {
      resolvedHtmlPath,
      resolvedAudioPrefix,
      previewVideoPath,
    };
    if (captionsUploaded) {
      callbackPaths.captionsPath = captionsStoragePath;
    }
    const callbackPayload: CallbackPayload = {
      jobId,
      phase,
      status: "preview_ready",
      paths: callbackPaths,
    };
    if (durationSeconds !== null) {
      callbackPayload.durationSeconds = durationSeconds;
    }
    const delivered = await postCallback(callbackPayload);
    return delivered;
  } catch (error) {
    console.error(`Preview job ${jobId} failed:`, error);
    if (options?.notifyOnFailure !== false) {
      await postCallback({
        jobId,
        phase,
        status: "failed",
        error: sanitizeCallbackError(error, "Preview job failed"),
      });
    }
    return false;
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function processFinalJob(
  params: JobParams,
  options?: { notifyOnFailure?: boolean },
): Promise<boolean> {
  const { jobId, phase, storageBase, voice, kokoroDevice, chunkWorkers, fps } =
    params;

  const finalVideoPath = `${storageBase}/final.mp4`;
  const resolvedSourcePath = `${storageBase}/resolved/resolved.html`;
  if (await isStoredArtifactCurrent(finalVideoPath, resolvedSourcePath)) {
    console.log(
      `Final video already exists for job ${jobId}; sending callback only`,
    );
    const delivered = await postCallback({
      jobId,
      phase,
      status: "ready",
      paths: { finalVideoPath },
    });
    return delivered;
  }

  let workDir: string | null = null;

  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), "mylecture-job-"));
    const resolvedHtml = path.join(workDir, "resolved.html");
    const audioDir = path.join(workDir, "audio");
    const captionsPath = path.join(workDir, "captions.vtt");
    const finalMp4 = path.join(workDir, "final.mp4");

    await getRenderStorage().downloadToFile(`${storageBase}/resolved/resolved.html`, resolvedHtml);
    await getRenderStorage().downloadPrefixToDir(`${storageBase}/resolved/audio`, audioDir);

    try {
      await getRenderStorage().downloadToFile(
        `${storageBase}/resolved/captions.vtt`,
        captionsPath,
      );
    } catch {
      // Captions are optional for final render.
    }

    const finalFramesDir = path.join(workDir, "frames");
    const renderResult = await runProcess(
      [
        "src/render-video.ts",
        "--html",
        resolvedHtml,
        "--out",
        finalMp4,
        "--no-auto-build",
        "--tts-voice",
        voice,
        "--fps",
        String(fps),
        "--frames-dir",
        finalFramesDir,
      ],
      { kokoroDevice, chunkWorkers },
    );
    if (renderResult.code !== 0) {
      console.error(formatProcessFailure("render:video", renderResult));
      throw new Error("Final render failed");
    }

    await getRenderStorage().uploadFile(finalVideoPath, finalMp4, "video/mp4");

    const durationSeconds = parseDurationSeconds(renderResult.stdout);
    const callbackPayload: CallbackPayload = {
      jobId,
      phase,
      status: "ready",
      paths: { finalVideoPath },
    };
    if (durationSeconds !== null) {
      callbackPayload.durationSeconds = durationSeconds;
    }
    const delivered = await postCallback(callbackPayload);
    return delivered;
  } catch (error) {
    console.error(`Final job ${jobId} failed:`, error);
    if (options?.notifyOnFailure !== false) {
      await postCallback({
        jobId,
        phase,
        status: "failed",
        error: sanitizeCallbackError(error, "Final job failed"),
      });
    }
    return false;
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function runJob(
  params: JobParams,
  options?: { notifyOnFailure?: boolean },
): Promise<boolean> {
  if (params.phase === "preview") {
    return processPreviewJob(params, options);
  }
  return processFinalJob(params, options);
}
