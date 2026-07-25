import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { getSourcesRoot, sourceManifestPath } from './paths.ts';
import { SLUG_RE } from './types.ts';

export type SourceSectionManifest = {
  id: string;
  title: string;
  file: string;
  pageStart: number;
  pageEnd: number;
  charCount: number;
};

export type SourceManifest = {
  slug: string;
  title: string;
  ingestedAt: string;
  pdfPath: string;
  sections: SourceSectionManifest[];
};

export type SourceListItem = {
  slug: string;
  title: string;
  sectionCount: number;
};

/**
 * List ingested sources under gens/sources/<slug>/source-manifest.json.
 * Skips underscore/dot dirs (e.g. _uploads) and unreadable manifests.
 */
export function listSources(): SourceListItem[] {
  const root = getSourcesRoot();
  if (!existsSync(root)) return [];

  const sources: SourceListItem[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (!SLUG_RE.test(entry.name)) continue;

    const manifestFile = sourceManifestPath(entry.name);
    if (!existsSync(manifestFile)) continue;

    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as SourceManifest;
      sources.push({
        slug: String(manifest.slug || entry.name).trim() || entry.name,
        title: String(manifest.title || entry.name).trim() || entry.name,
        sectionCount: Array.isArray(manifest.sections) ? manifest.sections.length : 0
      });
    } catch {
      // skip corrupt manifests
    }
  }

  return sources.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Reject empty, uppercase, path-segment, and traversal slugs before any
 * filesystem join under gens/sources/<slug>/.
 */
export function assertValidSourceSlug(slug: string): void {
  const trimmed = String(slug ?? '').trim();
  if (!trimmed || !SLUG_RE.test(trimmed)) {
    throw new Error(
      `invalid source slug "${slug}" (must be a lowercase hyphenated slug; path traversal rejected)`
    );
  }
}

/**
 * Read gens/sources/<slug>/source-manifest.json.
 * Kept separate from ingest-source.ts so callers (lecture prompts, planners)
 * do not pull in the pdfjs dependency.
 */
export function readSourceManifest(slug: string): SourceManifest {
  assertValidSourceSlug(slug);
  const filePath = sourceManifestPath(slug);
  if (!existsSync(filePath)) {
    throw new Error(
      `Source manifest not found: ${filePath}. Run: npm run coursegen -- ingest --pdf <path> --source ${slug}`
    );
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as SourceManifest;
}
