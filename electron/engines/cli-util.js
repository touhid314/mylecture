import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
export function spawnLines(file, args, { cwd, stdin, onLine, onStderr, signal, env } = {}) {
  return new Promise((resolve, reject) => {
    const isShim = /\.(cmd|bat)$/i.test(file);
    const child = isShim
      ? spawn(`"${file}" ${args.map(winQuote).join(" ")}`, { cwd, shell: true, env: env || process.env, windowsHide: true })
      : spawn(file, args, { cwd, env: env || process.env, windowsHide: true });
    let out = "";
    let err = "";
    const kill = () => killTree(child);
    if (signal) {
      if (signal.aborted) kill();
      signal.addEventListener("abort", kill, { once: true });
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      out += d;
      let i;
      while ((i = out.indexOf("\n")) !== -1) {
        const line = out.slice(0, i).replace(/\r$/, "");
        out = out.slice(i + 1);
        if (line.trim()) onLine?.(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      err += d;
      onStderr?.(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (out.trim()) onLine?.(out.trim());
      signal?.removeEventListener?.("abort", kill);
      resolve({ code, stderr: err, aborted: !!signal?.aborted });
    });
    if (stdin != null) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
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
    const isShim = /\.(cmd|bat)$/i.test(file);
    const cb = (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || ""), error });
    if (isShim) execFile(`"${file}" ${args.map(winQuote).join(" ")}`, { timeout, cwd, shell: true, windowsHide: true }, cb);
    else execFile(file, args, { timeout, cwd, windowsHide: true }, cb);
  });
}
