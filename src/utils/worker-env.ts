import { getStorageBackend, isStorageConfigured } from "./storage/index.ts";
import { isRenderQueueConfigured } from "../render-queue-db.ts";

export type WorkerEnvIssueLevel = "error" | "warning";

export type WorkerEnvIssue = {
  level: WorkerEnvIssueLevel;
  message: string;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function isTruthyEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function collectWorkerEnvIssues(): WorkerEnvIssue[] {
  const issues: WorkerEnvIssue[] = [];
  const storageBackend = getStorageBackend();

  if (!process.env.STORAGE_BACKEND?.trim()) {
    issues.push({
      level: "warning",
      message:
        "STORAGE_BACKEND is unset; inferring from R2/Supabase env. Set STORAGE_BACKEND explicitly (e.g. r2-only) and match Vercel.",
    });
  }

  if (!isStorageConfigured()) {
    issues.push({
      level: "error",
      message: `Storage is not configured for STORAGE_BACKEND=${storageBackend}. Set matching R2_* or SUPABASE_* vars.`,
    });
  }

  if (!isRenderQueueConfigured()) {
    issues.push({
      level: "error",
      message:
        "DATABASE_URL is unset; Postgres queue worker will not start. Use the Supabase session pooler on port 5432 (not 6543).",
    });
  }

  if (!process.env.WEBSITE_CALLBACK_URL?.trim()) {
    issues.push({
      level: "error",
      message:
        "WEBSITE_CALLBACK_URL is unset; completed jobs will not notify the website.",
    });
  }

  if (!process.env.RENDER_CALLBACK_TOKEN?.trim()) {
    issues.push({
      level: "error",
      message:
        "RENDER_CALLBACK_TOKEN is unset; website callback route returns 503 until this matches Vercel.",
    });
  }

  if (isProduction() && !process.env.RENDER_WORKER_TOKEN?.trim()) {
    issues.push({
      level: "error",
      message:
        "RENDER_WORKER_TOKEN is required in production but is unset; /jobs and /render return 503.",
    });
  }

  if (isTruthyEnv("RENDER_HTTP_JOBS") && isRenderQueueConfigured()) {
    issues.push({
      level: "warning",
      message:
        "RENDER_HTTP_JOBS=1 with DATABASE_URL set can double-schedule jobs. Leave unset for queue-poller-only mode.",
    });
  }

  const ttsProvider = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (ttsProvider === "elevenlabs" || ttsProvider === "11labs") {
    if (!process.env.ELEVENLABS_API_KEY?.trim()) {
      issues.push({
        level: "error",
        message: "TTS_PROVIDER=elevenlabs requires ELEVENLABS_API_KEY.",
      });
    }
    if (!process.env.ELEVENLABS_TTS_MODEL?.trim()) {
      issues.push({
        level: "error",
        message: "TTS_PROVIDER=elevenlabs requires ELEVENLABS_TTS_MODEL.",
      });
    }
  }

  if (storageBackend === "supabase" && process.env.R2_PRIVATE_BUCKET?.trim()) {
    issues.push({
      level: "warning",
      message:
        "R2_PRIVATE_BUCKET is set but STORAGE_BACKEND resolves to supabase. Website may upload to R2 while the worker reads Supabase.",
    });
  }

  return issues;
}

export function logWorkerEnvIssues(issues: WorkerEnvIssue[]): void {
  for (const issue of issues) {
    const prefix =
      issue.level === "error"
        ? "Worker env error:"
        : "Worker env warning:";
    console.warn(`${prefix} ${issue.message}`);
  }
}

export function getWorkerHealthSnapshot(): {
  ok: boolean;
  storageBackend: string;
  storageConfigured: boolean;
  queueConfigured: boolean;
  callbackConfigured: boolean;
  workerAuthConfigured: boolean;
  issues: WorkerEnvIssue[];
} {
  const issues = collectWorkerEnvIssues();
  const hasErrors = issues.some((issue) => issue.level === "error");

  return {
    ok: !hasErrors,
    storageBackend: getStorageBackend(),
    storageConfigured: isStorageConfigured(),
    queueConfigured: isRenderQueueConfigured(),
    callbackConfigured: Boolean(
      process.env.WEBSITE_CALLBACK_URL?.trim() &&
        process.env.RENDER_CALLBACK_TOKEN?.trim(),
    ),
    workerAuthConfigured: Boolean(process.env.RENDER_WORKER_TOKEN?.trim()),
    issues: issues.map(({ level, message }) => ({ level, message })),
  };
}
