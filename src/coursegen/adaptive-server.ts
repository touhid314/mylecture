/**
 * Local UI for adaptive skill-graph authoring.
 * Separate from the general coursegen UI: this surface plans full adaptive
 * blueprints and fills them in node batches.
 */
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.ts';
import {
  appendJobLogLine,
  listPersistedJobs,
  nextJobCounter,
  readJobLogLines,
  updateJobRecord,
  writeJobRecord,
  type JobStatus
} from './job-logs.ts';
import { isIndexHtmlName, isResolvedHtmlName, lectureFolderName, lectureFolderPath, rootDir } from './paths.ts';
import { getCourseSummary, listCourses } from './status-api.ts';
import { lectureSlugFromJobArgs, resetInterruptedLectures } from './run-course.ts';
import { AUDIENCES } from './types.ts';

loadEnv(rootDir);

const PORT = Number(process.env.ADAPTIVE_UI_PORT || 3941);
const HOST = '127.0.0.1';
const UI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'adaptive-ui.html');

type Job = {
  id: string;
  action: string;
  courseSlug?: string;
  targetLectureSlug?: string;
  targetKey: string;
  status: JobStatus;
  log: string[];
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
  child?: ChildProcessWithoutNullStreams;
};

const jobs = new Map<string, Job>();
const JOB_SOURCE = 'adaptive-ui' as const;
const JOB_ID_PREFIX = 'adaptive-job-';
let jobCounter = nextJobCounter(JOB_SOURCE, JOB_ID_PREFIX);

type PreviewKind = 'video' | 'mp4' | 'interactive' | 'game';

type PreviewArtifact = {
  id: string;
  kind: PreviewKind;
  label: string;
  available: boolean;
  url: string;
  source?: string;
};

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendFile(response: ServerResponse, filePath: string) {
  const type = contentTypeFor(filePath);
  response.writeHead(200, { 'Content-Type': type });
  createReadStream(filePath).pipe(response);
}

function contentTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };
  return types[extension] || 'application/octet-stream';
}

async function readJsonBody<T extends Record<string, unknown>>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function appendLog(job: Job, line: string) {
  job.log.push(line);
  appendJobLogLine(job.id, line, job.courseSlug);
}

function persistJob(job: Job) {
  writeJobRecord({
    id: job.id,
    source: JOB_SOURCE,
    action: job.action,
    courseSlug: job.courseSlug,
    targetKey: job.targetKey,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  });
}

function restorePersistedJobs() {
  for (const record of listPersistedJobs(JOB_SOURCE, 100)) {
    const job: Job = {
      id: record.id,
      action: record.action || 'unknown',
      courseSlug: record.courseSlug,
      targetKey: record.targetKey || '',
      status: record.status,
      log: readJobLogLines(record.id),
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt
    };

    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'failed';
      job.finishedAt = job.finishedAt || new Date().toISOString();
      const message = 'Interrupted: UI server restarted while this job was active.';
      appendLog(job, message);
      updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt });
    }

    jobs.set(job.id, job);
  }
}

function isActiveJob(job: Job) {
  return job.status === 'queued' || job.status === 'running';
}

function findActiveJob(targetKey: string) {
  return [...jobs.values()].find(job => job.targetKey === targetKey && isActiveJob(job));
}

function createJob(action: string, targetKey: string, courseSlug?: string): Job {
  const job: Job = {
    id: `${JOB_ID_PREFIX}${++jobCounter}`,
    action,
    courseSlug,
    targetKey,
    status: 'queued',
    log: [],
    exitCode: null,
    startedAt: new Date().toISOString()
  };
  jobs.set(job.id, job);
  persistJob(job);
  return job;
}

function pushFlag(args: string[], name: string, value: string | number | boolean | undefined) {
  if (value === undefined || value === '' || value === false) return;
  if (value === true) {
    args.push(`--${name}`);
    return;
  }
  args.push(`--${name}`, String(value));
}

