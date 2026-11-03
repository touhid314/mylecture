import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

test("Electron boots, initializes services, and shuts down cleanly", async () => {
  await new Promise((resolve, reject) => {
    const child = spawn("npx.cmd", ["electron", ".", "--smoke-test"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout waiting for Electron smoke test"));
    }, 25000);

    child.on("close", (code) => {
      clearTimeout(timer);
      assert.ok(stdout.includes("SMOKE_TEST_OK"), "Expected SMOKE_TEST_OK in stdout");
      assert.equal(code, 0, `Expected exit code 0, got ${code}`);
      resolve();
    });
  });
});
