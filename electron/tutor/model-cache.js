// transformers.js caches downloaded models under <cacheDir>/<org>/<model>/.
// An interrupted download leaves a truncated file there, and every later load
// reads the same broken file, so a failed load clears the model's cache.
import fs from "node:fs";
import path from "node:path";

export function clearModelCache(cacheDir, model) {
  if (!cacheDir || !/^[\w.-]+\/[\w.-]+$/.test(String(model)) || String(model).split("/").some((p) => /^\.+$/.test(p))) return false;
  try { fs.rmSync(path.join(cacheDir, ...String(model).split("/")), { recursive: true, force: true }); return true; } catch { return false; }
}
