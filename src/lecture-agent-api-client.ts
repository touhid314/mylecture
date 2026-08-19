import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_AGENT_API_URL = "http://127.0.0.1:4310";

type AgentJobKind = "generate" | "edit" | "resolve" | "render";

type AgentJob = {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  log: string;
  result?: any;
  error?: string;
};

function apiUrl(): string {
  return (process.env.MYLECTURE_AGENT_API_URL?.trim() || DEFAULT_AGENT_API_URL).replace(/\/$/, "");
}

function headers(): Record<string, string> {
  const token = process.env.MYLECTURE_AGENT_API_TOKEN?.trim();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function errorFor(response: Response, context: string): Promise<Error> {
  let detail = "";
  try {
    const body = await response.json() as { error?: string };
    detail = body.error ? `: ${body.error}` : "";
  } catch { }
  return new Error(`${context} (${response.status})${detail}`);
}

function networkErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  const causeText = cause
    ? [cause.code, cause.message].filter(Boolean).map(String).join(": ")
    : "";
  return causeText ? `${error.message} (${causeText})` : error.message;
}

async function fetchApi(path: string, init: RequestInit = {}, retryNetworkFailures = true): Promise<Response> {
  const method = String(init.method || "GET").toUpperCase();
  const maximumAttempts = retryNetworkFailures && method === "GET" ? 8 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    try {
      return await fetch(`${apiUrl()}${path}`, { ...init, headers: { ...headers(), ...init.headers } });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
      if (attempt < maximumAttempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, attempt * 200)));
      }
    }
  }
  const message = networkErrorMessage(lastError);
  const exitDetail = lastManagedAgentApiExit ? ` ${lastManagedAgentApiExit}` : "";
  throw new Error(`Cannot reach the MyLecture Agent API at ${apiUrl()}.${exitDetail} ${message}`);
}

async function runJob(
  kind: AgentJobKind,
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal; onLog?: (text: string) => void } = {},
): Promise<any> {
  const createdResponse = await fetchApi(`/v1/${kind}`, {
    method: "POST",
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  if (!createdResponse.ok) throw await errorFor(createdResponse, `Agent ${kind} request failed`);
  const { jobId } = await createdResponse.json() as { jobId: string };
  let seenLog = 0;

  const cancel = () => {
    void fetchApi(`/v1/jobs/${jobId}`, { method: "DELETE" }).catch(() => { });
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (options.signal?.aborted) throw new Error("Process stopped by user");
      const response = await fetchApi(`/v1/jobs/${jobId}`, { signal: options.signal });
      if (!response.ok) throw await errorFor(response, `Agent ${kind} status failed`);
      const job = await response.json() as AgentJob;
      if (job.log.length > seenLog) {
        options.onLog?.(job.log.slice(seenLog));
        seenLog = job.log.length;
      }
      if (job.status === "succeeded") return job.result;
      if (job.status === "failed") throw new Error(job.error || `Agent ${kind} job failed`);
      if (job.status === "cancelled") throw new Error("Process stopped by user");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}

export function generateLectureViaAgentApi(payload: Record<string, unknown>, options = {}) {
  return runJob("generate", payload, options);
}

export function editLectureViaAgentApi(payload: Record<string, unknown>, options = {}) {
  return runJob("edit", payload, options);
}

export function resolveViaAgentApi(payload: Record<string, unknown>, options = {}) {
  return runJob("resolve", payload, options);
}

export function renderViaAgentApi(payload: Record<string, unknown>, options = {}) {
  return runJob("render", payload, options);
}

export async function resetAgentApiSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const response = await fetchApi(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!response.ok) throw await errorFor(response, "Agent session reset failed");
}

export async function getAgentCatalog(): Promise<{
  profiles: Array<Record<string, string>>;
  themes: Array<Record<string, string>>;
  teachingStyles: Array<Record<string, string>>;
}> {
  const response = await fetchApi("/v1/catalog");
  if (!response.ok) throw await errorFor(response, "Agent catalog request failed");
  return response.json() as Promise<any>;
}

export type AgentSelectOption = {
  id: string;
  label: string;
  isDefault?: boolean;
};

export type AgentOptions = {
  defaults: {
    themeId: string;
    teachingStyleId: string;
    profileId: string;
  };
  themes: AgentSelectOption[];
  teachingStyles: AgentSelectOption[];
  profiles: AgentSelectOption[];
  tts: {
    defaults: { provider: string; voice: string };
    providers: Array<{
      id: string;
      label: string;
      kind: "local" | "cloud";
      configured: boolean;
      voices: AgentSelectOption[];
    }>;
  };
};

export async function getAgentOptions(): Promise<AgentOptions> {
  const response = await fetchApi("/v1/options");
  if (!response.ok) throw await errorFor(response, "Agent options request failed");
  return response.json() as Promise<AgentOptions>;
}

export async function checkAgentApiHealth(): Promise<void> {
  const response = await fetchApi("/health", {}, false);
  if (!response.ok) throw await errorFor(response, "Agent API health check failed");
}

let managedAgentApiProcess: ChildProcess | null = null;
let managedAgentApiStartup: Promise<void> | null = null;
let lastManagedAgentApiExit = "";
let stoppingManagedAgentApi = false;
let managedAgentApiRestartTimer: NodeJS.Timeout | null = null;

function scheduleManagedAgentApiRestart(options: { rootDir: string; envKeysToFilter?: Set<string> }): void {
  if (stoppingManagedAgentApi || managedAgentApiRestartTimer) return;
  managedAgentApiRestartTimer = setTimeout(() => {
    managedAgentApiRestartTimer = null;
    if (stoppingManagedAgentApi) return;
    void ensureAgentApiAvailable(options).catch((error) => {
      console.error(`Managed Agent API restart failed: ${error instanceof Error ? error.message : String(error)}`);
      scheduleManagedAgentApiRestart(options);
    });
  }, 1_000);
  managedAgentApiRestartTimer.unref();
}

export function stopManagedAgentApi(): void {
  stoppingManagedAgentApi = true;
  if (managedAgentApiRestartTimer) {
    clearTimeout(managedAgentApiRestartTimer);
    managedAgentApiRestartTimer = null;
  }
  if (managedAgentApiProcess?.exitCode === null) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(managedAgentApiProcess.pid), "/f", "/t"], { windowsHide: true });
    } else {
      managedAgentApiProcess.kill("SIGTERM");
    }
  }
  managedAgentApiProcess = null;
}

