import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getSourceDir, sourceManifestPath, sourceSectionsDir } from './paths.ts';
import type { SourceManifest, SourceSectionManifest } from './source-manifest.ts';
import { SLUG_RE } from './types.ts';

export type { SourceManifest, SourceSectionManifest } from './source-manifest.ts';

export type OutlineEntryLike = {
  title: string;
  dest?: unknown;
  items?: OutlineEntryLike[];
};

const CHAPTER_TITLE_RE = /^chapter\s+(\d+)\b/i;
/** Case-insensitive Chapter N detection in page text (multiline). */
const CHAPTER_PAGE_RE = /^chapter\s+(\d+)\b/im;

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'section';
}

export function parseChapterFilter(raw: string | undefined): Set<number> | null {
  if (!raw || !String(raw).trim()) return null;
  const text = String(raw).trim();
  const numbers = new Set<number>();

  for (const part of text.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        throw new Error(`Invalid chapter filter segment: "${token}" (expected N or N-M)`);
      }
      for (let n = start; n <= end; n++) numbers.add(n);
      continue;
    }
    const single = Number(token);
    if (!Number.isInteger(single) || single < 1) {
      throw new Error(`Invalid chapter filter segment: "${token}" (expected N or N-M)`);
    }
    numbers.add(single);
  }

  if (numbers.size === 0) {
    throw new Error(`Invalid chapter filter: "${text}"`);
  }
  return numbers;
}

export function selectTopLevelOutlineSections(outline: OutlineEntryLike[]): Array<{
  title: string;
  dest: unknown;
  chapterNumFromTitle: number | null;
}> {
  if (!Array.isArray(outline) || outline.length === 0) {
    return [];
  }

  const topLevel = outline
    .map(entry => ({
      title: String(entry?.title || '').trim(),
      dest: entry?.dest,
      chapterNumFromTitle: (() => {
        const match = String(entry?.title || '').trim().match(CHAPTER_TITLE_RE);
        return match ? Number(match[1]) : null;
      })()
    }))
    .filter(entry => entry.title);

  const chapterTitleEntries = topLevel.filter(entry => entry.chapterNumFromTitle != null);
  if (chapterTitleEntries.length > 0) {
    return chapterTitleEntries;
  }
  return topLevel;
}

export function computePageRanges(
  sections: Array<{ title: string; pageStart: number; chapterNum?: number | null }>,
  pageCount: number
): Array<{ title: string; pageStart: number; pageEnd: number; chapterNum: number | null }> {
  if (pageCount < 1) {
    throw new Error('PDF has no pages');
  }
  const sorted = [...sections]
    .map(section => ({
      title: section.title,
      pageStart: section.pageStart,
      chapterNum: section.chapterNum ?? null
    }))
    .filter(section => Number.isInteger(section.pageStart) && section.pageStart >= 1)
    .sort((a, b) => a.pageStart - b.pageStart || a.title.localeCompare(b.title));

  if (sorted.length === 0) {
    throw new Error('No outline sections with resolvable page destinations');
  }

  return sorted.map((section, index) => {
    const nextStart = sorted[index + 1]?.pageStart;
    const pageEnd = nextStart != null ? Math.max(section.pageStart, nextStart - 1) : pageCount;
    return {
      title: section.title,
      pageStart: section.pageStart,
      pageEnd,
      chapterNum: section.chapterNum
    };
  });
}

export function filterSectionsByChapter(
  sections: Array<{ title: string; pageStart: number; pageEnd: number; chapterNum: number | null }>,
  filter: Set<number> | null
) {
  if (!filter) return sections;

  const anyHaveNumbers = sections.some(section => section.chapterNum != null);
  const withNumbers = sections.map((section, index) => ({
    ...section,
    chapterNum: section.chapterNum ?? (anyHaveNumbers ? null : index + 1)
  }));

  const selected = withNumbers.filter(
    section => section.chapterNum != null && filter.has(section.chapterNum)
  );
  if (selected.length === 0) {
    const available = withNumbers
      .map(s => s.chapterNum)
      .filter((n): n is number => n != null)
      .join(', ');
    throw new Error(
      `No sections matched chapter filter ${[...filter].sort((a, b) => a - b).join(',')}. Available chapter numbers: ${available || '(none)'}`
    );
  }
  return selected;
}

export function extractChapterNumberFromText(text: string): number | null {
  const match = text.match(CHAPTER_PAGE_RE);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isInteger(num) && num >= 1 ? num : null;
}

