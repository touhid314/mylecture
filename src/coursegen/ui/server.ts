/**
 * Local HTTP UI for the programmatic Coursegen API.
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
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureAgentApiAvailable, getAgentOptions } from '../../lecture-agent-api-client.ts';
import { coursegenApi, executeCoursegenCommand, type CoursegenCommandRequest } from '../api.ts';
import { loadEnv } from '../env.ts';
import { getSourcesRoot, rootDir } from '../paths.ts';
import { assertValidSourceSlug, listSources } from '../source-manifest.ts';
import { DEFAULT_COURSEGEN_TTS_VOICE } from '../spawn.ts';
import { AUDIENCES, LEARNING_INTENTS, type Audience, type LearningIntent } from '../types.ts';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

loadEnv(rootDir);

const PORT = Number(process.env.COURSEGEN_UI_PORT || 3940);
const HOST = '127.0.0.1';
const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_PATH = path.join(UI_DIR, 'index.html');
const LOGO_PATH = path.join(rootDir, 'assets', 'logo-lockup.png');
const UPLOADS_DIR = path.join(getSourcesRoot(), '_uploads');

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped';

type Job = {
  id: string;
  command: string;
  courseSlug?: string;
  status: JobStatus;
  log: string[];
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
  controller?: AbortController;
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

function sendBytes(response: ServerResponse, status: number, body: Buffer, contentType: string) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=3600'
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

function createJob(command: string, courseSlug?: string): Job {
  const job: Job = {
    id: `job-${++jobCounter}`,
    command,
    courseSlug,
    status: 'queued',
    log: [],
    exitCode: null,
    startedAt: new Date().toISOString()
  };
  jobs.set(job.id, job);
  return job;
}

function startCoursegenApiJob(job: Job, request: CoursegenCommandRequest) {
  job.status = 'running';
  const controller = new AbortController();
  job.controller = controller;
  appendLog(job, `Starting ${request.command} through the Coursegen API.`);

  const onLog = (message: string) => {
    for (const line of String(message).split(/\r?\n/)) {
      if (line) appendLog(job, line);
    }
  };

  void executeCoursegenCommand(request, { signal: controller.signal, onLog })
    .then(result => {
      if (job.status === 'stopped') return;
      if (!job.courseSlug && result && typeof result === 'object' && 'slug' in result) {
        job.courseSlug = String(result.slug);
      }
      job.status = 'done';
      job.exitCode = 0;
      appendLog(job, 'Finished successfully.');
    })
    .catch(error => {
      if (job.status === 'stopped' || controller.signal.aborted) {
        job.status = 'stopped';
        appendLog(job, 'Stopped.');
        return;
      }
      job.status = 'failed';
      job.exitCode = 1;
      appendLog(job, `Error: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      job.controller = undefined;
      job.finishedAt = new Date().toISOString();
    });
}

function failJob(job: Job, message: string) {
  job.status = 'failed';
  job.finishedAt = new Date().toISOString();
  appendLog(job, `Error: ${message}`);
  return job;
}

function optionalString(value: unknown) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  return number;
}

function startJobFromBody(body: Record<string, unknown>) {
  const command = String(body.command || '');
  const courseSlug = body.courseSlug ? String(body.courseSlug) : undefined;
  const job = createJob(command, courseSlug);

  try {
    let request: CoursegenCommandRequest;

    if (command === 'ingest') {
      const source = String(body.source || '').trim();
      const pdfPath = String(body.pdfPath || '').trim();
      assertValidSourceSlug(source);
      if (!pdfPath) throw new Error('pdfPath is required.');
      const st = statSync(pdfPath);
      if (!st.isFile()) throw new Error(`PDF path is not a file: ${pdfPath}`);
      if (!fileLooksLikePdf(pdfPath)) throw new Error(`File does not look like a PDF: ${pdfPath}`);
      request = {
        command,
        options: {
          pdfPath,
          source,
          chapters: optionalString(body.chapters),
          title: optionalString(body.title)
        }
      };
    } else if (command === 'plan') {
      const topic = String(body.topic || '').trim();
      if (!topic) throw new Error('topic is required.');
      const audience = optionalString(body.audience);
      const intent = optionalString(body.intent);
      if (audience && !AUDIENCES.includes(audience as Audience)) {
        throw new Error(`audience must be one of: ${AUDIENCES.join(', ')}`);
      }
      if (intent && !LEARNING_INTENTS.includes(intent as LearningIntent)) {
        throw new Error(`intent must be one of: ${LEARNING_INTENTS.join(', ')}`);
      }
      request = {
        command,
        options: {
          topic,
          scope: optionalString(body.scope),
          audience: audience as Audience | undefined,
          intent: intent as LearningIntent | undefined,
          maxLectures: optionalNumber(body.lectures, 'lectures'),
          budgetUsd: optionalNumber(body.budget, 'budget'),
          model: optionalString(body.model),
          source: optionalString(body.source),
          dryRun: Boolean(body.dryRun)
        }
      };
    } else {
      if (!courseSlug) throw new Error('course slug is required.');
      if (command === 'extend') {
        const placement = optionalString(body.placement) || 'auto';
        if (!['auto', 'append-last', 'new-module'].includes(placement)) {
          throw new Error('placement must be one of: auto, append-last, new-module');
        }
        request = {
          command,
          options: {
            courseSlug,
            topic: optionalString(body.topic),
            scope: optionalString(body.scope),
            moduleTitle: optionalString(body.moduleTitle),
            placement: placement as 'auto' | 'append-last' | 'new-module',
            maxLectures: optionalNumber(body.lectures, 'lectures'),
            model: optionalString(body.model),
            dryRun: Boolean(body.dryRun)
          }
        };
      } else if (command === 'captions') {
        request = {
          command,
          options: {
            courseSlug,
            lectureSlug: optionalString(body.lecture || body.forceLecture)
          }
        };
      } else if (command === 'publish') {
        request = {
          command,
          options: {
            courseSlug,
            yes: body.yes !== false,
            goLive: Boolean(body.goLive),
            dryRun: Boolean(body.dryRun)
          }
        };
      } else if (command === 'run' || command === 'resume' || command === 'render') {
        request = {
          command,
          options: {
            courseSlug,
            yes: body.yes !== false,
            budgetUsd: optionalNumber(body.budget, 'budget'),
            lectureTimeoutMinutes: optionalNumber(body.lectureTimeout, 'lecture timeout'),
            forceLecture: optionalString(body.forceLecture),
            ttsProvider: optionalString(body.ttsProvider),
            ttsVoice: optionalString(body.ttsVoice),
            ttsSpeed: optionalString(body.ttsSpeed),
            model: optionalString(body.model),
            dryRun: Boolean(body.dryRun),
            retryFailed: Boolean(body.retryFailed),
            render: Boolean(body.render)
          }
        };
      } else {
        throw new Error(`Unsupported Coursegen command: ${command || '(missing)'}`);
      }
    }

    startCoursegenApiJob(job, request);
    return job;
  } catch (error) {
    return failJob(job, error instanceof Error ? error.message : String(error));
  }
}

function serializeJob(job: Job) {
  return {
    id: job.id,
    command: job.command,
    courseSlug: job.courseSlug,
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

export const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}`);

  try {
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/ui.html')) {
      if (!existsSync(UI_PATH)) {
        sendText(response, 500, 'Coursegen UI index.html not found');
        return;
      }
      const html = readFileSync(UI_PATH, 'utf8');
      sendText(response, 200, html, 'text/html; charset=utf-8');
      return;
    }

    if (
      request.method === 'GET'
      && (url.pathname === '/assets/logo-lockup.png' || url.pathname === '/assets/mylecture-logo.png')
    ) {
      if (!existsSync(LOGO_PATH)) {
        sendText(response, 404, 'MyLecture logo not found');
        return;
      }
      sendBytes(response, 200, readFileSync(LOGO_PATH), 'image/png');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/meta') {
      const agentOptions = await getAgentOptions();
      sendJson(response, 200, {
        audiences: AUDIENCES,
        intents: LEARNING_INTENTS,
        defaultModel: process.env.AGENT_MODEL || '',
        defaultTtsProvider: agentOptions.tts.defaults.provider,
        defaultTtsVoice: agentOptions.tts.defaults.voice || DEFAULT_COURSEGEN_TTS_VOICE,
        agentOptions,
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
      sendJson(response, 200, { courses: coursegenApi.list() });
      return;
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/courses/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/courses/'.length));
      if ([...jobs.values()].some(job => job.status === 'running' || job.status === 'queued')) {
        sendJson(response, 409, { error: 'Stop the active Coursegen job before deleting a course.' });
        return;
      }
      const deleted = coursegenApi.deleteCourse(slug);
      sendJson(response, 200, { ok: true, deleted });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/courses/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/courses/'.length));
      if (!slug) {
        sendJson(response, 400, { error: 'Missing course slug' });
        return;
      }
      sendJson(response, 200, coursegenApi.status(slug));
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
      if (job.controller && job.status === 'running') {
        job.status = 'stopped';
        job.controller.abort();
        sendJson(response, 200, serializeJob(job));
        return;
      }
      sendJson(response, 400, { error: 'Job is not running' });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/open-folder/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/open-folder/'.length));
      const summary = coursegenApi.status(slug);
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

await ensureAgentApiAvailable({ rootDir });
server.listen(PORT, HOST, () => {
  console.log(`Coursegen UI: http://${HOST}:${PORT}`);
  console.log(`Courses: ${path.join(rootDir, 'gens', 'courses')}`);
});