export async function ensureAgentApiAvailable(options: { rootDir: string; envKeysToFilter?: Set<string> }): Promise<void> {
  if (managedAgentApiStartup) return managedAgentApiStartup;
  managedAgentApiStartup = ensureAgentApiAvailableOnce(options).finally(() => {
    managedAgentApiStartup = null;
  });
  return managedAgentApiStartup;
}

async function ensureAgentApiAvailableOnce(options: { rootDir: string; envKeysToFilter?: Set<string> }): Promise<void> {
  try {
    await checkAgentApiHealth();
    return;
  } catch (initialError) {
    const url = apiUrl();
    const isLocal = url.includes("127.0.0.1") || url.includes("localhost");
    if (!isLocal) {
      throw initialError;
    }
  }

  const agentRepo = path.resolve(options.rootDir, "..", "mylecture-agent");
  const apiEntrypoint = path.join(agentRepo, "src", "api-server.ts");
  if (!existsSync(apiEntrypoint)) {
    throw new Error(`MyLecture Agent API was not reachable and its sibling repo was not found at ${agentRepo}.`);
  }
  console.log(`Starting MyLecture Agent API from ${agentRepo}...`);
  const agentEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !options.envKeysToFilter?.has(key) || key.startsWith("MYLECTURE_AGENT_API_")
    )
  );
  stoppingManagedAgentApi = false;
  lastManagedAgentApiExit = "";
  const child = spawn(process.execPath, ["--import", "tsx", "src/api-server.ts"], {
    cwd: agentRepo,
    env: agentEnvironment,
    stdio: "inherit",
    windowsHide: true,
  });
  managedAgentApiProcess = child;
  child.once("error", (error) => {
    lastManagedAgentApiExit = `The managed API process could not start: ${error.message}.`;
    console.error(lastManagedAgentApiExit);
  });
  child.once("exit", (code, signal) => {
    if (managedAgentApiProcess === child) managedAgentApiProcess = null;
    if (stoppingManagedAgentApi) return;
    lastManagedAgentApiExit = `The managed API process exited unexpectedly (code ${code ?? "none"}, signal ${signal ?? "none"}).`;
    console.error(lastManagedAgentApiExit);
    scheduleManagedAgentApiRestart(options);
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await checkAgentApiHealth();
      return;
    } catch {}
    if (child.exitCode !== null) break;
  }
  throw new Error(`MyLecture Agent API did not become ready.${lastManagedAgentApiExit ? ` ${lastManagedAgentApiExit}` : " Check the startup log above."}`);
}
