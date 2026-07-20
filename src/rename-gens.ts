/**
 * rename-gens.ts
 * Summer 2026, Touhidul Islam
 *
 * Renames generation folders under gens/ that still carry their raw
 * default ID (e.g. "19-05-22-26-06-2026-t0gdx1") to "<id>-<title>",
 * using the title/name recorded in that folder's metadata.json.
 * Folders already renamed (anything beyond the bare ID) are left alone.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const gensDir = path.join(rootDir, 'gens');

// Matches the default generator ID format: HH-MM-SS-DD-MM-YYYY-<random suffix>
const DEFAULT_ID_PATTERN = /^\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{4}-[a-z0-9]+$/;

// Characters not allowed in Windows folder names.
const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function sanitizeName(raw: string): string {
  return raw
    .replace(INVALID_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows disallows trailing dots/spaces
}

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
let skippedCollision = 0;

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

  const sanitized = sanitizeName(rawName);
  if (!sanitized) {
    console.warn(`Skip (name sanitized to empty): ${folderName}`);
    skippedNoName++;
    continue;
  }

  const newFolderName = `${folderName}-${sanitized}`;
  const newFolderPath = path.join(gensDir, newFolderName);

  if (fs.existsSync(newFolderPath)) {
    console.warn(`Skip (target already exists): ${folderName} -> ${newFolderName}`);
    skippedCollision++;
    continue;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}${folderName} -> ${newFolderName}`);
  if (!dryRun) {
    fs.renameSync(folderPath, newFolderPath);
  }
  renamed++;
}

console.log('\nDone.');
console.log(`  Renamed: ${renamed}`);
console.log(`  Skipped (not a default ID folder): ${skippedNotDefaultId}`);
console.log(`  Skipped (no metadata.json): ${skippedNoMetadata}`);
console.log(`  Skipped (no name/title in metadata): ${skippedNoName}`);
console.log(`  Skipped (target name collision): ${skippedCollision}`);
if (dryRun) {
  console.log('\nThis was a dry run. Re-run without --dry-run to apply changes.');
}
