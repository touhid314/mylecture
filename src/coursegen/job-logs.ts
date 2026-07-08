import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { courseRunLogPath, getCourseDir, getCoursegenJobsDir } from './paths.ts';

export type JobUiSource = 'coursegen-ui' | 'adaptive-ui';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped';

export type PersistedJobRecord = {
  id: string;
  source: JobUiSource;
  command?: string;
  action?: string;
  courseSlug?: string;
  targetKey?: string;
  targetLectureSlug?: string;
  status: JobStatus;
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
};

function ensureJobsDir() {
  const dir = getCoursegenJobsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobMetaPath(jobId: string) {
  return path.join(getCoursegenJobsDir(), `${jobId}.json`);
}

export function jobLogPath(jobId: string) {
  return path.join(getCoursegenJobsDir(), `${jobId}.log`);
}

export function writeJobRecord(record: PersistedJobRecord) {
  ensureJobsDir();
  writeFileSync(jobMetaPath(record.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function updateJobRecord(jobId: string, patch: Partial<PersistedJobRecord>) {
  const existing = readJobRecord(jobId);
  if (!existing) return;
  writeJobRecord({ ...existing, ...patch, id: jobId });
}

export function readJobRecord(jobId: string): PersistedJobRecord | null {
  const metaPath = jobMetaPath(jobId);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as PersistedJobRecord;
  } catch {
    return null;
  }
}

export function appendJobLogLine(jobId: string, line: string, courseSlug?: string) {
  ensureJobsDir();
  const logLine = line.endsWith('\n') ? line : `${line}\n`;
  appendFileSync(jobLogPath(jobId), logLine, 'utf8');
  if (courseSlug) {
    mkdirSync(getCourseDir(courseSlug), { recursive: true });
    appendFileSync(courseRunLogPath(courseSlug), `[${jobId}] ${logLine}`, 'utf8');
  }
}

export function readJobLogLines(jobId: string): string[] {
  const logPath = jobLogPath(jobId);
  if (!existsSync(logPath)) return [];
  const text = readFileSync(logPath, 'utf8');
  if (!text) return [];
  return text.split(/\r?\n/).filter(line => line.length > 0);
}

export function listPersistedJobs(source: JobUiSource, limit = 100): PersistedJobRecord[] {
  const dir = getCoursegenJobsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try {
        return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as PersistedJobRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is PersistedJobRecord => record !== null && record.source === source)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, limit);
}

export function nextJobCounter(source: JobUiSource, prefix: string): number {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(\\d+)$`);
  let max = 0;
  for (const job of listPersistedJobs(source, 500)) {
    const match = job.id.match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}
