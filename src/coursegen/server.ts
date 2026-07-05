/**
 * Local HTTP UI for the coursegen CLI.
 * Binds to 127.0.0.1 only — same local-only pattern as ide-server.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.ts';
import { rootDir } from './paths.ts';
import { getCourseSummary, listCourses } from './status-api.ts';
import { DEFAULT_COURSEGEN_TTS_VOICE } from './spawn.ts';
import { AUDIENCES, LEARNING_INTENTS } from './types.ts';

const RENDER_COMMANDS = new Set(['render']);
const CAPTIONS_COMMANDS = new Set(['captions']);

loadEnv(rootDir);

const PORT = Number(process.env.COURSEGEN_UI_PORT || 3940);
const HOST = '127.0.0.1';
const UI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html');

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

function startJobFromBody(body: Record<string, unknown>) {
  const command = String(body.command || '');
  const courseSlug = body.courseSlug ? String(body.courseSlug) : undefined;
  const job = createJob(command, courseSlug);
  const args: string[] = [command];

  if (command === 'plan') {
    pushFlag(args, 'topic', body.topic as string);
    pushFlag(args, 'audience', body.audience as string);
    pushFlag(args, 'intent', body.intent as string);
    pushFlag(args, 'scope', body.scope as string);
    pushFlag(args, 'lectures', body.lectures as number);
    pushFlag(args, 'budget', body.budget as number);
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
    pushFlag(args, 'render', body.render as boolean);
  }

  if (command === 'plan' && !body.topic) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: topic is required.');
    return job;
  }

  if (command === 'extend' && !courseSlug) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: course slug is required.');
    return job;
  }

  if (command === 'captions' && !courseSlug) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: course slug is required.');
    return job;
  }

  if (command !== 'plan' && command !== 'extend' && command !== 'captions' && !courseSlug) {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    appendLog(job, 'Error: course slug is required.');
    return job;
  }

  spawnCoursegenJob(job, args);
  return job;
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
        coursesRoot: path.relative(rootDir, path.join(rootDir, 'gens', 'courses'))
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/courses') {
      sendJson(response, 200, { courses: listCourses() });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/courses/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/courses/'.length));
      if (!slug) {
        sendJson(response, 400, { error: 'Missing course slug' });
        return;
      }
      sendJson(response, 200, getCourseSummary(slug));
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
  console.log(`Courses: ${path.join(rootDir, 'gens', 'courses')}`);
});
