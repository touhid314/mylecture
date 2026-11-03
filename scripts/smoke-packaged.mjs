// Launches the packaged app (from dist/) with --smoke-test and checks that it
// boots into the Create tab. Used by the release pipeline on every platform.
//   node scripts/smoke-packaged.mjs [path-to-app-executable]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dist = path.resolve("dist");
function findExecutable() {
  if (process.argv[2]) return process.argv[2];
  if (process.platform === "win32") return path.join(dist, "win-unpacked", "MyLecture.exe");
  if (process.platform === "darwin") {
    for (const dir of ["mac-arm64", "mac", "mac-universal"]) {
      const exe = path.join(dist, dir, "MyLecture.app", "Contents", "MacOS", "MyLecture");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return path.join(dist, "linux-unpacked", "mylecture");
}

const exe = findExecutable();
if (!fs.existsSync(exe)) {
  console.error(`Packaged app not found: ${exe}`);
  process.exit(1);
}
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-smoke-")), "result.txt");
console.log(`Launching ${exe}`);
const child = spawn(exe, ["--smoke-test"], { env: { ...process.env, MYLECTURE_SMOKE_OUT: out }, stdio: "inherit" });
const timer = setTimeout(() => {
  console.error("Smoke test timed out after 120s");
  child.kill();
  process.exit(1);
}, 120000);
child.on("exit", (code) => {
  clearTimeout(timer);
  const result = fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim() : "";
  console.log(result || `(no result written; exit code ${code})`);
  process.exit(result.startsWith("SMOKE_TEST_OK") && code === 0 ? 0 : 1);
});
