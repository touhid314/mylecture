import { existsSync } from 'node:fs';
import { writeLectureCaptionsVtt } from '../captions-vtt.ts';
import { lectureFolderPath } from './paths.ts';
import { readCoursePlan, readCourseState } from './state.ts';
import { spawnAdmin } from './spawn.ts';
import { confirm } from './confirm.ts';

export type PublishCourseOptions = {
  courseSlug: string;
  yes?: boolean;
  goLive?: boolean;
  dryRun?: boolean;
};

function lectureSourceDir(courseSlug: string, lecture: { folderName: string; order: number; slug: string }) {
  const folderName = lecture.folderName || `${String(lecture.order).padStart(2, '0')}-${lecture.slug}`;
  return lectureFolderPath(courseSlug, folderName);
}

export async function publishCourse(options: PublishCourseOptions) {
  const plan = readCoursePlan(options.courseSlug);
  const state = readCourseState(options.courseSlug);

  const notDone = state.lectures.filter(lecture => lecture.status !== 'done');
  if (options.goLive && notDone.length > 0) {
    throw new Error(`Cannot go live: ${notDone.length} lecture(s) are not done: ${notDone.map(l => l.slug).join(', ')}`);
  }
  if (notDone.length > 0) {
    console.warn(`Warning: ${notDone.length} lecture(s) are not done: ${notDone.map(l => l.slug).join(', ')}`);
  }

  console.log(`\nPublish course: ${plan.title} (${plan.slug})`);
  console.log(`Lectures: ${state.lectures.length}`);
  console.log(`Mode: ${options.goLive ? 'GO LIVE (public)' : 'DRAFT (not visible on catalog)'}`);

  if (options.dryRun) {
    if (options.goLive) {
      for (const lecture of state.lectures) {
        console.log(`  publish-lecture --course ${plan.slug} --slug ${lecture.slug}`);
      }
      console.log(`  publish-course --slug ${plan.slug}`);
    } else {
      for (const lecture of state.lectures) {
        const sourceDir = lectureSourceDir(options.courseSlug, lecture);
        console.log(`  upload-lecture --course ${plan.slug} --slug ${lecture.slug} --title "${lecture.title}" --source-dir ${sourceDir}`);
      }
    }
    return;
  }

  const confirmMessage = options.goLive
    ? 'Publish this course live on the website?'
    : 'Upload this course to the website?';
  const ok = await confirm(confirmMessage, options.yes);
  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  const skippedSlugs: string[] = [];

  if (options.goLive) {
    const failedLectures: string[] = [];

    for (const lecture of state.lectures) {
      console.log(`\nPublishing lecture: ${lecture.slug}`);
      try {
        const sourceDir = lectureSourceDir(options.courseSlug, lecture);
        const captionsPath = existsSync(sourceDir) ? writeLectureCaptionsVtt(sourceDir) : null;
        if (captionsPath) console.log(`  captions: ${captionsPath}`);
        await spawnAdmin(['publish-lecture', '--course', plan.slug, '--slug', lecture.slug]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to publish ${lecture.slug}: ${message}`);
        failedLectures.push(lecture.slug);
      }
    }

    if (failedLectures.length > 0) {
      throw new Error(`Go-live failed: could not publish ${failedLectures.length} lecture(s): ${failedLectures.join(', ')}`);
    }

    await spawnAdmin(['publish-course', '--slug', plan.slug]);
  } else {
    let first = true;
    for (const lecture of state.lectures) {
      const sourceDir = lectureSourceDir(options.courseSlug, lecture);
      if (!existsSync(sourceDir)) {
        console.error(`Skipping ${lecture.slug}: folder not found (${sourceDir})`);
        skippedSlugs.push(lecture.slug);
        continue;
      }

      const captionsPath = writeLectureCaptionsVtt(sourceDir);
      if (captionsPath) {
        console.log(`  captions: ${captionsPath}`);
      }

      const args = [
        'upload-lecture',
        '--course', plan.slug,
        '--slug', lecture.slug,
        '--title', lecture.title,
        '--source-dir', sourceDir,
        '--description', lecture.objective,
        '--module', lecture.module,
        '--order', String(lecture.order),
        '--published', 'false'
      ];

      if (first) {
        args.push('--course-title', plan.title);
        args.push('--course-description', plan.description);
        args.push('--course-summary', plan.summary);
        first = false;
      }

      console.log(`\nUploading lecture: ${lecture.slug}`);
      await spawnAdmin(args);
    }
  }

  if (skippedSlugs.length > 0) {
    throw new Error(`Publish failed: skipped ${skippedSlugs.length} lecture(s) with missing folders: ${skippedSlugs.join(', ')}`);
  }

  console.log('\nPublish complete.');
  if (options.goLive) {
    console.log(`Rollback: npm run admin -- unpublish-course --slug ${plan.slug}`);
  } else {
    console.log('Course uploaded as draft. Review it before using the go-live operation.');
    console.log(`Per-lecture rollback: npm run admin -- unpublish-lecture --course ${plan.slug} --slug <lecture-slug> --purge-assets true`);
  }
}
