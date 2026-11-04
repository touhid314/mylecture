import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const AUDIO_KEY = /^[A-Za-z0-9_-]+$/;

// Keep the HTML paired with resolved narration immutable while an agent may
// continue editing index files. Staying in the same folder preserves assets.
export function writePlaybackSnapshot(workspaceDir, file, html) {
  if (typeof file !== "string" || !/^index\d+\.html$/i.test(file) || path.basename(file) !== file) {
    throw new Error("Invalid playback scene filename.");
  }
  if (typeof html !== "string" || !html.trim()) throw new Error("Playback scene HTML is empty.");
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 24);
  const name = `.playback-${file.slice(0, -5)}-${hash}.html`;
  const target = path.join(workspaceDir, name);
  try { fs.writeFileSync(target, html, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST" || fs.readFileSync(target, "utf8") !== html) throw error;
  }
  return name;
}

export function isPlayableScene(scene, audioExists) {
  return Array.isArray(scene?.beats) && scene.beats.length > 0 && scene.beats.every(beat => {
    if (!Number.isFinite(beat?.dur) || beat.dur <= 0) return false;
    if (beat.visualOnly === true || beat.segment?.kind === "visual-only") return true;
    if (typeof beat.audio !== "string" || !AUDIO_KEY.test(beat.audio)) return false;
    try { return audioExists(beat.audio) === true; } catch { return false; }
  });
}

// Withhold the whole saved video: filtering individual scenes would change
// scene indices used by narration edits, selection and agent requests.
// The persisted scene records remain untouched so they can still be repaired.
export function gatePlayableLecture(lecture, audioExists) {
  if (!lecture) return lecture;
  const scenes = lecture.scenes || [];
  if (scenes.length && !scenes.every(scene => isPlayableScene(scene, audioExists))) {
    return { ...lecture, scenes: [], duration: 0, status: "partial", narrationPending: true };
  }
  return { ...lecture, narrationPending: false };
}

export function withAvailableNarration(lecture, cacheDir) {
  return gatePlayableLecture(lecture, key => {
    if (!cacheDir) return false;
    const file = fs.statSync(path.join(cacheDir, key + ".wav"));
    return file.isFile() && file.size > 44;
  });
}
