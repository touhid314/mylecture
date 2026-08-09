import { randomUUID } from "node:crypto";

import {

  loadJobManifest,

  listPersistedGenerationIds,

  saveJobManifest,

  type PersistedJobManifest,

} from "./job-manifest.ts";

import {

  buildLectureGenCallbackPayload,

  postLectureGenCallback,

  resolveMeteringOperationId,

} from "./callback.ts";

import { resolveOwnerRole } from "./auth.ts";

import type {

  LectureGenCreateRequest,

  LectureGenEditRequest,

  LectureGenJobRecord,

  LectureGenJobStatus,

  LectureGenOwnerRole,

  LectureGenProgress,

  LectureGenUsage,

} from "./types.ts";



const jobs = new Map<string, LectureGenJobRecord>();

const abortControllers = new Map<string, AbortController>();

const persistChains = new Map<string, Promise<void>>();

const blockedPersistIds = new Set<string>();

let persistWrites = true;

/** Test hook: pause persistRecord after loadJobManifest, before saveJobManifest. */
let testPersistSaveGate: (() => Promise<void>) | null = null;

export function __testOnly_setPersistSaveGate(
  gate: (() => Promise<void>) | null,
): void {
  testPersistSaveGate = gate;
}

/** Test hook: force persistTombstoneDurable / save path to fail. */
let testTombstonePersistFail: Error | null = null;

export function __testOnly_setTombstonePersistFail(error: Error | null): void {
  testTombstonePersistFail = error;
}

export function __testOnly_resetPersistBlocks(): void {
  blockedPersistIds.clear();
  testPersistSaveGate = null;
  testTombstonePersistFail = null;
}

export function blockPersistWrites(id: string): void {
  blockedPersistIds.add(id);
}

export function clearPersistState(id: string): void {
  blockedPersistIds.delete(id);
  persistChains.delete(id);
}

function isPersistBlocked(id: string): boolean {
  return blockedPersistIds.has(id);
}



const INTERRUPTED_ERROR = "Interrupted by server restart";

type AttachmentMeta = {
  filename: string;
  mimeType: string;
  kind: string;
};

/** Strip base64 bodies from attachments; files live in workspace storage after writeAttachments. */
export function slimAttachmentsForManifest(
  attachments?: LectureGenCreateRequest["attachments"],
): AttachmentMeta[] | undefined {
  if (!attachments?.length) return attachments;
  return attachments.map(({ filename, mimeType, kind }) => ({
    filename,
    mimeType,
    kind,
  }));
}

function slimCreateRequestForManifest(
  request: LectureGenCreateRequest | null | undefined,
): LectureGenCreateRequest | null {
  if (!request) return null;
  const { attachments, ...rest } = request;
  const slimmed = slimAttachmentsForManifest(attachments);
  if (!slimmed) return rest;
  return { ...rest, attachments: slimmed as LectureGenCreateRequest["attachments"] };
}

function slimEditRequestForManifest(
  request: LectureGenEditRequest | null | undefined,
): LectureGenEditRequest | null {
  if (!request) return null;
  const { attachments, ...rest } = request;
  const slimmed = slimAttachmentsForManifest(attachments);
  if (!slimmed) return rest;
  return { ...rest, attachments: slimmed as LectureGenEditRequest["attachments"] };
}

function toManifest(record: LectureGenJobRecord): PersistedJobManifest {
  return {
    ...record,
    createRequest: slimCreateRequestForManifest(record.createRequest),
    lastEditRequest: slimEditRequestForManifest(record.lastEditRequest),
  };
}



async function persistRecord(id: string): Promise<void> {

  if (!persistWrites) return;

  if (isPersistBlocked(id)) return;

  const record = jobs.get(id);

  if (!record) return;



  const nextRevision = (record.manifestRevision ?? 0) + 1;

  record.manifestRevision = nextRevision;



  try {

    const existing = await loadJobManifest(id);

    if (isPersistBlocked(id) || !jobs.has(id)) return;

    const recordAfterAwait = jobs.get(id);

    if (!recordAfterAwait) return;

    const existingRevision =

      existing?.manifestRevision ?? existing?.updatedAt ?? 0;

    if (existingRevision > nextRevision) {

      console.warn(

        `Skipping stale LectureGen manifest write for ${id} (stored=${existingRevision}, attempted=${nextRevision})`,

      );

      return;

    }

    if (testPersistSaveGate) {

      await testPersistSaveGate();

    }

    if (isPersistBlocked(id) || !jobs.has(id)) return;

    const recordBeforeSave = jobs.get(id);

    if (!recordBeforeSave) return;

    await saveJobManifest(toManifest(recordBeforeSave));

  } catch (error) {

    console.error(`Failed to persist LectureGen manifest for ${id}:`, error);

  }

}



