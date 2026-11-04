// Local diagnostics only. No network transport, prompt bodies or credentials.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const REDACTED = "[REDACTED]";
const PRIVATE_FIELD = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|proxy[_-]?authorization|password|passwd|cookie|set[_-]?cookie|secret|client[_-]?secret|email|prompt|user|system|content|text|messages|attachments|thinking|reasoning)$/i;
const secrets = new Set();
const listeners = new Set();
let config = null;

const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;

/** Register a configured credential before an operation can include it in an error. */
export function registerLogSecret(value) {
  if (typeof value !== "string" || value.length < 4 || value.length > 4096) return;
  if (secrets.size >= 128) secrets.delete(secrets.values().next().value);
  secrets.add(value);
}

function cleanString(value) {
  let text = String(value).slice(0, 16384);
  for (const secret of secrets) text = text.split(secret).join(REDACTED);
  text = text
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => {
      try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch { return "[URL]"; }
    })
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|secret|token)["']?\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, match => `${match.split(/[=:]/, 1)[0]}=${REDACTED}`)
    .replace(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}\b/gi, REDACTED);
  return text.length > 2048 ? text.slice(0, 2048) + "…[truncated]" : text;
}

/** Whitelist the useful shape of arbitrary details and redact private fields. */
export function sanitizeLogValue(value) {
  const visited = new WeakSet();
  function clean(item, depth = 0) {
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") return cleanString(item);
    if (typeof item === "number") return Number.isFinite(item) ? item : String(item);
    if (typeof item === "bigint") return String(item);
    if (item === undefined) return null;
    if (typeof item !== "object") return `[${typeof item}]`;
    if (visited.has(item)) return "[Circular]";
    if (depth >= 6) return "[Depth limit]";
    visited.add(item);
    if (item instanceof Error) {
      const result = { name: cleanString(item.name), message: cleanString(item.message), stack: cleanString(item.stack || "") };
      if (item.code !== undefined) result.code = clean(item.code, depth + 1);
      if (item.cause !== undefined) result.cause = clean(item.cause, depth + 1);
      return result;
    }
    if (item instanceof Date) return Number.isNaN(item.getTime()) ? "Invalid Date" : item.toISOString();
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return "[Binary omitted]";
    if (Array.isArray(item)) {
      const result = item.slice(0, 24).map(entry => clean(entry, depth + 1));
      if (item.length > 24) result.push("[Items truncated]");
      return result;
    }
    const result = {};
    const keys = Object.keys(item).slice(0, 40);
    for (const key of keys) {
      try {
        // Define directly so hostile __proto__ keys cannot change the output.
        Object.defineProperty(result, cleanString(key).slice(0, 128), {
          value: PRIVATE_FIELD.test(key) ? REDACTED : clean(item[key], depth + 1), enumerable: true,
        });
      } catch { /* Diagnostics must not execute failing getters twice. */ }
    }
    if (Object.keys(item).length > 40) result._truncated = true;
    return result;
  }
  try { return clean(value); } catch { return "[Unserializable details]"; }
}

export function configureLogger({ directory, maxBytes = 2 * 1024 * 1024, maxFiles = 5 } = {}) {
  config = null;
  if (typeof directory !== "string" || !directory.trim()) return getLogInfo();
  try {
    const target = path.resolve(directory);
    fs.mkdirSync(target, { recursive: true });
    config = {
      directory: target, file: path.join(target, "app.log"), runId: randomUUID(),
      maxBytes: bounded(maxBytes, 2 * 1024 * 1024, 512, 50 * 1024 * 1024),
      maxFiles: bounded(maxFiles, 5, 1, 20),
    };
    // A lower retention setting also bounds files from an older configuration.
    for (const name of fs.readdirSync(target)) {
      const index = /^app\.(\d+)\.log$/.exec(name)?.[1];
      if (index !== undefined && Number(index) >= config.maxFiles) fs.rmSync(path.join(target, name), { force: true });
    }
  } catch { /* Logging is best effort if the disk is unavailable. */ }
  return getLogInfo();
}

export function getLogInfo() {
  return { directory: config?.directory || null, file: config?.file || null };
}

/** Stream successfully persisted, sanitized JSON lines to a local viewer. */
export function onLogEntry(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function rotate(incomingBytes) {
  let currentSize = 0;
  try { currentSize = fs.statSync(config.file).size; } catch {}
  if (!currentSize || currentSize + incomingBytes <= config.maxBytes) return;
  const rotated = index => path.join(config.directory, `app.${index}.log`);
  if (config.maxFiles === 1) { fs.rmSync(config.file, { force: true }); return; }
  fs.rmSync(rotated(config.maxFiles - 1), { force: true });
  for (let index = config.maxFiles - 2; index >= 1; index--) {
    if (fs.existsSync(rotated(index))) fs.renameSync(rotated(index), rotated(index + 1));
  }
  fs.renameSync(config.file, rotated(1));
}

export function log(level, event, details = {}) {
  if (!config) return;
  try {
    const entry = {
      timestamp: new Date().toISOString(), runId: config.runId,
      level: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
      event: cleanString(event || "app.event").slice(0, 160), details: sanitizeLogValue(details),
    };
    let line = JSON.stringify(entry) + "\n";
    if (Buffer.byteLength(line) > Math.min(8192, config.maxBytes)) {
      entry.details = { truncated: true, summary: JSON.stringify(entry.details).slice(0, 1200) };
      line = JSON.stringify(entry) + "\n";
      if (Buffer.byteLength(line) > Math.min(8192, config.maxBytes)) {
        entry.details = { truncated: true };
        line = JSON.stringify(entry) + "\n";
        if (Buffer.byteLength(line) > Math.min(8192, config.maxBytes)) {
          entry.event = "app.event.truncated";
          line = JSON.stringify(entry) + "\n";
        }
      }
    }
    rotate(Buffer.byteLength(line));
    fs.appendFileSync(config.file, line, { encoding: "utf8", mode: 0o600 });
    for (const listener of listeners) {
      try { listener({ line }); } catch {}
    }
  } catch { /* Do not recurse into a failing logger or interrupt app work. */ }
}

export function readLogTail({ maxBytes = 128 * 1024 } = {}) {
  const result = { text: "", truncated: false, file: config?.file || null };
  if (!config) return result;
  let fd;
  try {
    fd = fs.openSync(config.file, "r");
    const size = fs.fstatSync(fd).size;
    const count = Math.min(size, bounded(maxBytes, 128 * 1024, 1, 1024 * 1024));
    const offset = size - count;
    const buffer = Buffer.alloc(count);
    const read = fs.readSync(fd, buffer, 0, count, offset);
    let text = buffer.subarray(0, read).toString("utf8");
    if (offset > 0) {
      const previous = Buffer.alloc(1);
      fs.readSync(fd, previous, 0, 1, offset - 1);
      if (previous[0] !== 10) text = text.slice(text.indexOf("\n") + 1 || text.length);
    }
    result.text = text;
    result.truncated = offset > 0;
  } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  return result;
}
