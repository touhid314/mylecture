/**
 * rename-gens.ts
 * Summer 2026, Touhidul Islam
 *
 * Renames generation folders under gens/ that still carry their raw
 * default ID (e.g. "19-05-22-26-06-2026-t0gdx1") to "<title>",
 * using the title/name recorded in that folder's metadata.json.
 * On collision (case-insensitive), uses "<title> (2)", "<title> (3)", ...
 * Folders already renamed (anything beyond the bare ID) are left alone.
 *
 * Does not check for in-flight IDE render/resolve jobs — run when the IDE is idle.
 * Sanitize/allocate rules match ide-server via session-folder-name.ts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_ID_PATTERN,
  allocateFolderName,
  sanitizeTitle,
} from './session-folder-name.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const gensDir = path.join(rootDir, 'gens');

const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(gensDir)) {
  console.error(`Error: gens directory not found at ${gensDir}`);
  process.exit(1);
}

const entries = fs.readdirSync(gensDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory());

let renamed = 0;
let skippedNotDefaultId = 0;
let skippedNoMetadata = 0;
let skippedNoName = 0;
let collisionSuffixUsed = 0;

// Seed from the initial listing so dry-run / same-batch duplicates see occupied names
// without readdir-per-candidate. allocateFolderName also checks disk and claims winners.
const occupiedLower = new Set(entries.map((entry) => entry.name.toLowerCase()));

for (const entry of entries) {
  const folderName = entry.name;

  if (!DEFAULT_ID_PATTERN.test(folderName)) {
    skippedNotDefaultId++;
    continue;
  }

  const folderPath = path.join(gensDir, folderName);
  const metadataPath = path.join(folderPath, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    console.warn(`Skip (no metadata.json): ${folderName}`);
    skippedNoMetadata++;
    continue;
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (err) {
    console.warn(`Skip (invalid metadata.json): ${folderName} - ${(err as Error).message}`);
    skippedNoMetadata++;
    continue;
  }

  const rawName = (metadata.name ?? metadata.title) as string | undefined;
  if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
    console.warn(`Skip (no name/title field): ${folderName}`);
    skippedNoName++;
    continue;
  }

  const desiredName = sanitizeTitle(rawName);
  if (!desiredName) {
    console.warn(`Skip (name sanitized to empty/reserved): ${folderName}`);
    skippedNoName++;
    continue;
  }

  // Idempotent: pattern-shaped titles still match DEFAULT_ID_PATTERN after rename.
  if (desiredName.toLowerCase() === folderName.toLowerCase()) {
    console.log(`Already named: ${folderName}`);
    continue;
  }

  const newFolderName = allocateFolderName(gensDir, desiredName, occupiedLower);
  if (newFolderName !== desiredName) {
    collisionSuffixUsed++;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}${folderName} -> ${newFolderName}`);
  if (!dryRun) {
    fs.renameSync(folderPath, path.join(gensDir, newFolderName));
  }
  renamed++;
}

console.log('\nDone.');
console.log(`  Renamed: ${renamed}`);
console.log(`  Skipped (not a default ID folder): ${skippedNotDefaultId}`);
console.log(`  Skipped (no metadata.json): ${skippedNoMetadata}`);
console.log(`  Skipped (no name/title in metadata): ${skippedNoName}`);
if (collisionSuffixUsed > 0) {
  console.log(
    `  Note: ${collisionSuffixUsed} rename(s) used a collision counter suffix (e.g. "Title (2)").`
  );
}
if (dryRun) {
  console.log('\nThis was a dry run. Re-run without --dry-run to apply changes.');
}
