import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAuth, assertOwnerAccess, authRoleToOwnerRole, resolveOwnerRole } from "./lecturegen/auth.ts";
import type { LectureGenAuthRole } from "./lecturegen/auth.ts";
import {
  createJobRecord,
  getJobRecord,
  loadJobsFromManifests,
  publicJobView,
  tryBeginEditJob,
} from "./lecturegen/job-store.ts";
import {
  runCreateJob,
  runEditJob,
} from "./lecturegen/generation-runner.ts";
import { createWorkspaceDownloadTransfer, openWorkspaceBundleStream } from "./lecturegen/source-bundle.ts";
import {
  createSignedTransferUrl,
  listIntermediateKeys,
  resolvedAudioPrefix,
  resolvedObjectPrefix,
} from "./lecturegen/storage.ts";
import { validateLectureGenStartupConfig } from "./lecturegen/startup-config.ts";
import { finalizeJobDeletion, removeJobManifest, retryPendingCallbacks, runLectureGenMaintenance } from "./lecturegen/reaper.ts";
import { deleteGenerationArtifacts } from "./lecturegen/generation-runner.ts";
import type {
  LectureGenCreateRequest,
  LectureGenEditRequest,
  LectureGenJobRecord,
  LectureGenTransferRequest,
} from "./lecturegen/types.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 8790;

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const port = readEnvInt("PORT", DEFAULT_PORT);
const maxBodyBytes = readEnvInt("LECTUREGEN_MAX_BODY_BYTES", 64 * 1024 * 1024);
const maxConcurrency = readEnvInt("LECTUREGEN_MAX_CONCURRENCY", 2);
const maxQueueDepth = readEnvInt("LECTUREGEN_MAX_QUEUE_DEPTH", 20);
const maintenanceIntervalMs = readEnvInt("LECTUREGEN_MAINTENANCE_INTERVAL_MS", 60 * 60 * 1000);
const callbackRetryIntervalMs = readEnvInt("LECTUREGEN_CALLBACK_RETRY_MS", 60_000);

let activeJobs = 0;
const pendingJobs: Array<() => Promise<void>> = [];

function scheduleJob(task: () => Promise<void>): void {
  pendingJobs.push(task);
  drainQueue();
}

