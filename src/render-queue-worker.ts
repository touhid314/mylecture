import { fileURLToPath } from "node:url";
import { isStorageConfigured } from "./utils/storage/index.ts";
import { jobParamsFromQueueRow, runJob } from "./render-job.ts";
import {
  claimNextRenderJob,
  closeRenderQueuePool,
  isRenderQueueConfigured,
  markRenderJobCompleted,
  markRenderJobFailedOrRetry,
  reapStuckRenderJobs,
  touchRenderJobHeartbeat,
  type RenderQueueRow,
} from "./render-queue-db.ts";

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const pollIntervalMs = readEnvInt("RENDER_QUEUE_POLL_MS", 3_000);
const heartbeatIntervalMs = readEnvInt("RENDER_QUEUE_HEARTBEAT_MS", 60_000);
const reapIntervalMs = readEnvInt("RENDER_QUEUE_REAP_INTERVAL_MS", 300_000);
const workerId =
  process.env.RENDER_QUEUE_WORKER_ID?.trim() ||
  `render-worker-${process.pid}`;

let running = false;
let activeJobs = 0;
const maxConcurrency = readEnvInt("RENDER_WORKER_MAX_CONCURRENCY", 1);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function processClaimedJob(row: RenderQueueRow): Promise<void> {
  let heartbeatTimer: NodeJS.Timeout | undefined;

  try {
    heartbeatTimer = setInterval(() => {
      void touchRenderJobHeartbeat(row.id).catch((error) => {
        console.warn(`Heartbeat failed for queue job ${row.id}:`, error);
      });
    }, heartbeatIntervalMs);

    const params = jobParamsFromQueueRow(row);
    console.log(
      `Running queue job ${row.videoJobId} (${row.phase}) [queue ${row.id}]`,
    );

    const result = await runJob(params, { notifyOnFailure: false });
    if (result.ok === false) {
      await markRenderJobFailedOrRetry(row.id, result.error);
      console.warn(
        `Queue job failed ${row.videoJobId} (${row.phase}): ${result.error}`,
      );
      return;
    }

    const marked = await markRenderJobCompleted(row.id, workerId);
    if (marked) {
      console.log(`Queue job completed ${row.videoJobId} (${row.phase})`);
    } else {
      console.warn(
        `Render finished for ${row.videoJobId} (${row.phase}) but queue row was preempted`,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Render queue job failed";
    console.error(`Queue job ${row.id} crashed:`, message);
    await markRenderJobFailedOrRetry(row.id, message).catch((markError) => {
      console.error(`Could not update queue job ${row.id}:`, markError);
    });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

async function pollOnce(): Promise<void> {
  while (activeJobs < maxConcurrency) {
    const row = await claimNextRenderJob(workerId);
    if (!row) break;
    activeJobs++;
    void processClaimedJob(row).finally(() => {
      activeJobs--;
    });
  }
}

async function workerLoop(): Promise<void> {
  let lastReapAt = 0;

  while (running) {
    try {
      const now = Date.now();
      if (now - lastReapAt >= reapIntervalMs) {
        const reclaimed = await reapStuckRenderJobs();
        if (reclaimed > 0) {
          console.warn(`Reclaimed ${reclaimed} stuck render queue job(s)`);
        }
        lastReapAt = now;
      }

      await pollOnce();
    } catch (error) {
      console.error(
        "Render queue worker loop error:",
        error instanceof Error ? error.message : error,
      );
    }

    await sleep(pollIntervalMs);
  }
}

export function isRenderQueueWorkerEnabled(): boolean {
  if (process.env.RENDER_QUEUE_WORKER_ENABLED === "0") {
    return false;
  }
  return (
    process.env.RENDER_QUEUE_WORKER_ENABLED === "1" ||
    isRenderQueueConfigured()
  );
}

export function isHttpJobsEnabled(): boolean {
  if (process.env.RENDER_HTTP_JOBS === "0") {
    return false;
  }
  if (process.env.RENDER_HTTP_JOBS === "1") {
    return true;
  }
  return !isRenderQueueWorkerEnabled();
}

export function startRenderQueueWorker(): void {
  if (!isRenderQueueWorkerEnabled()) {
    return;
  }

  if (!isRenderQueueConfigured()) {
    console.warn(
      "RENDER_QUEUE_WORKER_ENABLED is set but DATABASE_URL is missing; queue worker not started",
    );
    return;
  }

  if (!isStorageConfigured()) {
    console.warn(
      "Render queue worker requires storage configuration; queue worker not started",
    );
    return;
  }

  if (running) return;
  running = true;

  console.log(
    `Render queue worker started (id=${workerId}, concurrency=${maxConcurrency}, poll=${pollIntervalMs}ms)`,
  );

  void workerLoop();
}

export async function stopRenderQueueWorker(): Promise<void> {
  running = false;
  while (activeJobs > 0) {
    await sleep(250);
  }
  await closeRenderQueuePool();
}

const isQueueWorkerMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isQueueWorkerMain) {
  startRenderQueueWorker();
}
