import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type AudioCue = { start?: number; duration?: number; text?: string };
type ResolvedTimeline = { duration?: number; audioTimeline?: AudioCue[] };
type CaptionCue = { start: number; end: number; text: string };

function resolvedSceneNumber(name: string): number | null {
  const match = name.match(/^resolved(\d*)\.html$/i);
  if (!match) return null;
  return match[1] ? Number(match[1]) : 0;
}

function extractResolvedTimeline(filePath: string): ResolvedTimeline | null {
  const html = readFileSync(filePath, 'utf8');
  const marker = 'window.__RESOLVED_TIMELINE__ = ';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  let start = markerIndex + marker.length;
  while (/\s/.test(html[start] || '')) start++;
  if (html[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function timestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function serialize(cues: CaptionCue[]): string {
  const lines = ['WEBVTT', ''];
  for (const cue of cues) {
    lines.push(`${timestamp(cue.start)} --> ${timestamp(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Write one combined caption track for the complete lecture. */
export function writeLectureCaptionsVtt(folderPath: string): string | null {
  const resolvedFiles = readdirSync(folderPath)
    .map(name => ({ name, number: resolvedSceneNumber(name) }))
    .filter((entry): entry is { name: string; number: number } => entry.number !== null)
    .sort((a, b) => a.number - b.number);

  const cues: CaptionCue[] = [];
  let offset = 0;
  for (const file of resolvedFiles) {
    const timeline = extractResolvedTimeline(path.join(folderPath, file.name));
    if (!timeline) continue;
    for (const cue of Array.isArray(timeline.audioTimeline) ? timeline.audioTimeline : []) {
      const text = String(cue.text || '').trim();
      const start = Number(cue.start);
      const duration = Number(cue.duration);
      if (!text || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;
      cues.push({ start: offset + start, end: offset + start + duration, text });
    }
    offset += Number(timeline.duration) || 0;
  }

  if (cues.length === 0) return null;
  const outputPath = path.join(folderPath, 'captions.vtt');
  writeFileSync(outputPath, serialize(cues), 'utf8');
  return outputPath;
}

export function writeLectureCaptionsVttIfMissing(folderPath: string): string | null {
  const outputPath = path.join(folderPath, 'captions.vtt');
  return existsSync(outputPath) ? outputPath : writeLectureCaptionsVtt(folderPath);
}
