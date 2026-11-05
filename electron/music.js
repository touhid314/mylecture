// Background music declared by the agent in a project's metadata.json:
//   "music": "media/music.mp3"   (or { "file": "media/music.mp3" })
// The agent prepares the track (level, fades, length). The app does not
// change it: the player plays it as-is and exports mix it as-is under the
// narration, starting at 0 and cut at the end of the video.
import fs from "node:fs";
import path from "node:path";

export function normalizeMusic(spec) {
  const file = typeof spec === "string" ? spec : spec && typeof spec === "object" ? spec.file : null;
  if (typeof file !== "string" || !file.trim()) return null;
  return { file: file.trim().replace(/\\/g, "/") };
}

// The project's music with an absolute path, or null. The file must live in
// the project folder.
export function readMusic(projectDir) {
  if (!projectDir) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(projectDir, "metadata.json"), "utf8"));
  } catch {
    return null;
  }
  const m = normalizeMusic(meta?.music);
  if (!m) return null;
  const root = path.resolve(projectDir);
  const abs = path.resolve(root, m.file);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return { ...m, path: abs };
}

// ffmpeg pieces that add `music` to the narration input, unchanged.
// Returns the extra input args and a -filter_complex graph whose output is [aout].
export function musicMix(music, { narrationInput, musicInput }) {
  const fmt = "aformat=sample_rates=48000:channel_layouts=stereo";
  return {
    inputs: ["-i", music.path],
    graph: `[${narrationInput}:a]${fmt}[n];[${musicInput}:a]${fmt}[m];[n][m]amix=inputs=2:duration=first:normalize=0[aout]`,
  };
}