function drainQueue(): void {
  while (activeJobs < maxConcurrency && pendingJobs.length > 0) {
    const task = pendingJobs.shift()!;
    activeJobs++;
    void (async () => {
      try {
        await task();
      } finally {
        activeJobs--;
        drainQueue();
      }
    })();
  }
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

function readBody(req: IncomingMessage): Promise<Buffer> {
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
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson<T>(raw: Buffer): T {
  return JSON.parse(raw.toString("utf-8")) as T;
}

function isQueueFull(): boolean {
  return pendingJobs.length + activeJobs >= maxQueueDepth;
}

function enforceOwnerAccess(
  res: ServerResponse,
  record: LectureGenJobRecord,
  role: LectureGenAuthRole,
): boolean {
  if (!assertOwnerAccess(record, role)) {
    sendJson(res, 403, { error: "Forbidden" });
    return false;
  }
  return true;
}

async function handleCreateJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const role = checkAuth(req, res, sendJson, ["service", "ide"]);
  if (!role) return;
  if (isQueueFull()) {
    sendJson(res, 503, { error: "LectureGen queue is at capacity. Try again later." });
    return;
  }
  const body = parseJson<LectureGenCreateRequest>(await readBody(req));
  if (!body.prompt?.trim()) {
    sendJson(res, 400, { error: "prompt is required" });
    return;
  }

  if (
    role === "ide" &&
    (body.websiteJobId?.trim() || body.websiteStorageBase?.trim())
  ) {
    sendJson(res, 400, {
      error: "IDE jobs cannot include websiteJobId or websiteStorageBase",
    });
    return;
  }

  const ownerRole = authRoleToOwnerRole(role);
  if (!ownerRole) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const record = createJobRecord(body, ownerRole);
  sendJson(res, 202, {
    generationId: record.id,
    sourceVersion: record.sourceVersion,
    statusUrl: `/v1/jobs/${record.id}`,
  });

  scheduleJob(() => runCreateJob(record.id, body));
}

async function handleGetJob(
  req: IncomingMessage,
  res: ServerResponse,
  generationId: string,
): Promise<void> {
  const role = checkAuth(req, res, sendJson, ["service", "ide"]);
  if (!role) return;
  const record = getJobRecord(generationId);
  if (!record) {
    sendJson(res, 404, { error: "Job not found" });
    return;
  }
  if (!enforceOwnerAccess(res, record, role)) return;
  sendJson(res, 200, publicJobView(record));
}

async function handleEditJob(
  req: IncomingMessage,
  res: ServerResponse,
  generationId: string,
): Promise<void> {
  const role = checkAuth(req, res, sendJson, ["service", "ide"]);
  if (!role) return;
  if (isQueueFull()) {
    sendJson(res, 503, { error: "LectureGen queue is at capacity. Try again later." });
    return;
  }
  const record = getJobRecord(generationId);
  if (!record) {
    sendJson(res, 404, { error: "Job not found" });
    return;
  }
  if (!enforceOwnerAccess(res, record, role)) return;

  const body = parseJson<LectureGenEditRequest>(await readBody(req));
  if (!body.instruction?.trim()) {
    sendJson(res, 400, { error: "instruction is required" });
    return;
  }

  const nextSourceVersion = tryBeginEditJob(generationId);
  if (nextSourceVersion === null) {
    const current = getJobRecord(generationId);
    const busy =
      current?.status === "generating" || current?.status === "queued";
    sendJson(res, 409, {
      error: busy
        ? "Job is busy; try again when the current edit finishes"
        : "Job is not ready for edit",
    });
    return;
  }

  sendJson(res, 202, {
    generationId,
    sourceVersion: nextSourceVersion,
  });

  scheduleJob(() => runEditJob(generationId, body));
}

async function handleDeleteJob(
  req: IncomingMessage,
  res: ServerResponse,
  generationId: string,
): Promise<void> {
  const role = checkAuth(req, res, sendJson, ["service", "ide"]);
  if (!role) return;
  const record = getJobRecord(generationId);
  if (!record) {
    // Idempotent cleanup when memory is already gone (prior partial delete).
    await deleteGenerationArtifacts(generationId).catch(() => {});
    await removeJobManifest(generationId).catch(() => {});
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!enforceOwnerAccess(res, record, role)) return;

  try {
    await finalizeJobDeletion(generationId);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to persist deletion tombstone";
    console.error(`LectureGen delete deferred for ${generationId}:`, error);
    // Job remains tombstoned in memory; client should retry.
    sendJson(res, 503, {
      error: message,
      deletionPending: true,
      generationId,
    });
  }
}

async function handleSourceBundle(
  req: IncomingMessage,
  res: ServerResponse,
  generationId: string,
): Promise<void> {
  const role = checkAuth(req, res, sendJson, ["ide"]);
  if (!role) return;
  const record = getJobRecord(generationId);
  if (!record) {
    sendJson(res, 404, { error: "Job not found" });
    return;
  }
  if (!enforceOwnerAccess(res, record, role)) return;

  if (record.status !== "source_ready") {
    const busy = record.status === "generating" || record.status === "queued";
    sendJson(res, busy ? 409 : 404, {
      error: busy
        ? "Source bundle is not available while generation is in progress"
        : "Source bundle is not available for this job",
    });
    return;
  }

  const { stream, contentLength } = await openWorkspaceBundleStream(
    generationId,
    record.sourceVersion,
  );

  res.writeHead(200, {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${generationId}-v${record.sourceVersion}.tar.gz"`,
    ...(contentLength > 0 ? { "Content-Length": contentLength } : {}),
  });
  stream.pipe(res);
  await new Promise<void>((resolve, reject) => {
    res.on("finish", resolve);
    res.on("error", reject);
    stream.on("error", reject);
  });
}

async function handleTransfer(
  req: IncomingMessage,
  res: ServerResponse,
  generationId: string,
): Promise<void> {
  if (!checkAuth(req, res, sendJson, ["worker"])) return;
  const record = getJobRecord(generationId);
  if (!record) {
    sendJson(res, 404, { error: "Job not found" });
    return;
  }
  if (resolveOwnerRole(record) === "ide") {
    sendJson(res, 403, { error: "Worker transfers are not available for IDE-owned jobs" });
    return;
  }

  const body = parseJson<LectureGenTransferRequest>(await readBody(req));
  if (!body.purpose || typeof body.sourceVersion !== "number") {
    sendJson(res, 400, { error: "purpose and sourceVersion are required" });
    return;
  }

  if (body.purpose === "resolved_audio_list") {
    const prefix = `${resolvedAudioPrefix(generationId, body.sourceVersion)}/`;
    const objectKeys = await listIntermediateKeys(prefix);
    sendJson(res, 200, { objectKeys });
    return;
  }

  if (body.purpose === "resolved_scene_list") {
    const prefix = resolvedObjectPrefix(generationId, body.sourceVersion);
    const objectKeys = (await listIntermediateKeys(prefix))
      .filter((key) => /^resolved(?:\d+)?\.html$/i.test(key.slice(prefix.length)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    sendJson(res, 200, { objectKeys });
    return;
  }

  if (body.purpose === "workspace_download") {
    try {
      const signed = await createWorkspaceDownloadTransfer({
        generationId,
        sourceVersion: body.sourceVersion,
      });
      sendJson(res, 200, signed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transfer failed";
      sendJson(res, 400, { error: message });
    }
    return;
  }

  try {
    const signed = await createSignedTransferUrl({
      generationId,
      sourceVersion: body.sourceVersion,
      purpose: body.purpose,
      objectKey: body.objectKey,
    });
    sendJson(res, 200, signed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer failed";
    sendJson(res, 400, { error: message });
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      ready: true,
      activeJobs,
      pendingJobs: pendingJobs.length,
    });
    return;
  }

  if (parts[0] === "v1" && parts[1] === "jobs") {
    if (parts.length === 2 && req.method === "POST") {
      await handleCreateJob(req, res);
      return;
    }

    const generationId = parts[2];
    if (!generationId) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (parts.length === 3 && req.method === "GET") {
      await handleGetJob(req, res, generationId);
      return;
    }

    if (parts.length === 3 && req.method === "DELETE") {
      await handleDeleteJob(req, res, generationId);
      return;
    }

    if (parts[3] === "edits" && req.method === "POST") {
      await handleEditJob(req, res, generationId);
      return;
    }

    if (parts[3] === "source-bundle" && req.method === "GET") {
      await handleSourceBundle(req, res, generationId);
      return;
    }

    if (parts[3] === "transfers" && req.method === "POST") {
      await handleTransfer(req, res, generationId);
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("LectureGen request failed:", error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error" });
    }
  });
});

async function startServer(): Promise<void> {
  const configurationErrors = validateLectureGenStartupConfig();
  if (configurationErrors.length > 0) {
    throw new Error(
      `LectureGen startup configuration is invalid:\n- ${configurationErrors.join("\n- ")}`,
    );
  }

  // This also verifies that durable intermediate storage is reachable before
  // the service advertises readiness.
  const loaded = await loadJobsFromManifests();
  if (loaded > 0) {
    console.log(`Restored ${loaded} LectureGen job(s) from persisted manifests`);
  }
  await runLectureGenMaintenance();

  setInterval(() => {
    void runLectureGenMaintenance().catch((error) => {
      console.error("LectureGen maintenance failed:", error);
    });
  }, maintenanceIntervalMs);

  setInterval(() => {
    void retryPendingCallbacks().catch((error) => {
      console.error("LectureGen callback retry failed:", error);
    });
  }, callbackRetryIntervalMs);

  server.listen(port, () => {
    console.log(`LectureGen server listening on http://localhost:${port}`);
    console.log(`Repo root: ${repoRoot}`);
  });
}

void startServer().catch((error) => {
  console.error(
    "LectureGen failed to start:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
