// Launches the packaged app (from dist/) with --smoke-test and checks that it
// boots into the Create tab. Used by the release pipeline on every platform.
//   node scripts/smoke-packaged.mjs [--deep] [--models <dir>] [path-to-app-executable]
// --deep (or MYLECTURE_SMOKE_DEEP=1) also checks speech, ffmpeg and the scene checker.
// --models <dir> (or MYLECTURE_SMOKE_MODELS): run in a fresh profile whose
//   models/ is a copy of <dir> (from scripts/prefetch-models.mjs), so the
//   speech models aren't downloaded during the test.
// MYLECTURE_SMOKE_TIMEOUT: seconds per attempt (default 300 deep, 120 otherwise).
// A failure that looks like a download or a slow machine (a timeout, a network
// error, a truncated model) is retried once; any other failure fails at once.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRANSIENT = [
  /timed out/i,
  /Timeout \d+ms exceeded/i,
  /content-length/i,
  /fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i,
  /HTTP (429|5\d\d)/,
  /Protobuf parsing failed/i,
];

// Whether a failed attempt is worth one more try (vs. a broken build).
export function isTransientFailure(result) {
  const text = String(result || "");
  return !text.startsWith("SMOKE_TEST_OK") && TRANSIENT.some((re) => re.test(text));
}

export function parseArgs(argv, env = process.env) {
  const opts = { deep: !!env.MYLECTURE_SMOKE_DEEP, models: env.MYLECTURE_SMOKE_MODELS || "", exe: "", timeoutS: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--deep") opts.deep = true;
    else if (argv[i] === "--models") opts.models = argv[++i] || "";
    else opts.exe = argv[i];
  }
  opts.timeoutS = Number(env.MYLECTURE_SMOKE_TIMEOUT) || (opts.deep ? 300 : 120);
  return opts;
}

function findExecutable(dist) {
  if (process.platform === "win32") return path.join(dist, "win-unpacked", "MyLecture.exe");
  if (process.platform === "darwin") {
    for (const dir of ["mac-arm64", "mac", "mac-universal"]) {
      const exe = path.join(dist, dir, "MyLecture.app", "Contents", "MacOS", "MyLecture");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return path.join(dist, "linux-unpacked", "mylecture");
}

// One launch of the app; resolves with the result line ("" if none).
function runOnce(exe, opts, attempt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-smoke-"));
  const out = path.join(tmp, "result.txt");
  const env = { ...process.env, MYLECTURE_SMOKE_OUT: out };
  if (opts.deep) env.MYLECTURE_SMOKE_DEEP = "1";
  if (opts.models) {
    // A fresh profile each attempt, so a model the app cleared after a failed
    // load is restored from the verified copy.
    const profile = path.join(tmp, "profile");
    fs.cpSync(opts.models, path.join(profile, "models"), { recursive: true });
    env.MYLECTURE_PROFILE = profile;
  }
  console.log(`Launching ${exe} (attempt ${attempt}, ${opts.timeoutS}s limit${opts.models ? ", prefetched models" : ""})`);
  return new Promise((resolve) => {
    const child = spawn(exe, ["--smoke-test"], { env, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, result: `Smoke test timed out after ${opts.timeoutS}s` });
    }, opts.timeoutS * 1000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const result = fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim() : "";
      resolve({ code, result: result || `(no result written; exit code ${code})` });
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const exe = opts.exe || findExecutable(path.resolve("dist"));
  if (!fs.existsSync(exe)) {
    console.error(`Packaged app not found: ${exe}`);
    process.exit(1);
  }
  if (opts.models && !fs.existsSync(opts.models)) {
    console.error(`Models folder not found: ${opts.models}`);
    process.exit(1);
  }
  for (let attempt = 1; ; attempt++) {
    const { code, result } = await runOnce(exe, opts, attempt);
    console.log(result);
    if (result.startsWith("SMOKE_TEST_OK") && code === 0) process.exit(0);
    if (attempt >= 2 || !isTransientFailure(result)) process.exit(1);
    console.log("SMOKE_TEST_RETRY: that looks like a download problem or a slow runner, not a broken build; trying once more.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