function enqueuePersist(id: string): Promise<void> {

  if (isPersistBlocked(id)) {

    return Promise.resolve();

  }

  const previous = persistChains.get(id) ?? Promise.resolve();

  const next = previous

    .then(() => {

      if (isPersistBlocked(id)) return;

      return persistRecord(id);

    })

    .catch((error) => {

      console.error(`LectureGen persist chain failed for ${id}:`, error);

    });

  persistChains.set(id, next);

  return next;

}



export async function flushPersist(id: string): Promise<void> {

  await (persistChains.get(id) ?? Promise.resolve());

}

/**
 * Durably persist the current in-memory record (including tombstone fields).
 * Throws if storage write fails — unlike routine persistRecord which swallows errors.
 * Call after markDeleteRequestedInMemory and flushPersist of any prior chain.
 */
export async function persistTombstoneDurable(id: string): Promise<void> {
  const record = jobs.get(id);
  if (!record) {
    throw new Error(`Cannot persist tombstone: job ${id} not found`);
  }
  if (!record.deleteRequestedAt) {
    throw new Error(`Cannot persist tombstone: job ${id} is not marked for deletion`);
  }

  const nextRevision = (record.manifestRevision ?? 0) + 1;
  record.manifestRevision = nextRevision;
  touch(record);

  const existing = await loadJobManifest(id);
  const existingRevision = existing?.manifestRevision ?? existing?.updatedAt ?? 0;
  if (existingRevision > nextRevision && existing?.deleteRequestedAt) {
    // A newer tombstoned manifest already exists — treat as durable.
    return;
  }

  if (testTombstonePersistFail) {
    throw testTombstonePersistFail;
  }

  await saveJobManifest(toManifest(record));

  const verified = await loadJobManifest(id);
  if (!verified?.deleteRequestedAt) {
    throw new Error(
      `Tombstone for ${id} was not confirmed in storage after write`,
    );
  }
}

function touch(record: LectureGenJobRecord): void {

  record.updatedAt = Date.now();

}

/**
 * Keep generation IDs unique while making their R2 prefixes human-readable and
 * lexicographically chronological. Colons and dots are replaced so the same ID
 * is also safe as a local directory name on every supported platform.
 */
export function createGenerationId(
  nowMs = Date.now(),
  uniqueId = randomUUID(),
): string {
  const timestamp = new Date(nowMs)
    .toISOString()
    .replaceAll(":", "-")
    .replace(".", "-");
  return `${timestamp}_${uniqueId}`;
}



export function createJobRecord(

  request: LectureGenCreateRequest,

  ownerRole: LectureGenOwnerRole,

): LectureGenJobRecord {

  const now = Date.now();

  const id = createGenerationId(now);

  const record: LectureGenJobRecord = {

    id,

    ownerRole,

    status: "queued",

    sourceVersion: 1,

    lastReadySourceVersion: 0,

    logs: [],

    usage: null,

    progress: null,

    checkpoint: {
      schemaVersion: 1,
      sourceVersion: 1,
      resumeEligible: false,
      stage: "queued",
      completedScenes: [],
      updatedAt: now,
    },

    error: null,

    websiteJobId: request.websiteJobId?.trim() || null,

    websiteStorageBase: request.websiteStorageBase?.trim() || null,

    createRequest: {
      ...request,
      // Persist the effective API default (off unless explicitly true).
      enableGetimg: request.enableGetimg === true,
    },

    lastEditRequest: null,

    callbackPending: null,

    progressCallbackPending: null,

    callbackDeliveredAt: null,

    deleteRequestedAt: null,

    manifestRevision: 0,

    createdAt: now,

    updatedAt: now,

  };

  jobs.set(id, record);

  void enqueuePersist(id);

  return record;

}



export function getJobRecord(id: string): LectureGenJobRecord | null {

  return jobs.get(id) ?? null;

}



export function listJobRecords(): LectureGenJobRecord[] {

  return [...jobs.values()];

}



export function countInFlightJobs(): number {

  let count = 0;

  for (const record of jobs.values()) {

    if (record.status === "queued" || record.status === "generating") {

      count++;

    }

  }

  return count;

}



