import { Pool } from "pg";
import { notifyRenderJobFailed } from "./render-job.ts";

export type RenderQueueRow = {
  id: string;
  videoJobId: string;
  phase: string;
  storageBase: string;
  generationId: string | null;
  sourceVersion: number | null;
  voice: string | null;
  audioWorkers: number;
  kokoroDevice: string;
  chunkWorkers: number;
  fps: number | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  meteringOperationId: string | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  heartbeatAt: Date | null;
  lastError: string | null;
  availableAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

let pool: Pool | null = null;

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isRenderQueueConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the render queue worker");
  }

  pool ??= new Pool({
    connectionString,
    max: readEnvInt("RENDER_QUEUE_DB_POOL_MAX", 3),
    idleTimeoutMillis: readEnvInt("RENDER_QUEUE_DB_IDLE_TIMEOUT_MS", 10_000),
    connectionTimeoutMillis: readEnvInt(
      "RENDER_QUEUE_DB_CONNECTION_TIMEOUT_MS",
      5_000,
    ),
  });

  return pool;
}

function mapRow(row: Record<string, unknown>): RenderQueueRow {
  return {
    id: String(row.id),
    videoJobId: String(row.videoJobId),
    phase: String(row.phase),
    storageBase: String(row.storageBase),
    generationId:
      row.generationId === null || row.generationId === undefined
        ? null
        : String(row.generationId),
    sourceVersion:
      row.sourceVersion === null || row.sourceVersion === undefined
        ? null
        : Number(row.sourceVersion),
    voice: row.voice === null || row.voice === undefined ? null : String(row.voice),
    audioWorkers: Number(row.audioWorkers),
    kokoroDevice: String(row.kokoroDevice),
    chunkWorkers: Number(row.chunkWorkers),
    fps: row.fps === null || row.fps === undefined ? null : Number(row.fps),
    meteringOperationId:
      row.meteringOperationId === null || row.meteringOperationId === undefined
        ? null
        : String(row.meteringOperationId),
    status: String(row.status),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.maxAttempts),
    claimedAt: row.claimedAt ? new Date(String(row.claimedAt)) : null,
    claimedBy:
      row.claimedBy === null || row.claimedBy === undefined
        ? null
        : String(row.claimedBy),
    heartbeatAt: row.heartbeatAt ? new Date(String(row.heartbeatAt)) : null,
    lastError:
      row.lastError === null || row.lastError === undefined
        ? null
        : String(row.lastError),
    availableAt: new Date(String(row.availableAt)),
    createdAt: new Date(String(row.createdAt)),
    updatedAt: new Date(String(row.updatedAt)),
  };
}

export async function claimNextRenderJob(
  workerId: string,
): Promise<RenderQueueRow | null> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const claimResult = await client.query(
      `
      UPDATE "RenderQueue"
      SET
        status = 'claimed',
        "claimedAt" = NOW(),
        "claimedBy" = $1,
        "heartbeatAt" = NOW(),
        attempts = attempts + 1,
        "updatedAt" = NOW()
      WHERE id = (
        SELECT id
        FROM "RenderQueue"
        WHERE status = 'pending' AND "availableAt" <= NOW()
        ORDER BY "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
      `,
      [workerId],
    );

    await client.query("COMMIT");

    if (claimResult.rowCount === 0) {
      return null;
    }

    return mapRow(claimResult.rows[0] as Record<string, unknown>);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function touchRenderJobHeartbeat(queueId: string): Promise<void> {
  await getPool().query(
    `
    UPDATE "RenderQueue"
    SET "heartbeatAt" = NOW(), "updatedAt" = NOW()
    WHERE id = $1 AND status = 'claimed'
    `,
    [queueId],
  );
}

export async function markRenderJobCompleted(
  queueId: string,
  workerId: string,
): Promise<boolean> {
  const result = await getPool().query(
    `
    UPDATE "RenderQueue"
    SET
      status = 'completed',
      "lastError" = NULL,
      "updatedAt" = NOW()
    WHERE id = $1 AND status = 'claimed' AND "claimedBy" = $2
    `,
    [queueId, workerId],
  );
  return (result.rowCount ?? 0) > 0;
}

function lectureGenCallbackContext(
  row: Record<string, unknown>,
): { generationId: string; sourceVersion: number } | null {
  const generationId =
    row.generationId === null || row.generationId === undefined
      ? null
      : String(row.generationId).trim();
  const sourceVersion =
    row.sourceVersion === null || row.sourceVersion === undefined
      ? null
      : Number(row.sourceVersion);
  if (!generationId || sourceVersion === null || !Number.isInteger(sourceVersion)) {
    return null;
  }
  return { generationId, sourceVersion };
}