export function pageTextItemsToMarkdown(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  const parts: string[] = [];
  let pendingSpace = false;

  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str && !item.hasEOL) continue;

    if (str) {
      if (pendingSpace && parts.length > 0 && !/\s$/.test(parts[parts.length - 1]) && !/^\s/.test(str)) {
        parts.push(' ');
      }
      parts.push(str);
      pendingSpace = !/\s$/.test(str);
    }

    if (item.hasEOL) {
      parts.push('\n');
      pendingSpace = false;
    }
  }

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sectionFileName(order: number, title: string) {
  const padded = String(order).padStart(2, '0');
  return `${padded}-${slugifyTitle(title)}.md`;
}

function sectionId(order: number, title: string) {
  const padded = String(order).padStart(2, '0');
  return `${padded}-${slugifyTitle(title)}`;
}

/**
 * Prefer chapter number from title/text for stable ids (so `--chapters 1-9`
 * keeps `01-…` through `09-…`). Falls back to 1-based filter order when no
 * chapter number is available.
 */
export function resolveSectionOrder(
  section: { title: string; chapterNum: number | null },
  filterIndex: number
): { order: number; usedFilterOrder: boolean } {
  if (section.chapterNum != null && Number.isInteger(section.chapterNum) && section.chapterNum >= 1) {
    return { order: section.chapterNum, usedFilterOrder: false };
  }
  return { order: filterIndex + 1, usedFilterOrder: true };
}

async function resolveOutlinePageNumber(
  doc: Awaited<ReturnType<typeof getDocument>['promise']>,
  dest: unknown
): Promise<number | null> {
  try {
    let explicit: unknown = dest;
    if (typeof dest === 'string') {
      explicit = await doc.getDestination(dest);
    } else if (Array.isArray(dest) && dest.length > 0) {
      explicit = dest;
    } else if (dest && typeof dest === 'object' && 'num' in (dest as object)) {
      // Rare: page ref embedded directly
      explicit = [dest];
    } else {
      return null;
    }

    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const pageRef = explicit[0];
    const pageIndex = await doc.getPageIndex(pageRef);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
    return pageIndex + 1;
  } catch {
    return null;
  }
}

async function extractChapterFallbackSections(
  doc: Awaited<ReturnType<typeof getDocument>['promise']>
): Promise<Array<{ title: string; pageStart: number; chapterNum: number }>> {
  const found: Array<{ title: string; pageStart: number; chapterNum: number }> = [];
  const seen = new Set<number>();

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = pageTextItemsToMarkdown(content.items as Array<{ str?: string; hasEOL?: boolean }>);
    const match = text.match(CHAPTER_PAGE_RE);
    if (!match) continue;
    const chapterNum = Number(match[1]);
    if (!Number.isInteger(chapterNum) || chapterNum < 1 || seen.has(chapterNum)) continue;
    seen.add(chapterNum);
    const titleLine = text
      .split(/\n/)
      .map(line => line.trim())
      .find(line => line.length > 0 && !/^Chapter\s+\d+\b/i.test(line));
    const title = titleLine || `Chapter ${chapterNum}`;
    found.push({ title, pageStart: pageNum, chapterNum });
  }

  return found;
}

async function extractPageText(
  doc: Awaited<ReturnType<typeof getDocument>['promise']>,
  pageStart: number,
  pageEnd: number
): Promise<string> {
  const chunks: string[] = [];
  for (let pageNum = pageStart; pageNum <= pageEnd; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = pageTextItemsToMarkdown(content.items as Array<{ str?: string; hasEOL?: boolean }>);
    if (text) chunks.push(text);
  }
  return chunks.join('\n\n').trim();
}

export type IngestSourceOptions = {
  pdfPath: string;
  source: string;
  chapters?: string;
  title?: string;
};