export async function loadJobsFromManifests(): Promise<number> {

  if (process.env.LECTUREGEN_RESUME_INTERRUPTED_JOBS?.trim() === "true") {
    console.warn(
      "LECTUREGEN_RESUME_INTERRUPTED_JOBS is reserved; checkpoint schema v1 is observability-only, so interrupted jobs still fail safely.",
    );
  }

  persistWrites = false;

  try {

    const ids = await listPersistedGenerationIds();

    let loaded = 0;

    const interruptedIds = new Set<string>();



    for (const id of ids) {

      if (jobs.has(id)) continue;

      const manifest = await loadJobManifest(id);

      if (!manifest) continue;



      const record: LectureGenJobRecord = {

        ...manifest,

        ownerRole: resolveOwnerRole(manifest as LectureGenJobRecord),


        callbackPending: manifest.callbackPending ?? null,

        progressCallbackPending: manifest.progressCallbackPending ?? null,

        progress: manifest.progress ?? null,

        checkpoint: manifest.checkpoint ?? null,

        callbackDeliveredAt: manifest.callbackDeliveredAt ?? null,

        deleteRequestedAt: manifest.deleteRequestedAt ?? null,

        manifestRevision: manifest.manifestRevision ?? manifest.updatedAt ?? 0,

      };

      if (record.status === "queued" || record.status === "generating") {

        record.status = "failed";

        record.error = INTERRUPTED_ERROR;

        record.logs.push(INTERRUPTED_ERROR);

        interruptedIds.add(id);

      }



      jobs.set(id, record);

      loaded++;

    }



    persistWrites = true;

    for (const id of interruptedIds) {

      const record = jobs.get(id);

      const websiteJobId = record?.websiteJobId?.trim();

      if (record && websiteJobId) {
        const pending = {
          status: "failed" as const,
          sourceVersion: record.sourceVersion,
          usage: record.usage,
          error: INTERRUPTED_ERROR,
        };
        setCallbackPending(id, pending);
        await flushPersist(id);

        const delivered = await postLectureGenCallback(
          buildLectureGenCallbackPayload({
            websiteJobId,
            generationId: id,
            sourceVersion: record.sourceVersion,
            status: "failed",
            meteringOperationId: resolveMeteringOperationId(record),
            error: INTERRUPTED_ERROR,
          }),
        );

        if (delivered) {
          clearCallbackPending(id);
          await flushPersist(id);
        }
      } else {
        await enqueuePersist(id);
      }

    }

    return loaded;

  } finally {

    persistWrites = true;

  }

}



export function appendJobLog(id: string, line: string): void {

  const record = jobs.get(id);

  if (!record) return;

  record.logs.push(line);

  if (record.logs.length > 500) {

    record.logs.splice(0, record.logs.length - 500);

  }

  touch(record);

}



export function setJobStatus(id: string, status: LectureGenJobStatus): void {

  const record = jobs.get(id);

  if (!record) return;

  record.status = status;

  touch(record);

  void enqueuePersist(id);

}



export async function setJobError(id: string, error: string): Promise<void> {

  const record = jobs.get(id);

  if (!record) return;

  record.status = "failed";

  record.error = error;

  touch(record);

  await enqueuePersist(id);

}



export function setJobUsage(id: string, usage: LectureGenUsage | null): void {

  const record = jobs.get(id);

  if (!record) return;

  record.usage = usage;

  touch(record);

  void enqueuePersist(id);

}

export function setJobProgress(
  id: string,
  update: Omit<LectureGenProgress, "sourceVersion" | "sequence" | "updatedAt">,
): LectureGenProgress | null {
  const record = jobs.get(id);
  if (!record) return null;

  const progress: LectureGenProgress = {
    ...update,
    sourceVersion: record.sourceVersion,
    sequence:
      record.progress?.sourceVersion === record.sourceVersion
        ? record.progress.sequence + 1
        : 1,
    updatedAt: Date.now(),
  };
  record.progress = progress;
  record.checkpoint = {
    schemaVersion: 1,
    sourceVersion: record.sourceVersion,
    resumeEligible: false,
    stage: progress.stage,
    completedScenes: Array.from(
      { length: progress.completedScenes ?? 0 },
      (_, index) => index + 1,
    ),
    updatedAt: progress.updatedAt,
  };
  touch(record);
  void enqueuePersist(id);
  return progress;
}

