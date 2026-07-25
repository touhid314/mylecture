import path from 'node:path';
import { writeLectureCaptionsVtt } from '../captions-vtt.ts';
import { readCoursePlan, readCourseState } from './state.ts';
import { lectureFolderPath } from './paths.ts';

export type WriteCourseCaptionsOptions = {
  courseSlug: string;
  lectureSlug?: string;
};

export function writeCourseCaptions(options: WriteCourseCaptionsOptions) {
  const plan = readCoursePlan(options.courseSlug);
  let state;
  try {
    state = readCourseState(options.courseSlug);
  } catch {
    state = null;
  }

  const lectures = state?.lectures ?? [];
  const targets = options.lectureSlug
    ? lectures.filter(lecture => lecture.slug === options.lectureSlug)
    : lectures;

  if (options.lectureSlug && targets.length === 0) {
    throw new Error(`Lecture not found in course state: ${options.lectureSlug}`);
  }

  let written = 0;
  for (const lecture of targets) {
    const folderName = lecture.folderName || `${String(lecture.order).padStart(2, '0')}-${lecture.slug}`;
    const folderPath = lectureFolderPath(plan.slug, folderName);
    const captionsPath = writeLectureCaptionsVtt(folderPath);
    if (captionsPath) {
      written += 1;
      console.log(`Wrote ${path.relative(process.cwd(), captionsPath)}`);
    } else {
      console.log(`Skipped ${lecture.slug}: no resolved timeline cues found`);
    }
  }

  if (written === 0) {
    console.log('No captions.vtt files were written.');
  } else {
    console.log(`\nWrote captions for ${written} lecture(s). Re-publish to upload VTT to the website.`);
  }
}