export async function ingestSource(options: IngestSourceOptions): Promise<SourceManifest> {
  const slug = String(options.source || '').trim();
  if (!slug) throw new Error('--source <slug> is required');
  if (!SLUG_RE.test(slug)) {
    throw new Error(`--source must be a lowercase hyphenated slug (got "${slug}")`);
  }

  const pdfPath = path.resolve(options.pdfPath);
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  const chapterFilter = parseChapterFilter(options.chapters);
  const data = new Uint8Array(readFileSync(pdfPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true
  } as any);
  const doc = await loadingTask.promise;

  try {
    const outline = (await doc.getOutline()) as OutlineEntryLike[] | null;
    let ranged: Array<{ title: string; pageStart: number; pageEnd: number; chapterNum: number | null }>;

    if (outline && outline.length > 0) {
      const selected = selectTopLevelOutlineSections(outline);
      const resolved: Array<{ title: string; pageStart: number; chapterNum: number | null }> = [];

      for (const entry of selected) {
        const pageStart = await resolveOutlinePageNumber(doc, entry.dest);
        if (pageStart == null) {
          console.warn(`Warning: could not resolve outline destination for "${entry.title}"; skipping`);
          continue;
        }
        let chapterNum = entry.chapterNumFromTitle;
        if (chapterNum == null) {
          const page = await doc.getPage(pageStart);
          const content = await page.getTextContent();
          const text = pageTextItemsToMarkdown(content.items as Array<{ str?: string; hasEOL?: boolean }>);
          chapterNum = extractChapterNumberFromText(text);
        }
        resolved.push({ title: entry.title, pageStart, chapterNum });
      }

      ranged = computePageRanges(resolved, doc.numPages);
    } else {
      console.warn('Warning: PDF has no outline bookmarks; falling back to page-text Chapter N scan');
      const fallback = await extractChapterFallbackSections(doc);
      if (fallback.length === 0) {
        throw new Error(
          'PDF has no outline bookmarks and no "Chapter N" headings were found in page text. Cannot ingest.'
        );
      }
      ranged = computePageRanges(fallback, doc.numPages);
    }

    const filtered = filterSectionsByChapter(ranged, chapterFilter);
    const sourceDir = getSourceDir(slug);
    const sectionsDir = sourceSectionsDir(slug);

    // Clear prior sections so re-ingest of the same slug does not leave orphans.
    if (existsSync(sectionsDir)) {
      rmSync(sectionsDir, { recursive: true, force: true });
    }
    mkdirSync(sectionsDir, { recursive: true });

    const manifestSections: SourceSectionManifest[] = [];
    let totalChars = 0;
    let usedFilterOrderCount = 0;

    for (let i = 0; i < filtered.length; i++) {
      const section = filtered[i];
      const { order, usedFilterOrder } = resolveSectionOrder(section, i);
      if (usedFilterOrder) usedFilterOrderCount += 1;
      const id = sectionId(order, section.title);
      const fileName = sectionFileName(order, section.title);
      const body = await extractPageText(doc, section.pageStart, section.pageEnd);
      if (!body) {
        throw new Error(
          `Empty text layer for section "${section.title}" (pages ${section.pageStart}-${section.pageEnd}). ` +
            'This PDF may be image-only; OCR is not supported.'
        );
      }
      totalChars += body.length;
      const markdown = `# ${section.title}\n\n${body}\n`;
      writeFileSync(path.join(sectionsDir, fileName), markdown, 'utf8');
      manifestSections.push({
        id,
        title: section.title,
        file: `sections/${fileName}`,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
        charCount: body.length
      });
    }

    if (totalChars === 0) {
      throw new Error('Extracted text is empty across all selected sections (empty text layer).');
    }

    if (usedFilterOrderCount > 0) {
      console.warn(
        `Warning: ${usedFilterOrderCount} section id(s) used filter-order numbering ` +
          `(no chapter number from title/page text). Ids may shift if the chapter filter changes.`
      );
    }

    const metaTitle =
      String(options.title || '').trim() ||
      path.basename(pdfPath, path.extname(pdfPath)).replace(/[_-]+/g, ' ').trim() ||
      slug;

    let storedPdfPath = pdfPath;
    try {
      const rel = path.relative(process.cwd(), pdfPath);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        storedPdfPath = rel.replace(/\\/g, '/');
      }
    } catch {
      // keep absolute path
    }

    const manifest: SourceManifest = {
      slug,
      title: metaTitle,
      ingestedAt: new Date().toISOString(),
      pdfPath: storedPdfPath,
      sections: manifestSections
    };

    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(sourceManifestPath(slug), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    console.log(`Ingested source "${manifest.title}" (${slug})`);
    console.log(`PDF: ${manifest.pdfPath}`);
    console.log(`Sections: ${manifest.sections.length}`);
    for (const section of manifest.sections) {
      console.log(
        `  ${section.id}  pp.${section.pageStart}-${section.pageEnd}  ${section.charCount} chars  ${section.file}`
      );
    }
    console.log(`Saved: gens/sources/${slug}/source-manifest.json`);

    return manifest;
  } finally {
    try {
      // pdfjs v4+ exposes cleanup(); destroy() may be absent on the legacy build.
      const anyDoc = doc as { cleanup?: () => void; destroy?: () => Promise<void> | void };
      if (typeof anyDoc.cleanup === 'function') anyDoc.cleanup();
      if (typeof anyDoc.destroy === 'function') await anyDoc.destroy();
    } catch {
      // ignore cleanup errors
    }
  }
}
