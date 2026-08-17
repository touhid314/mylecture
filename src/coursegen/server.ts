/**
 * Local HTTP UI for the coursegen CLI.
 * Binds to 127.0.0.1 only — same local-only pattern as ide-server.ts.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.ts';
import { getCoursesRoot, getSourcesRoot, rootDir } from './paths.ts';
import { assertValidSourceSlug, listSources } from './source-manifest.ts';
import { moduleCourseSlug } from './class-types.ts';
import { getClassDir } from './paths.ts';
import { readCourseAssessments } from './generate-assessments.ts';
import { getClassSummary, getCourseSummary, listClasses, listCourses } from './status-api.ts';
import { DEFAULT_COURSEGEN_TTS_VOICE } from './spawn.ts';
import { AUDIENCES, LEARNING_INTENTS } from './types.ts';

const RENDER_COMMANDS = new Set(['render']);
const CAPTIONS_COMMANDS = new Set(['captions']);
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

loadEnv(rootDir);

const PORT = Number(process.env.COURSEGEN_UI_PORT || 3940);
const HOST = '127.0.0.1';
const UI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html');
const UPLOADS_DIR = path.join(getSourcesRoot(), '_uploads');

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped';

type Job = {
  id: string;
  command: string;
  courseSlug?: string;
  classSlug?: string;
  status: JobStatus;
  log: string[];
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
  child?: ChildProcessWithoutNullStreams;
};

const jobs = new Map<string, Job>();
let jobCounter = 0;

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

async function readJsonBody<T extends Record<string, unknown>>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

async function readRawBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`PDF exceeds maximum upload size of ${Math.floor(maxBytes / (1024 * 1024))}MB`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`PDF exceeds maximum upload size of ${Math.floor(maxBytes / (1024 * 1024))}MB`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function fileLooksLikePdf(filePath: string): boolean {
  const header = Buffer.alloc(5);
  const fd = openSync(filePath, 'r');
  try {
    const bytesRead = readSync(fd, header, 0, 5, 0);
    if (bytesRead < 5) return false;
    return header.toString('utf8') === '%PDF-';
  } finally {
    closeSync(fd);
  }
}

function appendLog(job: Job, line: string) {
  job.log.push(line);
  if (job.log.length > 4000) {
    job.log.splice(0, job.log.length - 3000);
  }
}

function createJob(command: string, courseSlug?: string, classSlug?: string): Job {
  const job: Job = {
    id: `job-${++jobCounter}`,
    command,
    courseSlug,
    classSlug,
    status: 'queued',
    log: [],
    exitCode: null,
    startedAt: new Date().toISOString()
  };
  jobs.set(job.id, job);
  return job;
}

function killJobTree(child: ChildProcessWithoutNullStreams) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

function spawnCoursegenJob(job: Job, args: string[]) {
  job.status = 'running';
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
      appendLog(job, `Stopped (${signal || 'killed'})`);
      return;
    }

    if (code === 0) {
      job.status = 'done';
      appendLog(job, 'Finished successfully.');
    } else {
      job.status = 'failed';
      appendLog(job, `Exited with code ${code ?? 'unknown'}.`);
    }
  });

  child.on('error', error => {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, `Spawn error: ${error.message}`);
  });
}

function pushFlag(args: string[], name: string, value: string | number | boolean | undefined) {
  if (value === undefined || value === '' || value === false) return;
  if (value === true) {
    args.push(`--${name}`);
    return;
  }
  args.push(`--${name}`, String(value));
}

function failJob(job: Job, message: string) {
  job.status = 'failed';
  job.finishedAt = new Date().toISOString();
  appendLog(job, `Error: ${message}`);
  return job;
}

function startJobFromBody(body: Record<string, unknown>) {
  const command = String(body.command || '');
  const classSlug = body.classSlug ? String(body.classSlug) : undefined;
  const moduleSlug = body.moduleSlug ? String(body.moduleSlug) : undefined;
  const courseSlug = body.courseSlug
    ? String(body.courseSlug)
    : command === 'plan-module' && classSlug && moduleSlug
      ? moduleCourseSlug(classSlug, moduleSlug)
      : undefined;
  const job = createJob(command, courseSlug, classSlug);
  const args: string[] = [command];

  if (command === 'ingest') {
    pushFlag(args, 'pdf', body.pdfPath as string);
    pushFlag(args, 'source', body.source as string);
    pushFlag(args, 'chapters', body.chapters as string);
    pushFlag(args, 'title', body.title as string);
  } else if (command === 'plan') {
    pushFlag(args, 'topic', body.topic as string);
    pushFlag(args, 'audience', body.audience as string);
    pushFlag(args, 'intent', body.intent as string);
    pushFlag(args, 'scope', body.scope as string);
    pushFlag(args, 'lectures', body.lectures as number);
    pushFlag(args, 'budget', body.budget as number);
    pushFlag(args, 'model', body.model as string);
    pushFlag(args, 'source', body.source as string);
    pushFlag(args, 'dry-run', body.dryRun as boolean);
  } else if (command === 'plan-class') {
    pushFlag(args, 'topic', body.topic as string);
    pushFlag(args, 'class', classSlug);
    pushFlag(args, 'audience', body.audience as string);
    pushFlag(args, 'intent', body.intent as string);
    pushFlag(args, 'scope', body.scope as string);
    pushFlag(args, 'model', body.model as string);
    pushFlag(args, 'source', body.source as string);
    pushFlag(args, 'dry-run', body.dryRun as boolean);
  } else if (command === 'plan-module') {
    pushFlag(args, 'class', classSlug);
    pushFlag(args, 'module', moduleSlug);
    pushFlag(args, 'source', body.source as string);
    pushFlag(args, 'lectures', body.lectures as number);
    pushFlag(args, 'audience', body.audience as string);
    pushFlag(args, 'intent', body.intent as string);
    pushFlag(args, 'budget', body.budget as number);
    pushFlag(args, 'model', body.model as string);
    pushFlag(args, 'dry-run', body.dryRun as boolean);
  } else if (command === 'generate-assessments') {
    pushFlag(args, 'course', courseSlug);
    pushFlag(args, 'model', body.model as string);
    pushFlag(args, 'dry-run', body.dryRun as boolean);
  } else if (command === 'extend') {
    pushFlag(args, 'course', courseSlug);
    pushFlag(args, 'topic', body.topic as string);
    pushFlag(args, 'scope', body.scope as string);
    pushFlag(args, 'module-title', body.moduleTitle as string);
    pushFlag(args, 'placement', body.placement as string);
    pushFlag(args, 'lectures', body.lectures as number);
    pushFlag(args, 'model', body.model as string);
    pushFlag(args, 'dry-run', body.dryRun as boolean);
  } else if (RENDER_COMMANDS.has(command)) {
    pushFlag(args, 'course', courseSlug);
    pushFlag(args, 'yes', body.yes !== false);
    pushFlag(args, 'force-lecture', body.forceLecture as string);
    pushFlag(args, 'tts-voice', body.ttsVoice as string);
    pushFlag(args, 'tts-speed', body.ttsSpeed as string);
    pushFlag(args, 'dry-run', body.dryRun as boolean);
  } else if (CAPTIONS_COMMANDS.has(command)) {
    pushFlag(args, 'course', courseSlug);
    pushFlag(args, 'lecture', (body.lecture || body.forceLecture) as string);
  } else {
    pushFlag(args, 'course', courseSlug);
    pushFlag(args, 'yes', body.yes !== false);
    pushFlag(args, 'budget', body.budget as number);
    pushFlag(args, 'max-turns', body.maxTurns as number);
    pushFlag(args, 'max-practice-turns', body.maxPracticeTurns as number);
    pushFlag(args, 'lecture-timeout', body.lectureTimeout as number);
    pushFlag(args, 'force-lecture', body.forceLecture as string);
    pushFlag(args, 'lecture', body.lecture as string);
    pushFlag(args, 'tts-voice', body.ttsVoice as string);
    pushFlag(args, 'tts-speed', body.ttsSpeed as string);
    pushFlag(args, 'model', body.model as string);
    pushFlag(args, 'dry-run', body.dryRun as boolean);
    pushFlag(args, 'go-live', body.goLive as boolean);
    pushFlag(args, 'skip-practice-review', body.skipPracticeReview as boolean);
    pushFlag(args, 'skip-script-review', body.skipScriptReview as boolean);
    pushFlag(args, 'no-review', body.noReview as boolean);
    pushFlag(args, 'retry-failed', body.retryFailed as boolean);
    pushFlag(args, 'retry-practice', body.practiceOnly as boolean);
    pushFlag(args, 'repair-practice', body.practiceRepair as boolean);
    pushFlag(args, 'edit-target', body.editTarget as string);
    pushFlag(args, 'edit-prompt', body.editPrompt as string);
    pushFlag(args, 'render', body.render as boolean);
  }

  if (command === 'ingest') {
    const source = String(body.source || '').trim();
    const pdfPath = String(body.pdfPath || '').trim();
    try {
      assertValidSourceSlug(source);
    } catch (error) {
      return failJob(job, error instanceof Error ? error.message : String(error));
    }
    if (!pdfPath) {
      return failJob(job, 'pdfPath is required.');
    }
    try {
      const st = statSync(pdfPath);
      if (!st.isFile()) {
        return failJob(job, `PDF path is not a file: ${pdfPath}`);
      }
    } catch {
      return failJob(job, `PDF not found: ${pdfPath}`);
    }
    try {
      if (!fileLooksLikePdf(pdfPath)) {
        return failJob(job, `File does not look like a PDF (missing %PDF- header): ${pdfPath}`);
      }
    } catch (error) {
      return failJob(job, error instanceof Error ? error.message : String(error));
    }
    spawnCoursegenJob(job, args);
    return job;
  }

  if (command === 'plan' && !body.topic) {
    return failJob(job, 'topic is required.');
  }

  if (command === 'plan-class' && !body.topic) {
    return failJob(job, 'topic is required.');
  }

  if (command === 'plan-module') {
    if (!classSlug) return failJob(job, 'classSlug is required.');
    if (!moduleSlug) return failJob(job, 'moduleSlug is required.');
  }

  if (command === 'generate-assessments' && !courseSlug) {
    return failJob(job, 'course slug is required.');
  }

  if (command === 'extend' && !courseSlug) {
    return failJob(job, 'course slug is required.');
  }

  if (command === 'captions' && !courseSlug) {
    return failJob(job, 'course slug is required.');
  }

  if (
    command !== 'plan' &&
    command !== 'plan-class' &&
    command !== 'plan-module' &&
    command !== 'generate-assessments' &&
    command !== 'extend' &&
    command !== 'captions' &&
    !courseSlug
  ) {
    return failJob(job, 'course slug is required.');
  }

  spawnCoursegenJob(job, args);
  return job;
}

function serializeJob(job: Job) {
  return {
    id: job.id,
    command: job.command,
    courseSlug: job.courseSlug,
    classSlug: job.classSlug,
    status: job.status,
    log: job.log,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}

function saveUploadedPdf(source: string, bytes: Buffer): string {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(3).toString('hex');
  const fileName = `${source}-${stamp}-${suffix}.pdf`;
  const pdfPath = path.join(UPLOADS_DIR, fileName);
  writeFileSync(pdfPath, bytes);
  return pdfPath;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}`);

  try {
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/ui.html')) {
      if (!existsSync(UI_PATH)) {
        sendText(response, 500, 'ui.html not found');
        return;
      }
      const html = readFileSync(UI_PATH, 'utf8');
      sendText(response, 200, html, 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/meta') {
      sendJson(response, 200, {
        audiences: AUDIENCES,
        intents: LEARNING_INTENTS,
        defaultModel: process.env.AGENT_MODEL || '',
        defaultTtsVoice: DEFAULT_COURSEGEN_TTS_VOICE,
        coursesRoot: path.relative(rootDir, path.join(rootDir, 'gens', 'courses')),
        sources: listSources()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/sources') {
      sendJson(response, 200, { sources: listSources() });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/courses') {
      sendJson(response, 200, { courses: listCourses() });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/classes') {
      sendJson(response, 200, { classes: listClasses() });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/classes/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/classes/'.length));
      if (!slug) {
        sendJson(response, 400, { error: 'Missing class slug' });
        return;
      }
      try {
        sendJson(response, 200, getClassSummary(slug));
      } catch (error) {
        sendJson(response, 404, {
          error: error instanceof Error ? error.message : 'Class not found'
        });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/courses/')) {
      const rest = decodeURIComponent(url.pathname.slice('/api/courses/'.length));
      const assessmentsMatch = rest.match(/^([^/]+)\/assessments$/);
      if (assessmentsMatch) {
        const slug = assessmentsMatch[1];
        try {
          sendJson(response, 200, {
            courseSlug: slug,
            assessments: readCourseAssessments(slug)
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(response, /not found/i.test(message) ? 404 : 400, { error: message });
        }
        return;
      }

      if (!rest || rest.includes('/')) {
        sendJson(response, 400, { error: 'Missing course slug' });
        return;
      }
      sendJson(response, 200, getCourseSummary(rest));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/jobs') {
      const items = [...jobs.values()]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 30)
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

    if (request.method === 'POST' && url.pathname === '/api/ingest/upload') {
      const source = String(url.searchParams.get('source') || '').trim();
      try {
        assertValidSourceSlug(source);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      let bytes: Buffer;
      try {
        bytes = await readRawBody(request, MAX_UPLOAD_BYTES);
      } catch (error) {
        sendJson(response, 413, {
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      if (!bytes.length) {
        sendJson(response, 400, { error: 'Empty PDF body' });
        return;
      }

      // PDF files start with %PDF-
      const header = bytes.subarray(0, 5).toString('utf8');
      if (header !== '%PDF-') {
        sendJson(response, 400, { error: 'Body does not look like a PDF (missing %PDF- header)' });
        return;
      }

      const pdfPath = saveUploadedPdf(source, bytes);
      sendJson(response, 200, { pdfPath, source });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/jobs') {
      const body = await readJsonBody<Record<string, unknown>>(request);
      const job = startJobFromBody(body);
      sendJson(response, 202, serializeJob(job));
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/stop')) {
      const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length, -'/stop'.length));
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: 'Job not found' });
        return;
      }
      if (job.child) {
        job.status = 'stopped';
        killJobTree(job.child);
        sendJson(response, 200, serializeJob(job));
        return;
      }
      sendJson(response, 400, { error: 'Job is not running' });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/open-class-folder/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/open-class-folder/'.length));
      const folder = getClassDir(slug);
      if (!existsSync(folder)) {
        sendJson(response, 404, { error: 'Folder not found' });
        return;
      }
      const opener = process.platform === 'win32'
        ? spawn('explorer', [folder], { shell: true, windowsHide: true })
        : process.platform === 'darwin'
          ? spawn('open', [folder])
          : spawn('xdg-open', [folder]);
      opener.unref();
      sendJson(response, 200, { ok: true, folder });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/open-folder/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/open-folder/'.length));
      const summary = getCourseSummary(slug);
      const folder = summary.courseDir;
      if (!existsSync(folder)) {
        sendJson(response, 404, { error: 'Folder not found' });
        return;
      }
      const opener = process.platform === 'win32'
        ? spawn('explorer', [folder], { shell: true, windowsHide: true })
        : process.platform === 'darwin'
          ? spawn('open', [folder])
          : spawn('xdg-open', [folder]);
      opener.unref();
      sendJson(response, 200, { ok: true, folder });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Coursegen UI: http://${HOST}:${PORT}`);
  console.log(`Courses: ${getCoursesRoot()}`);
  console.log(`Sources: ${getSourcesRoot()}`);
});
