import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const THUMBNAIL_NAMES = ['thumbnail.jpg', 'thumbnail.jpeg', 'thumbnail.png'];
const MP4_PREFERENCE = ['final.mp4', 'rendered.mp4', 'preview.mp4'];

export function pickEarlyFrameSeconds(durationSeconds: number | null | undefined, maxEarlySeconds = 12): number {
  const duration = Number(durationSeconds);
  const maxSeek = Number.isFinite(duration) && duration > 0
    ? Math.max(0, duration - 0.1)
    : maxEarlySeconds;

  const start = Math.min(1.5, maxSeek);
  const end = Math.min(
    maxEarlySeconds,
    maxSeek,
    Number.isFinite(duration) && duration > 0 ? duration * 0.12 : maxEarlySeconds
  );
  const high = Math.max(start, end);
  return start + Math.random() * (high - start);
}

export function findExistingThumbnail(sourceDir: string): string | null {
  const names = readdirSync(sourceDir);
  for (const wanted of THUMBNAIL_NAMES) {
    const match = names.find(name => name.toLowerCase() === wanted);
    if (!match) continue;
    const fullPath = path.join(sourceDir, match);
    if (statSync(fullPath).isFile()) return fullPath;
  }
  return null;
}

export function findPrimaryMp4(sourceDir: string): string | null {
  const names = readdirSync(sourceDir).filter(name => name.toLowerCase().endsWith('.mp4'));
  for (const preferred of MP4_PREFERENCE) {
    const match = names.find(name => name.toLowerCase() === preferred);
    if (match) return path.join(sourceDir, match);
  }
  const rendered = names
    .filter(name => /^rendered.*\.mp4$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
  const chosen = rendered[0] || names[0];
  return chosen ? path.join(sourceDir, chosen) : null;
}

async function probeDurationSeconds(mp4Path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nk=1:nw=1',
      mp4Path
    ], { windowsHide: true });
    const duration = Number(String(stdout).trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

export async function captureVideoThumbnail(mp4Path: string, outputPath: string): Promise<number> {
  const duration = await probeDurationSeconds(mp4Path);
  const seekSeconds = pickEarlyFrameSeconds(duration);
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(seekSeconds),
    '-i', mp4Path,
    '-frames:v', '1',
    '-vf', "scale='min(1280,iw)':-2",
    '-q:v', '2',
    '-y',
    outputPath
  ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (!existsSync(outputPath)) {
    throw new Error(`ffmpeg did not write ${outputPath}`);
  }
  return seekSeconds;
}

/** Write thumbnail.jpg from a random early MP4 frame unless a thumbnail already exists. */
export async function ensureLectureThumbnail(sourceDir: string): Promise<{
  path: string;
  captured: boolean;
  seekSeconds?: number;
} | null> {
  const existing = findExistingThumbnail(sourceDir);
  if (existing) {
    return { path: existing, captured: false };
  }

  const mp4Path = findPrimaryMp4(sourceDir);
  if (!mp4Path) return null;

  const outputPath = path.join(sourceDir, 'thumbnail.jpg');
  const seekSeconds = await captureVideoThumbnail(mp4Path, outputPath);
  return { path: outputPath, captured: true, seekSeconds };
}
