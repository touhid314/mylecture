import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isIndexHtmlName, resolvedSiblingPathForIndex } from './coursegen/paths.ts';

export type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export type ResolvedTimeline = {
  duration?: number;
  audioTimeline?: Array<{
    start?: number;
    duration?: number;
    text?: string;
    sectionId?: string;
  }>;
  videoTimeline?: Array<{
    start?: number;
    end?: number;
    duration?: number;
    sectionId?: string;
    item?: { id?: string; text?: string };
  }>;
};

/** Match lecture-viewer subtitle cue selection for website CC overlays. */
export function buildSubtitleCues(timeline: ResolvedTimeline): SubtitleCue[] {
  const audioTimeline = Array.isArray(timeline.audioTimeline) ? timeline.audioTimeline : [];
  const videoTimeline = Array.isArray(timeline.videoTimeline) ? timeline.videoTimeline : [];

  const audioSubtitleCues = audioTimeline
    .filter(cue => String(cue.text || '').trim())
    .map(cue => ({
      start: Number(cue.start) || 0,
      end: (Number(cue.start) || 0) + (Number(cue.duration) || 0),
      text: String(cue.text || '').trim(),
      sectionId: cue.sectionId || ''
    }))
    .filter(cue => cue.end > cue.start);

  const audioSectionIds = new Set(audioSubtitleCues.map(cue => cue.sectionId).filter(Boolean));
  const videoSubtitleCues = videoTimeline
    .filter(cue => String(cue.item?.text || '').trim())
    .filter(cue => !audioSectionIds.has(cue.item?.id))
    .map(cue => ({
      start: Number(cue.start) || 0,
      end: Number(cue.end) || ((Number(cue.start) || 0) + (Number(cue.duration) || 0)),
      text: String(cue.item?.text || '').trim(),
      sectionId: cue.item?.id || ''
    }))
    .filter(cue => cue.end > cue.start);

  return [...audioSubtitleCues, ...videoSubtitleCues]
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, text }) => ({ start, end, text }));
}

export function formatVttTimestamp(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function serializeVtt(cues: SubtitleCue[]) {
  const lines = ['WEBVTT', ''];
  for (const cue of cues) {
    if (!cue.text.trim() || cue.end <= cue.start) continue;
    lines.push(`${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}`);
    lines.push(cue.text.replace(/\r\n/g, '\n'));
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function extractTimelineFromResolvedHtml(resolvedPath: string): ResolvedTimeline | null {
  const html = readFileSync(resolvedPath, 'utf8');
  const marker = 'window.__RESOLVED_TIMELINE__ = ';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  let pos = markerIndex + marker.length;
  while (pos < html.length && /\s/.test(html[pos])) pos += 1;
  if (html[pos] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = pos; index < html.length; index += 1) {
    const ch = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(pos, index + 1)) as ResolvedTimeline;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Build one lecture-level captions.vtt from all resolved scene HTML files in a folder.
 */
export function writeLectureCaptionsVtt(lectureFolderPath: string): string | null {
  if (!existsSync(lectureFolderPath)) return null;

  const indexFiles = readdirSync(lectureFolderPath)
    .filter(name => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(name => path.join(lectureFolderPath, name));

  if (indexFiles.length === 0) return null;

  const merged: SubtitleCue[] = [];
  let offset = 0;

  for (const indexPath of indexFiles) {
    const resolvedPath = resolvedSiblingPathForIndex(indexPath);
    if (!existsSync(resolvedPath)) continue;

    const timeline = extractTimelineFromResolvedHtml(resolvedPath);
    if (!timeline) continue;

    const cues = buildSubtitleCues(timeline);
    for (const cue of cues) {
      merged.push({
        start: cue.start + offset,
        end: cue.end + offset,
        text: cue.text
      });
    }
    offset += Number(timeline.duration) || 0;
  }

  if (merged.length === 0) return null;

  const outPath = path.join(lectureFolderPath, 'captions.vtt');
  writeFileSync(outPath, serializeVtt(merged), 'utf8');
  return outPath;
}
