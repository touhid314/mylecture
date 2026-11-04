import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "../logger.js";

// Locate a CLI on PATH (plus common Windows install locations).
export function findExecutable(names, extraDirs = []) {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const dirs = [...(process.env.PATH || "").split(path.delimiter), ...extraDirs].filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const p = path.join(dir, name + ext);
        try {
          if (fs.statSync(p).isFile()) return p;
        } catch {}
      }
    }
  }
  return null;
}

// A scratch working directory for agent CLIs: empty, so the agent has
// nothing to explore and answers straight away.
export function scratchDir(name) {
  const dir = path.join(os.tmpdir(), "mylecture-engine", name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Spawn a CLI and call onLine for every stdout line. Resolves with exit info.
// .cmd shims on Windows require a shell; we quote arguments ourselves.
export function spawnLines(file, args, { cwd, stdin, keepStdin = false, onStdin, onLine, onStderr, onIdle, signal, env, heartbeatMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const command = path.basename(file);
    const isShim = /\.(cmd|bat)$/i.test(file);
    const child = isShim
      ? spawn(`"${file}" ${args.map(winQuote).join(" ")}`, { cwd, shell: true, env: env || process.env, windowsHide: true })
      : spawn(file, args, { cwd, env: env || process.env, windowsHide: true });
    let out = "";
    let err = "";
    let lastOutputAt = startedAt, stdoutBytes = 0, stderrBytes = 0, lines = 0, settled = false;
    log("info", "cli.start", { command, pid: child.pid, inputBytes: Buffer.byteLength(stdin || "") });
    const heartbeat = setInterval(() => {
      const idleMs = Date.now() - lastOutputAt;
      log("info", "cli.heartbeat", { command, pid: child.pid, elapsedMs: Date.now() - startedAt, idleMs, stdoutBytes, stderrBytes, lines });
      if (idleMs >= 45000) onIdle?.({ idleMs, elapsedMs: Date.now() - startedAt });
    }, heartbeatMs);
    heartbeat.unref?.();
    const cleanup = () => { clearInterval(heartbeat); signal?.removeEventListener?.("abort", kill); };
    const kill = () => { log("warn", "cli.abort", { command, pid: child.pid, elapsedMs: Date.now() - startedAt }); killTree(child); };
    if (signal) {
      if (signal.aborted) kill();
      signal.addEventListener("abort", kill, { once: true });
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      lastOutputAt = Date.now(); stdoutBytes += Buffer.byteLength(d);
      out += d;
      let i;
      while ((i = out.indexOf("\n")) !== -1) {
        const line = out.slice(0, i).replace(/\r$/, "");
        out = out.slice(i + 1);
        if (line.trim()) { lines++; onLine?.(line); }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      lastOutputAt = Date.now(); stderrBytes += Buffer.byteLength(d);
      err = (err + d).slice(-65536);
      log("warn", "cli.stderr", { command, pid: child.pid, chunkBytes: Buffer.byteLength(d), totalBytes: stderrBytes });
      onStderr?.(d);
    });
    child.on("error", (error) => { if (settled) return; settled = true; cleanup(); log("error", "cli.error", { command, pid: child.pid, code: error.code, message: error.message }); reject(error); });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      log(code === 0 || signal?.aborted ? "info" : "error", "cli.exit", { command, pid: child.pid, code, aborted: !!signal?.aborted, elapsedMs: Date.now() - startedAt, stdoutBytes, stderrBytes, lines });
      if (out.trim()) onLine?.(out.trim());
      resolve({ code, stderr: err, aborted: !!signal?.aborted });
    });
    if (stdin != null) {
      child.stdin.write(stdin);
    }
    // keepStdin: the caller writes more input later and ends it itself.
    if (keepStdin) {
      child.stdin.on("error", () => {});
      onStdin?.({
        write: (data) => (child.stdin.writable ? (child.stdin.write(data), true) : false),
        end: () => { if (child.stdin.writable) child.stdin.end(); },
      });
    } else child.stdin.end();
  });
}

function winQuote(a) {
  if (/^[\w\-.=:/\\]+$/.test(a)) return a;
  return `"${String(a).replace(/"/g, '\\"')}"`;
}

export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
  } else {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

export function runCapture(file, args, { timeout = 30000, cwd } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const command = path.basename(file);
    log("debug", "cli.check.start", { command, timeoutMs: timeout });
    const isShim = /\.(cmd|bat)$/i.test(file);
    const cb = (error, stdout, stderr) => {
      log(error ? "warn" : "debug", "cli.check.finish", { command, ok: !error, elapsedMs: Date.now() - startedAt, stdoutBytes: Buffer.byteLength(stdout || ""), stderrBytes: Buffer.byteLength(stderr || ""), code: error?.code, timedOut: !!error?.killed });
      resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || ""), error });
    };
    if (isShim) execFile(`"${file}" ${args.map(winQuote).join(" ")}`, { timeout, cwd, shell: true, windowsHide: true }, cb);
    else execFile(file, args, { timeout, cwd, windowsHide: true }, cb);
  });
}
