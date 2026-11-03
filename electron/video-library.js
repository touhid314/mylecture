import fs from "node:fs";
import path from "node:path";

// Editable lessons stay in Study/Create. Only rendered files belong here.
export function listRenderedVideos(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp4")
      .flatMap((entry) => {
        try {
          const file = path.join(directory, entry.name);
          const stat = fs.statSync(file);
          return stat.size ? [{ file, title: path.basename(entry.name, path.extname(entry.name)), bytes: stat.size, updatedAt: stat.mtime.toISOString() }] : [];
        } catch { return []; }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