function releaseInterruptedLectures(job: Job) {
  if (!job.courseSlug) return;
  try {
    if (resetInterruptedLectures(job.courseSlug, {
      lectureSlug: job.targetLectureSlug,
      reason: 'Stopped by user',
    })) {
      appendLog(job, `Released interrupted lecture state for ${job.courseSlug}${job.targetLectureSlug ? ` (${job.targetLectureSlug})` : ''}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(job, `Warning: could not release interrupted lecture state: ${message}`);
  }
}

function spawnCoursegenJob(job: Job, args: string[]) {
  job.targetLectureSlug = lectureSlugFromJobArgs(args);
  job.status = 'running';
  updateJobRecord(job.id, { status: job.status, targetLectureSlug: job.targetLectureSlug });
  appendLog(job, `$ npm run coursegen -- ${args.join(' ')}`);

  const child = spawn('npm', ['run', 'coursegen', '--', ...args], {
    cwd: rootDir,
    env: process.env,
    shell: true,
    windowsHide: true
  });
  job.child = child;

  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line) appendLog(job, line);
    }
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('close', (code, signal) => {
    job.child = undefined;
    job.finishedAt = new Date().toISOString();
    job.exitCode = code;

    if (job.status === 'stopped') {
      releaseInterruptedLectures(job);
      appendLog(job, `Stopped (${signal || 'killed'})`);
      updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt, exitCode: job.exitCode });
      return;
    }

    if (code === 0) {
      job.status = 'done';
      appendLog(job, 'Finished successfully.');
    } else {
      job.status = 'failed';
      appendLog(job, `Exited with code ${code ?? 'unknown'}.`);
    }
    updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt, exitCode: job.exitCode });
  });

  child.on('error', error => {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, `Spawn error: ${error.message}`);
    updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt, exitCode: job.exitCode });
  });
}

function killJobTree(child: ChildProcessWithoutNullStreams) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

function serializeJob(job: Job) {
  return {
    id: job.id,
    action: job.action,
    courseSlug: job.courseSlug,
    targetKey: job.targetKey,
    targetLectureSlug: job.targetLectureSlug,
    status: job.status,
    log: readJobLogLines(job.id),
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}

restorePersistedJobs();

function getAdaptiveCourses() {
  return listCourses()
    .map(item => {
      try {
        const summary = getCourseSummary(item.slug);
        if (!summary.plan.adaptivePath) return null;
        return {
          ...item,
          pendingCount: summary.progress.pending,
          failedCount: summary.progress.failed,
          needsReviewCount: summary.progress.needsReview,
          inProgressCount: summary.progress.inProgress,
          estimatedCostUsd: summary.estimatedCostUsd
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function newestHtml(folderPath: string, matcher: (name: string) => boolean) {
  if (!existsSync(folderPath)) return '';
  return readdirSync(folderPath)
    .filter(matcher)
    .map(name => ({ name, time: statSync(path.join(folderPath, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0]?.name || '';
}

function newestFile(folderPath: string, matcher: (name: string) => boolean) {
  if (!existsSync(folderPath)) return '';
  return readdirSync(folderPath)
    .filter(matcher)
    .map(name => ({ name, time: statSync(path.join(folderPath, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0]?.name || '';
}

function matchingFiles(folderPath: string, matcher: (name: string) => boolean) {
  if (!existsSync(folderPath)) return [];
  return readdirSync(folderPath)
    .filter(matcher)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function safeJoin(rootPath: string, relativePath: string) {
  const normalized = path.normalize(relativePath || '').replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.resolve(rootPath, normalized);
  const rootResolved = path.resolve(rootPath);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return '';
  }
  return resolved;
}

function previewFolderFor(courseSlug: string, nodeSlug: string) {
  const summary = getCourseSummary(courseSlug);
  const lecture = summary.lectures.find(item => item.slug === nodeSlug);
  if (!lecture) return null;
  const folderName = lecture.folderName || lectureFolderName(lecture.order, lecture.slug);
  const folderPath = lectureFolderPath(courseSlug, folderName);
  return {
    lecture,
    folderPath
  };
}

function artifactPathFor(folderPath: string, kind: PreviewKind, relativePath?: string) {
  if (kind === 'video') {
    const entry = relativePath || newestHtml(folderPath, isResolvedHtmlName) || newestHtml(folderPath, isIndexHtmlName);
    return entry ? safeJoin(folderPath, entry) : '';
  }
  if (kind === 'mp4') {
    const entry = relativePath || newestFile(folderPath, name => /\.mp4$/i.test(name));
    return entry ? safeJoin(folderPath, entry) : '';
  }

  const base = path.join(folderPath, 'activities', kind);
  return safeJoin(base, relativePath || 'index.html');
}

function previewUrl(courseSlug: string, nodeSlug: string, kind: PreviewKind, relativePath: string) {
  return `/preview-file/${encodeURIComponent(courseSlug)}/${encodeURIComponent(nodeSlug)}/${kind}/${relativePath.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
}

function buildPreview(courseSlug: string, nodeSlug: string) {
  const target = previewFolderFor(courseSlug, nodeSlug);
  if (!target) return null;

  const resolvedEntries = matchingFiles(target.folderPath, isResolvedHtmlName);
  const draftEntries = resolvedEntries.length ? [] : matchingFiles(target.folderPath, isIndexHtmlName);
  const videoEntries = resolvedEntries.length ? resolvedEntries : draftEntries;
  const mp4Entry = newestFile(target.folderPath, name => /\.mp4$/i.test(name));
  const videoArtifacts: PreviewArtifact[] = videoEntries.map((entry, index) => ({
      id: `video-${index}`,
      kind: 'video',
      label: `${resolvedEntries.length ? 'Resolved' : 'Draft'} ${videoEntries.length > 1 ? `part ${index + 1}` : 'video'}`,
      available: existsSync(path.join(target.folderPath, entry)),
      url: previewUrl(courseSlug, nodeSlug, 'video', entry),
      source: entry
  }));
  const artifacts: PreviewArtifact[] = [
    ...videoArtifacts,
    {
      id: 'mp4',
      kind: 'mp4',
      label: 'MP4',
      available: Boolean(mp4Entry && existsSync(path.join(target.folderPath, mp4Entry))),
      url: mp4Entry ? previewUrl(courseSlug, nodeSlug, 'mp4', mp4Entry) : '',
      source: mp4Entry || ''
    },
    {
      id: 'interactive',
      kind: 'interactive',
      label: 'Practice',
      available: existsSync(path.join(target.folderPath, 'activities', 'interactive', 'index.html')),
      url: previewUrl(courseSlug, nodeSlug, 'interactive', 'index.html'),
      source: 'activities/interactive/index.html'
    },
    {
      id: 'game',
      kind: 'game',
      label: 'Game',
      available: existsSync(path.join(target.folderPath, 'activities', 'game', 'index.html')),
      url: previewUrl(courseSlug, nodeSlug, 'game', 'index.html'),
      source: 'activities/game/index.html'
    }
  ];

  return {
    node: {
      slug: target.lecture.slug,
      title: target.lecture.title,
      status: target.lecture.status,
      formats: target.lecture.formats,
      interactiveReview: target.lecture.interactiveReview,
      interactiveReviewNotes: target.lecture.interactiveReviewNotes,
      gameReview: target.lecture.gameReview,
      gameReviewNotes: target.lecture.gameReviewNotes,
      videoFrameReview: target.lecture.videoFrameReview,
      videoFrameReviewNotes: target.lecture.videoFrameReviewNotes,
      error: target.lecture.error
    },
    artifacts
  };
}

function startPlanJob(body: Record<string, unknown>) {
  const topic = String(body.topic || '').trim();
  const targetKey = `plan:${topic.toLowerCase()}`;
  const existing = findActiveJob(targetKey);
  if (existing) return existing;
  const job = createJob('plan', targetKey);
  if (!topic) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: topic is required.');
    updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt });
    return job;
  }

  const args = ['plan'];
  pushFlag(args, 'topic', topic);
  pushFlag(args, 'adaptive', true);
  pushFlag(args, 'scope', body.scope as string);
  pushFlag(args, 'audience', body.audience as string);
  pushFlag(args, 'intent', 'practice');
  pushFlag(args, 'lectures', body.maxNodes as number);
  pushFlag(args, 'budget', body.budget as number);
  pushFlag(args, 'model', body.model as string);
  pushFlag(args, 'dry-run', body.dryRun as boolean);
  spawnCoursegenJob(job, args);
  return job;
}

function startBatchJob(body: Record<string, unknown>) {
  const courseSlug = String(body.courseSlug || '').trim();
  const targetKey = `course:${courseSlug}`;
  const existing = findActiveJob(targetKey);
  if (existing) return existing;
  const job = createJob('batch', targetKey, courseSlug);
  if (!courseSlug) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: course slug is required.');
    updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt });
    return job;
  }

  const args = [body.resume === false ? 'run' : 'resume'];
  pushFlag(args, 'course', courseSlug);
  pushFlag(args, 'yes', true);
  pushFlag(args, 'node-limit', body.nodeLimit as number);
  pushFlag(args, 'budget', body.budget as number);
  pushFlag(args, 'max-turns', body.maxTurns as number);
  pushFlag(args, 'max-practice-turns', body.maxPracticeTurns as number);
  pushFlag(args, 'lecture-timeout', body.lectureTimeout as number);
  pushFlag(args, 'model', body.model as string);
  pushFlag(args, 'render', body.render as boolean);
  pushFlag(args, 'dry-run', body.dryRun as boolean);
  pushFlag(args, 'retry-failed', body.retryFailed as boolean);
  spawnCoursegenJob(job, args);
  return job;
}

