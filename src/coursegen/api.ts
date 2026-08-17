import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { extendCourse, type ExtendCourseOptions } from './extend-course.ts';
import type { IngestSourceOptions } from './ingest-source.ts';
import { getCourseDir, getCoursesRoot } from './paths.ts';
import { planCourse, type PlanCourseOptions } from './plan-course.ts';
import { publishCourse, type PublishCourseOptions } from './publish-course.ts';
import { runCourse, type RunCourseOptions } from './run-course.ts';
import { getCourseSummary, listCourses, type CourseSummary } from './status-api.ts';
import { SLUG_RE } from './types.ts';
import { writeCourseCaptions, type WriteCourseCaptionsOptions } from './write-captions.ts';

export type CoursegenApiContext = {
  signal?: AbortSignal;
  onLog?: (message: string) => void;
};

export type CoursegenCommandRequest =
  | { command: 'ingest'; options: IngestSourceOptions }
  | { command: 'plan'; options: PlanCourseOptions }
  | { command: 'extend'; options: ExtendCourseOptions }
  | { command: 'run'; options: RunCourseOptions }
  | { command: 'resume'; options: RunCourseOptions }
  | { command: 'render'; options: RunCourseOptions }
  | { command: 'captions'; options: WriteCourseCaptionsOptions }
  | { command: 'publish'; options: PublishCourseOptions }
  | { command: 'status'; options: { courseSlug: string } };

const operationLog = new AsyncLocalStorage<((message: string) => void) | undefined>();
let consoleBridgeInstalled = false;

function installConsoleBridge() {
  if (consoleBridgeInstalled) return;
  consoleBridgeInstalled = true;
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      original(...args);
      operationLog.getStore()?.(format(...args));
    }) as typeof console[typeof method];
  }
}

function abortError() {
  const error = new Error('Coursegen operation stopped.');
  error.name = 'AbortError';
  return error;
}

function checkpoint(context: CoursegenApiContext) {
  if (context.signal?.aborted) throw abortError();
}

async function runOperation<T>(
  label: string,
  context: CoursegenApiContext,
  operation: () => Promise<T> | T
): Promise<T> {
  installConsoleBridge();
  return operationLog.run(context.onLog, async () => {
    checkpoint(context);
    context.onLog?.(`${label}...`);
    try {
      const result = await operation();
      checkpoint(context);
      context.onLog?.(`${label} complete.`);
      return result;
    } catch (error) {
      if (context.signal?.aborted) throw abortError();
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Dry run complete')) {
        context.onLog?.(message);
        return undefined as T;
      }
      throw error;
    }
  });
}

export const coursegenApi = {
  ingest(options: IngestSourceOptions, context: CoursegenApiContext = {}) {
    return runOperation('Ingesting reference', context, async () => {
      const { ingestSource } = await import('./ingest-source.ts');
      return ingestSource(options);
    });
  },

  plan(options: PlanCourseOptions, context: CoursegenApiContext = {}) {
    return runOperation('Planning course', context, () => planCourse(options));
  },

  extend(options: ExtendCourseOptions, context: CoursegenApiContext = {}) {
    return runOperation('Extending course plan', context, () => extendCourse(options));
  },

  run(options: RunCourseOptions, context: CoursegenApiContext = {}) {
    return runOperation('Running course generation', context, () => runCourse(options));
  },

  resume(options: RunCourseOptions, context: CoursegenApiContext = {}) {
    return runOperation('Resuming course generation', context, () => runCourse({
      ...options,
      retryFailed: true
    }));
  },

  render(options: RunCourseOptions, context: CoursegenApiContext = {}) {
    return runOperation('Rendering course', context, () => runCourse({
      ...options,
      renderOnly: true
    }));
  },

  captions(options: WriteCourseCaptionsOptions, context: CoursegenApiContext = {}) {
    return runOperation('Writing course captions', context, () => writeCourseCaptions(options));
  },

  publish(options: PublishCourseOptions, context: CoursegenApiContext = {}) {
    return runOperation('Publishing course', context, () => publishCourse(options));
  },

  status(courseSlug: string): CourseSummary {
    return getCourseSummary(courseSlug);
  },

  list() {
    return listCourses();
  },

  deleteCourse(courseSlug: string) {
    if (!SLUG_RE.test(courseSlug)) {
      throw new Error('Invalid course slug.');
    }
    const coursesRoot = path.resolve(getCoursesRoot());
    const courseDir = path.resolve(getCourseDir(courseSlug));
    if (path.dirname(courseDir) !== coursesRoot) {
      throw new Error('Course folder is outside the courses directory.');
    }
    if (!existsSync(courseDir) || !statSync(courseDir).isDirectory()) {
      throw new Error('Course not found.');
    }
    rmSync(courseDir, { recursive: true, force: false });
    return { slug: courseSlug, courseDir };
  }
};

export async function executeCoursegenCommand(
  request: CoursegenCommandRequest,
  context: CoursegenApiContext = {}
) {
  switch (request.command) {
    case 'ingest': return coursegenApi.ingest(request.options, context);
    case 'plan': return coursegenApi.plan(request.options, context);
    case 'extend': return coursegenApi.extend(request.options, context);
    case 'run': return coursegenApi.run(request.options, context);
    case 'resume': return coursegenApi.resume(request.options, context);
    case 'render': return coursegenApi.render(request.options, context);
    case 'captions': return coursegenApi.captions(request.options, context);
    case 'publish': return coursegenApi.publish(request.options, context);
    case 'status': return coursegenApi.status(request.options.courseSlug);
  }
}
