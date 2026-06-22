/**
 * render-server.ts
 *
 * Standalone HTTP worker that wraps build:plan and render:video for remote
 * offloading from the website.
 */
import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderMultipart } from "./utils/render-multipart.ts";
import {
  downloadPrefixToDir,
  downloadToFile,
  isStorageConfigured,
  uploadFile,
} from "./utils/supabase-storage.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_PORT = 8787;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_TAIL = 65_536;

type RenderRequestBody = {
  sourceHtml?: string;
  voice?: string;
  audioWorkers?: number;
  kokoroDevice?: string;
  chunkWorkers?: number;
};

type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type JobPhase = "preview" | "final";

type JobRequestBody = {
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

type JobParams = {
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

type CallbackPayload = Record<string, unknown>;

const maxConcurrency = readEnvInt("RENDER_WORKER_MAX_CONCURRENCY", 1);
let activeJobs = 0;
const pendingJobs: Array<() => Promise<void>> = [];

function scheduleJob(task: () => Promise<void>): void {
  pendingJobs.push(task);
  drainJobQueue();
}

function drainJobQueue(): void {
  while (activeJobs < maxConcurrency && pendingJobs.length > 0) {
    const task = pendingJobs.shift()!;
    activeJobs++;
    void (async () => {
      try {
        await task();
      } finally {
        activeJobs--;
        drainJobQueue();
      }
    })();
  }
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const port = readEnvInt("PORT", DEFAULT_PORT);
const maxBodyBytes = readEnvInt(
  "RENDER_WORKER_MAX_BODY_BYTES",
  DEFAULT_MAX_BODY_BYTES,
);
const workerToken = process.env.RENDER_WORKER_TOKEN?.trim() || "";

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!workerToken) return true;

  const header = req.headers.authorization?.trim() ?? "";
  const expected = `Bearer ${workerToken}`;
  if (header !== expected) {
    sendJson(res, 401, { error: "Unauthorized" });
    return false;
  }
  return true;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
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
      reject(error);
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
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

async function postCallback(payload: CallbackPayload): Promise<void> {
  const url = process.env.WEBSITE_CALLBACK_URL?.trim();
  if (!url) {
    console.warn(
      "WEBSITE_CALLBACK_URL is not set; skipping callback for job",
      payload.jobId,
    );
    return;
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

    try {
      const response = await fetch(url, { method: "POST", headers, body });
      if (response.ok) {
        console.log(
          `Callback delivered for job ${payload.jobId} (${payload.status})`,
        );
        return;
      }
      console.warn(
        `Callback attempt ${attempt + 1} failed for job ${payload.jobId}: HTTP ${response.status}`,
      );
    } catch (error) {
      console.warn(
        `Callback attempt ${attempt + 1} failed for job ${payload.jobId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.error(`Callback failed after retries for job ${payload.jobId}`);
}

function parseJobBody(raw: Buffer): JobRequestBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf-8"));
  } catch {
    throw new Error("Invalid JSON body");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  return parsed as JobRequestBody;
}

function resolveJobParams(body: JobRequestBody): JobParams {
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

  const voice =
    typeof body.voice === "string" && body.voice.trim()
      ? body.voice.trim()
      : "af_heart";
  const audioWorkers =
    typeof body.audioWorkers === "number" &&
    Number.isInteger(body.audioWorkers) &&
    body.audioWorkers > 0
      ? body.audioWorkers
      : 1;
  const kokoroDevice =
    typeof body.kokoroDevice === "string" && body.kokoroDevice.trim()
      ? body.kokoroDevice.trim()
      : process.env.KOKORO_DEVICE?.trim() || "cpu";
  const chunkWorkers =
    typeof body.chunkWorkers === "number" &&
    Number.isInteger(body.chunkWorkers) &&
    body.chunkWorkers > 0
      ? body.chunkWorkers
      : readEnvInt("KOKORO_CHUNK_WORKERS", 1);
  const defaultFps = phase === "preview" ? 15 : 30;
  const fps =
    typeof body.fps === "number" &&
    Number.isFinite(body.fps) &&
    body.fps > 0
      ? body.fps
      : defaultFps;

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function processPreviewJob(params: JobParams): Promise<void> {
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

  let workDir: string | null = null;

  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), "mylecture-job-"));
    const sourceHtml = path.join(workDir, "index.html");
    const resolvedHtml = path.join(workDir, "resolved.html");
    const previewMp4 = path.join(workDir, "preview.mp4");
    const audioDir = path.join(workDir, "audio");
    const captionsPath = path.join(workDir, "captions.vtt");

    await downloadToFile(`${storageBase}/raw.html`, sourceHtml);

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

    const renderResult = await runProcess(
      [
        "src/render-video.ts",
        "--html",
        resolvedHtml,
        "--out",
        previewMp4,
        "--no-auto-build",
        "--tts-voice",
        voice,
        "--max-short-edge",
        "480",
        "--fps",
        String(fps),
      ],
      { kokoroDevice, chunkWorkers },
    );
    if (renderResult.code !== 0) {
      console.error(formatProcessFailure("render:video", renderResult));
      throw new Error("Preview render failed");
    }

    const resolvedHtmlPath = `${storageBase}/resolved/resolved.html`;
    const resolvedAudioPrefix = `${storageBase}/resolved/audio`;
    const captionsStoragePath = `${storageBase}/resolved/captions.vtt`;
    const previewVideoPath = `${storageBase}/preview.mp4`;

    await uploadFile(resolvedHtmlPath, resolvedHtml, "text/html");

    if (await fileExists(audioDir)) {
      const audioFiles = await readdir(audioDir);
      for (const name of audioFiles) {
        await uploadFile(
          `${resolvedAudioPrefix}/${name}`,
          path.join(audioDir, name),
          "audio/wav",
        );
      }
    }

    if (await fileExists(captionsPath)) {
      await uploadFile(captionsStoragePath, captionsPath, "text/vtt");
    }

    await uploadFile(previewVideoPath, previewMp4, "video/mp4");

    const durationSeconds = parseDurationSeconds(renderResult.stdout);
    const callbackPayload: CallbackPayload = {
      jobId,
      phase,
      status: "preview_ready",
      paths: {
        resolvedHtmlPath,
        resolvedAudioPrefix,
        captionsPath: captionsStoragePath,
        previewVideoPath,
      },
    };
    if (durationSeconds !== null) {
      callbackPayload.durationSeconds = durationSeconds;
    }
    await postCallback(callbackPayload);
  } catch (error) {
    console.error(`Preview job ${jobId} failed:`, error);
    await postCallback({
      jobId,
      phase,
      status: "failed",
      error: sanitizeCallbackError(error, "Preview job failed"),
    });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function processFinalJob(params: JobParams): Promise<void> {
  const { jobId, phase, storageBase, voice, kokoroDevice, chunkWorkers, fps } =
    params;

  let workDir: string | null = null;

  try {
    workDir = await mkdtemp(path.join(os.tmpdir(), "mylecture-job-"));
    const resolvedHtml = path.join(workDir, "resolved.html");
    const audioDir = path.join(workDir, "audio");
    const captionsPath = path.join(workDir, "captions.vtt");
    const finalMp4 = path.join(workDir, "final.mp4");

    await downloadToFile(`${storageBase}/resolved/resolved.html`, resolvedHtml);
    await downloadPrefixToDir(`${storageBase}/resolved/audio`, audioDir);

    try {
      await downloadToFile(
        `${storageBase}/resolved/captions.vtt`,
        captionsPath,
      );
    } catch {
      // Captions are optional for final render.
    }

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
      ],
      { kokoroDevice, chunkWorkers },
    );
    if (renderResult.code !== 0) {
      console.error(formatProcessFailure("render:video", renderResult));
      throw new Error("Final render failed");
    }

    const finalVideoPath = `${storageBase}/final.mp4`;
    await uploadFile(finalVideoPath, finalMp4, "video/mp4");

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
    await postCallback(callbackPayload);
  } catch (error) {
    console.error(`Final job ${jobId} failed:`, error);
    await postCallback({
      jobId,
      phase,
      status: "failed",
      error: sanitizeCallbackError(error, "Final job failed"),
    });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function runJob(params: JobParams): Promise<void> {
  if (params.phase === "preview") {
    await processPreviewJob(params);
  } else {
    await processFinalJob(params);
  }
}

async function handleJobs(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  try {
    if (!isStorageConfigured()) {
      sendJson(res, 500, {
        error:
          "Supabase storage is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required)",
      });
      return;
    }

    const rawBody = await readRequestBody(req);
    const body = parseJobBody(rawBody);
    let params: JobParams;

    try {
      params = resolveJobParams(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid job request";
      sendJson(res, 400, { error: message });
      return;
    }

    sendJson(res, 202, { accepted: true });

    scheduleJob(() => runJob(params));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Job request failed";
    sendJson(res, 500, { error: message });
  }
}

function parseRenderBody(raw: Buffer): RenderRequestBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf-8"));
  } catch {
    throw new Error("Invalid JSON body");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  return parsed as RenderRequestBody;
}

async function handleRender(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  let workDir: string | null = null;

  try {
    const rawBody = await readRequestBody(req);
    const body = parseRenderBody(rawBody);

    if (typeof body.sourceHtml !== "string" || body.sourceHtml.length === 0) {
      sendJson(res, 400, { error: "sourceHtml is required" });
      return;
    }

    const voice =
      typeof body.voice === "string" && body.voice.trim()
        ? body.voice.trim()
        : "af_heart";
    const audioWorkers =
      typeof body.audioWorkers === "number" &&
      Number.isInteger(body.audioWorkers) &&
      body.audioWorkers > 0
        ? body.audioWorkers
        : 1;
    const kokoroDevice =
      typeof body.kokoroDevice === "string" && body.kokoroDevice.trim()
        ? body.kokoroDevice.trim()
        : process.env.KOKORO_DEVICE?.trim() || "cpu";
    const chunkWorkers =
      typeof body.chunkWorkers === "number" &&
      Number.isInteger(body.chunkWorkers) &&
      body.chunkWorkers > 0
        ? body.chunkWorkers
        : readEnvInt("KOKORO_CHUNK_WORKERS", 1);

    workDir = await mkdtemp(path.join(os.tmpdir(), "mylecture-render-"));
    const sourceHtml = path.join(workDir, "index.html");
    const resolvedHtml = path.join(workDir, "resolved.html");
    const renderedMp4 = path.join(workDir, "rendered.mp4");

    await writeFile(sourceHtml, body.sourceHtml, "utf-8");

    const buildPlanArgs = [
      "src/build-plan.ts",
      "--input",
      sourceHtml,
      "--out",
      resolvedHtml,
      "--audio-workers",
      String(audioWorkers),
      "--voice",
      voice,
    ];

    const buildResult = await runProcess(buildPlanArgs, {
      kokoroDevice,
      chunkWorkers,
    });
    if (buildResult.code !== 0) {
      sendJson(res, 500, {
        error: formatProcessFailure("build:plan", buildResult),
      });
      return;
    }

    const renderArgs = [
      "src/render-video.ts",
      "--html",
      resolvedHtml,
      "--out",
      renderedMp4,
      "--no-auto-build",
      "--tts-voice",
      voice,
    ];

    const renderResult = await runProcess(renderArgs, {
      kokoroDevice,
      chunkWorkers,
    });
    if (renderResult.code !== 0) {
      sendJson(res, 500, {
        error: formatProcessFailure("render:video", renderResult),
      });
      return;
    }

    const mp4Bytes = await readFile(renderedMp4);

    let vttText = "WEBVTT\n";
    try {
      vttText = await readFile(path.join(workDir, "captions.vtt"), "utf-8");
    } catch {
      // Fall back to empty WebVTT if captions file is missing.
    }

    const { contentType, body: multipartBody } = buildRenderMultipart(
      mp4Bytes,
      vttText,
    );
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": multipartBody.length,
    });
    res.end(multipartBody);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Render request failed";
    sendJson(res, 500, { error: message });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup.
      });
    }
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/render") {
    void handleRender(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/jobs") {
    void handleJobs(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(port, () => {
  console.log(`Render worker listening on port ${port}`);
});
