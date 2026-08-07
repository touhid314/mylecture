import type { LectureGenJobRecord, LectureGenUsage } from "./types.ts";

export type LectureGenCallbackPayload = {
  type: "lecturegen";
  jobId: string;
  generationId: string;
  sourceVersion: number;
  status: "source_ready" | "failed";
  usage?: LectureGenUsage | null;
  meteringOperationId?: string | null;
  error?: string;
  interactiveReady?: boolean;
  gameReady?: boolean;
  idempotencyKey: string;
  timestamp: string;
};

export function resolveMeteringOperationId(
  record: Pick<LectureGenJobRecord, "createRequest" | "lastEditRequest">,
): string | null {
  const editId = record.lastEditRequest?.meteringOperationId?.trim();
  if (editId) return editId;
  const createId = record.createRequest?.meteringOperationId?.trim();
  return createId || null;
}

const CALLBACK_FETCH_TIMEOUT_MS = 15_000;

export function resolveLectureGenCallbackUrl(): string | null {
  const explicit = process.env.LECTUREGEN_CALLBACK_URL?.trim();
  if (explicit) return explicit;

  const websiteCallback = process.env.WEBSITE_CALLBACK_URL?.trim();
  if (!websiteCallback) return null;

  if (/\/callback\/?$/i.test(websiteCallback)) {
    return websiteCallback.replace(/\/callback\/?$/i, "/lecturegen-callback");
  }

  return `${websiteCallback.replace(/\/$/, "")}/lecturegen-callback`;
}

function callbackHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.RENDER_CALLBACK_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postLectureGenCallback(
  payload: LectureGenCallbackPayload,
): Promise<boolean> {
  const url = resolveLectureGenCallbackUrl();
  if (!url) {
    console.warn(
      "LECTUREGEN_CALLBACK_URL/WEBSITE_CALLBACK_URL unset; skipping LectureGen callback for",
      payload.generationId,
    );
    return false;
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
        headers: callbackHeaders(),
        body,
        signal: controller.signal,
      });
      if (response.ok) {
        return true;
      }
      console.warn(
        `LectureGen callback attempt ${attempt + 1} failed for ${payload.generationId}: HTTP ${response.status}`,
      );
    } catch (error) {
      console.warn(
        `LectureGen callback attempt ${attempt + 1} failed for ${payload.generationId}:`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return false;
}

export function buildLectureGenCallbackPayload(opts: {
  websiteJobId: string;
  generationId: string;
  sourceVersion: number;
  status: "source_ready" | "failed";
  usage?: LectureGenUsage | null;
  meteringOperationId?: string | null;
  error?: string;
  interactiveReady?: boolean;
  gameReady?: boolean;
}): LectureGenCallbackPayload {
  return {
    type: "lecturegen",
    jobId: opts.websiteJobId,
    generationId: opts.generationId,
    sourceVersion: opts.sourceVersion,
    status: opts.status,
    usage: opts.usage ?? null,
    meteringOperationId: opts.meteringOperationId ?? null,
    error: opts.error,
    interactiveReady: opts.interactiveReady,
    gameReady: opts.gameReady,
    idempotencyKey: `${opts.generationId}:v${opts.sourceVersion}:${opts.status}`,
    timestamp: new Date().toISOString(),
  };
}