export function setProgressCallbackPending(
  id: string,
  progress: LectureGenProgress,
): void {
  const record = jobs.get(id);
  if (!record) return;
  record.progressCallbackPending = {
    sourceVersion: progress.sourceVersion,
    progress,
  };
  touch(record);
  void enqueuePersist(id);
}

export function clearProgressCallbackPending(
  id: string,
  deliveredSequence: number,
): void {
  const record = jobs.get(id);
  if (!record) return;
  if (record.progressCallbackPending?.progress.sequence !== deliveredSequence) {
    return;
  }
  record.progressCallbackPending = null;
  touch(record);
  void enqueuePersist(id);
}



export function setLastEditRequest(

  id: string,

  request: LectureGenEditRequest,

): void {

  const record = jobs.get(id);

  if (!record) return;

  record.lastEditRequest = request;

  touch(record);

  void enqueuePersist(id);

}



export function bumpSourceVersion(id: string): number {

  const record = jobs.get(id);

  if (!record) throw new Error("Job not found");

  record.sourceVersion += 1;

  record.progress = null;

  record.checkpoint = {
    schemaVersion: 1,
    sourceVersion: record.sourceVersion,
    resumeEligible: false,
    stage: "queued",
    completedScenes: [],
    updatedAt: Date.now(),
  };

  touch(record);

  void enqueuePersist(id);

  return record.sourceVersion;

}



export async function markJobSourceReady(

  id: string,

  sourceVersion: number,

): Promise<void> {

  const record = jobs.get(id);

  if (!record) return;

  record.status = "source_ready";

  record.sourceVersion = sourceVersion;

  record.lastReadySourceVersion = sourceVersion;

  touch(record);

  await enqueuePersist(id);

}



/** Atomically transition source_ready/failed → generating for the next edit attempt. */

export function tryBeginEditJob(id: string): number | null {

  const record = jobs.get(id);

  if (!record) return null;



  const canEdit =

    record.status === "source_ready" ||

    (record.status === "failed" && record.lastReadySourceVersion >= 1);

  if (!canEdit) return null;



  const nextVersion = record.lastReadySourceVersion + 1;

  record.sourceVersion = nextVersion;

  record.status = "generating";

  record.progress = null;

  record.checkpoint = {
    schemaVersion: 1,
    sourceVersion: nextVersion,
    resumeEligible: false,
    stage: "queued",
    completedScenes: [],
    updatedAt: Date.now(),
  };

  touch(record);

  void enqueuePersist(id);

  return nextVersion;

}



export function markDeleteRequestedInMemory(id: string): void {
  const record = jobs.get(id);
  if (!record) return;
  record.deleteRequestedAt = Date.now();
  touch(record);
}

export function markDeleteRequested(id: string): void {
  markDeleteRequestedInMemory(id);
  void enqueuePersist(id);
}

/** Mark tombstone in memory and await durable storage confirmation (throws on failure). */
export async function markDeleteRequestedDurable(id: string): Promise<void> {
  markDeleteRequestedInMemory(id);
  // Drain any prior soft persists so they do not race after the tombstone write.
  await flushPersist(id);
  await persistTombstoneDurable(id);
}



export function clearCallbackPending(id: string): void {

  const record = jobs.get(id);

  if (!record) return;

  record.callbackPending = null;

  record.callbackDeliveredAt = Date.now();

  touch(record);

  void enqueuePersist(id);

}



export function setCallbackPending(

  id: string,

  pending: NonNullable<LectureGenJobRecord["callbackPending"]>,

): void {

  const record = jobs.get(id);

  if (!record) return;

  record.callbackPending = pending;

  touch(record);

  void enqueuePersist(id);

}



export function deleteJobRecord(id: string): boolean {

  abortJob(id);

  return jobs.delete(id);

}



export function registerAbortController(id: string, controller: AbortController): void {

  abortControllers.set(id, controller);

}



export function abortJob(id: string): void {

  const controller = abortControllers.get(id);

  if (controller) {

    controller.abort();

    abortControllers.delete(id);

  }

}



export function clearAbortController(id: string): void {

  abortControllers.delete(id);

}



export function publicJobView(record: LectureGenJobRecord): Record<string, unknown> {

  return {

    id: record.id,

    status: record.status,

    sourceVersion: record.sourceVersion,

    logs: record.logs,

    usage: record.usage,

    progress: record.progress ?? null,

    error: record.error,

    websiteJobId: record.websiteJobId,

    updatedAt: record.updatedAt,

  };

}