export async function markRenderJobFailedOrRetry(
  queueId: string,
  errorMessage: string,
): Promise<void> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const current = await client.query(
      `SELECT status, attempts, "maxAttempts", "videoJobId", phase, "generationId", "sourceVersion", "meteringOperationId" FROM "RenderQueue" WHERE id = $1 FOR UPDATE`,
      [queueId],
    );

    if (current.rowCount === 0) {
      await client.query("COMMIT");
      return;
    }

    const status = String(current.rows[0].status);
    if (status === "dead" || status !== "claimed") {
      await client.query("COMMIT");
      return;
    }

    const attempts = Number(current.rows[0].attempts);
    const maxAttempts = Number(current.rows[0].maxAttempts);
    const videoJobId = String(current.rows[0].videoJobId);
    const phase = String(current.rows[0].phase) as "preview" | "final";
    const deadError = errorMessage.slice(0, 500);

    if (attempts >= maxAttempts) {
      const deadResult = await client.query(
        `
        UPDATE "RenderQueue"
        SET
          status = 'dead',
          "lastError" = $2,
          "claimedAt" = NULL,
          "claimedBy" = NULL,
          "heartbeatAt" = NULL,
          "updatedAt" = NOW()
        WHERE id = $1 AND status = 'claimed'
        `,
        [queueId, deadError],
      );
      await client.query("COMMIT");
      if ((deadResult.rowCount ?? 0) > 0 && (phase === "preview" || phase === "final")) {
        const meteringOperationId =
          current.rows[0].meteringOperationId === null ||
          current.rows[0].meteringOperationId === undefined
            ? null
            : String(current.rows[0].meteringOperationId);
        void notifyRenderJobFailed(
          videoJobId,
          phase,
          deadError,
          lectureGenCallbackContext(current.rows[0] as Record<string, unknown>),
          meteringOperationId,
        );
      }
      return;
    }

    const backoffMs = readEnvInt("RENDER_QUEUE_RETRY_BACKOFF_MS", 30_000);
    await client.query(
      `
      UPDATE "RenderQueue"
      SET
        status = 'pending',
        "lastError" = $2,
        "availableAt" = NOW() + ($3::double precision / 1000.0) * interval '1 second',
        "claimedAt" = NULL,
        "claimedBy" = NULL,
        "heartbeatAt" = NULL,
        "updatedAt" = NOW()
      WHERE id = $1 AND status = 'claimed'
      `,
      [queueId, errorMessage.slice(0, 500), backoffMs],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reapStuckRenderJobs(): Promise<number> {
  const claimTimeoutMs = readEnvInt("RENDER_QUEUE_CLAIM_TIMEOUT_MS", 1_800_000);
  const cutoff = new Date(Date.now() - claimTimeoutMs);

  const stuck = await getPool().query(
    `
    SELECT id, attempts, "maxAttempts", "videoJobId", phase, "generationId", "sourceVersion", "meteringOperationId"
    FROM "RenderQueue"
    WHERE status = 'claimed'
      AND (
        ("heartbeatAt" IS NOT NULL AND "heartbeatAt" < $1)
        OR ("heartbeatAt" IS NULL AND "claimedAt" IS NOT NULL AND "claimedAt" < $1)
      )
    `,
    [cutoff],
  );

  for (const row of stuck.rows) {
    const queueId = String(row.id);
    const attempts = Number(row.attempts);
    const maxAttempts = Number(row.maxAttempts);
    const videoJobId = String(row.videoJobId);
    const phase = String(row.phase) as "preview" | "final";
    const reclaimNote = "Claim timed out; job reclaimed for retry";

    if (attempts >= maxAttempts) {
      const deadResult = await getPool().query(
        `
        UPDATE "RenderQueue"
        SET
          status = 'dead',
          "lastError" = $2,
          "claimedAt" = NULL,
          "claimedBy" = NULL,
          "heartbeatAt" = NULL,
          "updatedAt" = NOW()
        WHERE id = $1 AND status = 'claimed'
        `,
        [queueId, reclaimNote],
      );
      if ((deadResult.rowCount ?? 0) > 0 && (phase === "preview" || phase === "final")) {
        const meteringOperationId =
          row.meteringOperationId === null ||
          row.meteringOperationId === undefined
            ? null
            : String(row.meteringOperationId);
        void notifyRenderJobFailed(
          videoJobId,
          phase,
          reclaimNote,
          lectureGenCallbackContext(row as Record<string, unknown>),
          meteringOperationId,
        );
      }
      continue;
    }

    await getPool().query(
      `
      UPDATE "RenderQueue"
      SET
        status = 'pending',
        "lastError" = $2,
        "availableAt" = NOW(),
        "claimedAt" = NULL,
        "claimedBy" = NULL,
        "heartbeatAt" = NULL,
        "updatedAt" = NOW()
      WHERE id = $1 AND status = 'claimed'
      `,
      [queueId, reclaimNote],
    );
  }

  return stuck.rowCount ?? 0;
}

export async function closeRenderQueuePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
