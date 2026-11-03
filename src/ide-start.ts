import { spawn } from "node:child_process";
import path from "node:path";
import { loadEnv } from "./coursegen/env.ts";

import {
  ensureAgentApiAvailable,
  stopManagedAgentApi,
} from "./lecture-agent-api-client.ts";

const rootDir = process.cwd();
// Provider configuration must reach the managed agent before it is spawned.
loadEnv(rootDir);

function runCommand(command: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code ?? "none"} (signal ${signal ?? "none"}).`));
    });
  });
}

async function runPreflight(): Promise<void> {
  await runCommand(
    process.execPath,
    ["--import", "tsx", path.join(rootDir, "src", "sync-versions.ts")],
    "Version sync",
  );
  await runCommand(
    process.execPath,
    [path.join(rootDir, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(rootDir, "packages", "lecture-viewer", "tsconfig.json")],
    "Lecture viewer build",
  );
}

try {
  await Promise.all([
    ensureAgentApiAvailable({ rootDir }),
    runPreflight(),
  ]);
  await import("./ide-server.ts");
} catch (error) {
  stopManagedAgentApi();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
