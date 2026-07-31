/**
 * Shared session-folder naming: sanitize lecture titles and allocate
 * collision-safe folder names (`Title`, `Title (2)`, …).
 *
 * Used by ide-server (live rename + MP4 naming) and rename-gens (catch-up CLI).
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Matches the default generator ID format: HH-MM-SS-DD-MM-YYYY-<random suffix> */
export const DEFAULT_ID_PATTERN = /^\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{4}-[a-z0-9]+$/;

const INVALID_TITLE_CHARS = /[<>:"/\\|?*~\x00-\x1F]/g;
const WINDOWS_RESERVED_TITLE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Sanitize a lecture title for use as a folder or MP4 basename.
 * Windows-invalid chars and `~` stripped (`~` is the scene-suffix delimiter in
 * titled MP4 names), reserved device names → '', word-aware 80-char cap,
 * '' for empty/unusable.
 */
export function sanitizeTitle(raw: unknown): string {
  if (raw == null || typeof raw !== 'string') return '';
  let sanitized = raw
    .replace(INVALID_TITLE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (sanitized.length > 80) {
    const sliced = sanitized.slice(0, 80);
    const lastSpace = sliced.lastIndexOf(' ');
    sanitized = (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).replace(/[. ]+$/, '');
  }
  if (!sanitized || WINDOWS_RESERVED_TITLE.test(sanitized)) return '';
  return sanitized;
}

function siblingNameTaken(parentDir: string, candidateName: string): boolean {
  const target = candidateName.toLowerCase();
  try {
    for (const name of readdirSync(parentDir)) {
      if (name.toLowerCase() === target) return true;
    }
  } catch {
    // Fall through to existsSync.
  }
  return existsSync(path.join(parentDir, candidateName));
}

/**
 * First free name: `<base>`, then `<base> (2)`, `<base> (3)`, ...
 * Case-insensitive. When `occupiedLower` is provided (CLI batch mode), checks
 * the set AND disk; when absent (server single rename), checks disk only.
 * Always adds the winning name to `occupiedLower` when provided.
 */
export function allocateFolderName(
  parentDir: string,
  baseName: string,
  occupiedLower?: Set<string>
): string {
  const isTaken = (candidateName: string): boolean => {
    const target = candidateName.toLowerCase();
    if (occupiedLower?.has(target)) return true;
    return siblingNameTaken(parentDir, candidateName);
  };

  const claim = (name: string): string => {
    occupiedLower?.add(name.toLowerCase());
    return name;
  };

  if (!isTaken(baseName)) return claim(baseName);
  for (let n = 2; ; n++) {
    const candidate = `${baseName} (${n})`;
    if (!isTaken(candidate)) return claim(candidate);
  }
}
