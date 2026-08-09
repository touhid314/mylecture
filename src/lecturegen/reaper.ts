import {

  buildLectureGenCallbackPayload,

  buildLectureGenProgressCallbackPayload,

  postLectureGenCallback,

  resolveMeteringOperationId,

} from "./callback.ts";

import { resolveOwnerRole } from "./auth.ts";

import {

  blockPersistWrites,

  clearCallbackPending,

  clearProgressCallbackPending,

  clearPersistState,

  deleteJobRecord,

  flushPersist,

  getJobRecord,

  listJobRecords,

  markDeleteRequested,

  markDeleteRequestedDurable,

} from "./job-store.ts";

import { deleteGenerationArtifacts } from "./generation-runner.ts";

import { removeIntermediatePrefix } from "./storage.ts";



const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const TOMBSTONE_DELETE_GRACE_MS = 60_000;

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Non-website (IDE) jobs in terminal states expire after this TTL (default 24h). */
const IDE_JOB_TTL_MS = readEnvInt("LECTUREGEN_IDE_JOB_TTL_MS", ORPHAN_MAX_AGE_MS);



export async function reapSupersededVersions(

  generationId: string,

  lastReadySourceVersion: number,

): Promise<void> {

  // Keep the previous version too — an in-flight render may still reference it.

  for (let version = 1; version < lastReadySourceVersion - 1; version++) {

    await removeIntermediatePrefix(`${generationId}/v${version}/`);

  }

}



export async function retryPendingCallbacks(): Promise<number> {

  let retried = 0;



  for (const record of listJobRecords()) {

    const progressPending = record.progressCallbackPending;
    const progressWebsiteJobId = record.websiteJobId?.trim();
    if (progressPending && progressWebsiteJobId) {
      const delivered = await postLectureGenCallback(
        buildLectureGenProgressCallbackPayload({
          websiteJobId: progressWebsiteJobId,
          generationId: record.id,
          progress: progressPending.progress,
        }),
      );
      if (delivered) {
        clearProgressCallbackPending(
          record.id,
          progressPending.progress.sequence,
        );
        await flushPersist(record.id);
        retried++;
      }
    }

    const pending = record.callbackPending;

    const websiteJobId = record.websiteJobId?.trim();

    if (!pending || !websiteJobId) continue;



    const delivered = await postLectureGenCallback(

      buildLectureGenCallbackPayload({

        websiteJobId,

        generationId: record.id,

        sourceVersion: pending.sourceVersion,

        status: pending.status,

        usage: pending.usage,

        meteringOperationId: resolveMeteringOperationId(record),

        error: pending.error,

        interactiveReady: pending.interactiveReady,

        gameReady: pending.gameReady,

      }),

    );



    if (delivered) {
      clearCallbackPending(record.id);
      await flushPersist(record.id);
      retried++;
    }

  }



  return retried;

}



export async function reapAbandonedJobs(): Promise<number> {

  const now = Date.now();

  let reaped = 0;



  for (const record of listJobRecords()) {

    const isOrphan =
      resolveOwnerRole(record) === "ide" &&
      record.status !== "source_ready" &&
      now - record.createdAt > ORPHAN_MAX_AGE_MS;



    if (!isOrphan) continue;

    try {
      await finalizeJobDeletion(record.id);
      if (!getJobRecord(record.id)) {
        reaped++;
      }
    } catch (error) {
      console.error(`Abandoned job deletion failed for ${record.id}:`, error);
    }

  }



  return reaped;

}



/**
 * Remove jobs tombstoned via DELETE / outbox (`deleteRequestedAt`).
 * Website-linked jobs are retained until VideoJob deletion (outbox) or an explicit tombstone —
 * age alone does not delete them.
 */
export async function reapTombstonedJobs(): Promise<number> {
  const now = Date.now();
  let reaped = 0;

  for (const record of listJobRecords()) {
    const deleteRequestedAt = record.deleteRequestedAt;
    if (!deleteRequestedAt) continue;
    if (now - deleteRequestedAt < TOMBSTONE_DELETE_GRACE_MS) continue;

    try {
      await finalizeJobDeletion(record.id);
      if (!getJobRecord(record.id)) {
        reaped++;
      }
    } catch (error) {
      console.error(
        `Tombstone deletion retry failed for ${record.id}:`,
        error,
      );
    }
  }

  return reaped;
}

/** Expire non-website IDE jobs left in terminal states after `LECTUREGEN_IDE_JOB_TTL_MS`. */
export async function reapIdeRetentionJobs(): Promise<number> {
  const now = Date.now();
  let reaped = 0;

  for (const record of listJobRecords()) {
    if (resolveOwnerRole(record) !== "ide") continue;
    if (record.status !== "source_ready" && record.status !== "failed") continue;
    if (record.deleteRequestedAt) continue;
    if (now - record.updatedAt <= IDE_JOB_TTL_MS) continue;

    try {
      await finalizeJobDeletion(record.id);
      if (!getJobRecord(record.id)) {
        reaped++;
      }
    } catch (error) {
      console.error(`IDE retention deletion failed for ${record.id}:`, error);
    }
  }

  return reaped;
}



export async function runLectureGenMaintenance(): Promise<void> {

  for (const record of listJobRecords()) {

    if (record.lastReadySourceVersion > 0) {

      await reapSupersededVersions(record.id, record.lastReadySourceVersion);

    }

  }

  await retryPendingCallbacks();

  await reapAbandonedJobs();

  await reapIdeRetentionJobs();

  await reapTombstonedJobs();

}



export async function removeJobManifest(generationId: string): Promise<void> {

  await removeIntermediatePrefix(`${generationId}/manifest.json`);

  const record = getJobRecord(generationId);

  if (!record) {

    await removeIntermediatePrefix(`${generationId}/`);

  }

}



export function requestJobDeletion(generationId: string): void {

  markDeleteRequested(generationId);

}

/**
 * Ordered delete: durable tombstone (throws if not saved) → block writes →
 * remove artifacts → drop memory. On tombstone persist failure the job stays
 * in memory with deleteRequestedAt set for retry.
 */
export async function finalizeJobDeletion(generationId: string): Promise<void> {
  await markDeleteRequestedDurable(generationId);
  blockPersistWrites(generationId);

  try {
    await deleteGenerationArtifacts(generationId);
    await removeJobManifest(generationId);
  } catch (error) {
    console.error(
      `Failed to delete LectureGen artifacts for ${generationId}:`,
      error,
    );
    return;
  }

  deleteJobRecord(generationId);
  clearPersistState(generationId);
}


