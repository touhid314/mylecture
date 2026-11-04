function eventsUrl(base) {
  if (typeof base !== "string" || !base.trim()) return null;
  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/+$/, "") + "/v1/events";
    return url.href;
  } catch { return null; }
}

export const isTelemetryConfigured = endpoint => !!eventsUrl(endpoint);

// Launches that must never be counted: source/dev runs, automated tests and CI.
export function launchPingSuppressed({ isPackaged = false, argv = [], env = {} } = {}) {
  return !isPackaged || argv.includes("--dev") || argv.includes("--smoke-test") ||
    !!env.MYLECTURE_PROFILE || !!env.CI;
}

// One anonymous "the app launched" ping per launch: app version and OS only.
// No identifier of any kind, no retries, no disk queue, nothing after launch.
export async function sendLaunchPing({
  endpoint = "", version = "", platform = process.platform,
  enabled = true, fetchImpl = globalThis.fetch, timeoutMs = 5000,
} = {}) {
  const url = eventsUrl(endpoint);
  if (!url || !enabled) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema: 1, version, platform }),
      signal: controller.signal, credentials: "omit", redirect: "error",
      cache: "no-store", referrerPolicy: "no-referrer",
    });
    try { await response.body?.cancel(); } catch {}
    return response.ok;
  } catch {
    // Statistics must never interrupt app use, including while offline.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