function startRepairNodeJob(body: Record<string, unknown>) {
  const courseSlug = String(body.courseSlug || '').trim();
  const nodeSlug = String(body.nodeSlug || '').trim();
  const targetKey = `course:${courseSlug}`;
  const existing = findActiveJob(targetKey);
  if (existing) return existing;
  const job = createJob('repair-node', targetKey, courseSlug);
  if (!courseSlug || !nodeSlug) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: course slug and node slug are required.');
    updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt });
    return job;
  }

  const args = ['resume'];
  pushFlag(args, 'course', courseSlug);
  pushFlag(args, 'repair-practice', nodeSlug);
  pushFlag(args, 'yes', true);
  pushFlag(args, 'lecture-timeout', body.lectureTimeout as number);
  pushFlag(args, 'model', body.model as string);
  pushFlag(args, 'dry-run', body.dryRun as boolean);
  spawnCoursegenJob(job, args);
  return job;
}

function startSingleNodeJob(body: Record<string, unknown>) {
  const courseSlug = String(body.courseSlug || '').trim();
  const nodeSlug = String(body.nodeSlug || '').trim();
  const targetKey = `course:${courseSlug}`;
  const existing = findActiveJob(targetKey);
  if (existing) return existing;
  const job = createJob('single-node', targetKey, courseSlug);
  if (!courseSlug || !nodeSlug) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: course slug and node slug are required.');
    updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt });
    return job;
  }

  const args = ['resume'];
  pushFlag(args, 'course', courseSlug);
  pushFlag(args, 'force-lecture', nodeSlug);
  pushFlag(args, 'yes', true);
  pushFlag(args, 'budget', body.budget as number);
  pushFlag(args, 'model', body.model as string);
  pushFlag(args, 'render', body.render as boolean);
  pushFlag(args, 'dry-run', body.dryRun as boolean);
  spawnCoursegenJob(job, args);
  return job;
}

