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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderMultipart } from "./utils/render-multipart.ts";
import { isStorageConfigured } from "./utils/storage/index.ts";
import { resolveRenderVoice } from "./voice-allowlist.ts";
import {
  resolveJobParams,
  runJob,
  type JobRequestBody,
} from "./render-job.ts";
import {
  isHttpJobsEnabled,
  startRenderQueueWorker,
} from "./render-queue-worker.ts";

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

const maxConcurrency = readEnvInt("RENDER_WORKER_MAX_CONCURRENCY", 1);
const subprocessTimeoutMs = readEnvInt(
  "RENDER_WORKER_SUBPROCESS_TIMEOUT_MS",
  1_800_000,
);
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
const requireWorkerAuth =
  process.env.NODE_ENV === "production" ||
  process.env.RENDER_REQUIRE_AUTH === "1";
const workerToken = process.env.RENDER_WORKER_TOKEN?.trim() || "";
const workerAuthMisconfigured = requireWorkerAuth && !workerToken;

if (workerAuthMisconfigured) {
  console.error(
    "RENDER_WORKER_TOKEN is required when NODE_ENV=production or RENDER_REQUIRE_AUTH=1 but is not set.",
  );
}

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
  if (workerAuthMisconfigured) {
    sendJson(res, 503, {
      error: "Render worker authentication is not configured.",
    });
    return false;
  }

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

async function handleJobs(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  try {
    if (!isStorageConfigured()) {
      sendJson(res, 500, {
        error:
          "Storage is not configured (SUPABASE_URL/R2 vars required)",
      });
      return;
    }

    const rawBody = await readRequestBody(req);
    const body = parseJobBody(rawBody);
    let params;

    try {
      params = resolveJobParams(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid job request";
      sendJson(res, 400, { error: message });
      return;
    }

    sendJson(res, 202, { accepted: true });

    if (!isHttpJobsEnabled()) {
      console.log(
        `Accepted HTTP job ${params.jobId} (${params.phase}); queue worker will process it`,
      );
      return;
    }

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

    const voice = resolveRenderVoice(body.voice);
    const audioWorkers =
      typeof body.audioWorkers === "number" &&
      Number.isInteger(body.audioWorkers) &&
      body.audioWorkers > 0
        ? Math.min(body.audioWorkers, 8)
        : 1;
    const kokoroDevice =
      typeof body.kokoroDevice === "string" && body.kokoroDevice.trim()
        ? body.kokoroDevice.trim()
        : process.env.KOKORO_DEVICE?.trim() || "cpu";
    const chunkWorkers =
      typeof body.chunkWorkers === "number" &&
      Number.isInteger(body.chunkWorkers) &&
      body.chunkWorkers > 0
        ? Math.min(body.chunkWorkers, 16)
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
  startRenderQueueWorker();
});