function startRenderNodeJob(body: Record<string, unknown>) {
  const courseSlug = String(body.courseSlug || '').trim();
  const nodeSlug = String(body.nodeSlug || '').trim();
  const targetKey = `course:${courseSlug}`;
  const existing = findActiveJob(targetKey);
  if (existing) return existing;
  const job = createJob('render-node', targetKey, courseSlug);
  if (!courseSlug || !nodeSlug) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: course slug and node slug are required.');
    updateJobRecord(job.id, { status: job.status, finishedAt: job.finishedAt });
    return job;
  }

  const args = ['render'];
  pushFlag(args, 'course', courseSlug);
  pushFlag(args, 'force-lecture', nodeSlug);
  pushFlag(args, 'yes', true);
  pushFlag(args, 'dry-run', body.dryRun as boolean);
  spawnCoursegenJob(job, args);
  return job;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}`);

  try {
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/adaptive-ui.html')) {
      if (!existsSync(UI_PATH)) {
        sendText(response, 500, 'adaptive-ui.html not found');
        return;
      }
      sendText(response, 200, readFileSync(UI_PATH, 'utf8'), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/meta') {
      sendJson(response, 200, {
        audiences: AUDIENCES,
        defaultModel: process.env.AGENT_MODEL || ''
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/paths') {
      sendJson(response, 200, { paths: getAdaptiveCourses() });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/paths/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/paths/'.length));
      sendJson(response, 200, getCourseSummary(slug));
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/preview/')) {
      const parts = url.pathname.slice('/api/preview/'.length).split('/').map(decodeURIComponent);
      const [courseSlug, nodeSlug] = parts;
      if (!courseSlug || !nodeSlug) {
        sendJson(response, 400, { error: 'Course slug and node slug are required' });
        return;
      }
      const preview = buildPreview(courseSlug, nodeSlug);
      if (!preview) {
        sendJson(response, 404, { error: 'Node not found' });
        return;
      }
      sendJson(response, 200, preview);
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/preview-file/')) {
      const parts = url.pathname.slice('/preview-file/'.length).split('/').map(decodeURIComponent);
      const [courseSlug, nodeSlug, kind, ...relativeParts] = parts;
      if (!courseSlug || !nodeSlug || !['video', 'mp4', 'interactive', 'game'].includes(kind)) {
        sendText(response, 400, 'Invalid preview path');
        return;
      }
      const target = previewFolderFor(courseSlug, nodeSlug);
      if (!target) {
        sendText(response, 404, 'Preview node not found');
        return;
      }
      const filePath = artifactPathFor(target.folderPath, kind as PreviewKind, relativeParts.join('/'));
      if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
        sendText(response, 404, 'Preview file not found');
        return;
      }
      sendFile(response, filePath);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/jobs') {
      const items = [...jobs.values()]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 20)
        .map(serializeJob);
      sendJson(response, 200, { jobs: items });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: 'Job not found' });
        return;
      }
      sendJson(response, 200, serializeJob(job));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/plan') {
      const body = await readJsonBody<Record<string, unknown>>(request);
      sendJson(response, 202, serializeJob(startPlanJob(body)));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/batch') {
      const body = await readJsonBody<Record<string, unknown>>(request);
      sendJson(response, 202, serializeJob(startBatchJob(body)));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/node/repair') {
      const body = await readJsonBody<Record<string, unknown>>(request);
      sendJson(response, 202, serializeJob(startRepairNodeJob(body)));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/node') {
      const body = await readJsonBody<Record<string, unknown>>(request);
      sendJson(response, 202, serializeJob(startSingleNodeJob(body)));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/node/render') {
      const body = await readJsonBody<Record<string, unknown>>(request);
      sendJson(response, 202, serializeJob(startRenderNodeJob(body)));
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/stop')) {
      const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length, -'/stop'.length));
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: 'Job not found' });
        return;
      }
      if (!job.child) {
        sendJson(response, 400, { error: 'Job is not running' });
        return;
      }
      job.status = 'stopped';
      updateJobRecord(job.id, { status: job.status });
      killJobTree(job.child);
      releaseInterruptedLectures(job);
      sendJson(response, 200, serializeJob(job));
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Adaptive UI: http://${HOST}:${PORT}`);
});
