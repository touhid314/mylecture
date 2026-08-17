import { existsSync } from 'node:fs';
import { writeLectureCaptionsVtt } from '../../../mylecture-agent/src/render-worker/captions-vtt.ts';
import { assessmentsPath, lectureFolderPath } from './paths.ts';
import { readCoursePlan, readCourseState } from './state.ts';
import { spawnAdmin } from './spawn.ts';
import { confirm } from './confirm.ts';
import { ensureLectureThumbnail } from './thumbnail.ts';

export type PublishCourseOptions = {
  courseSlug: string;
  yes?: boolean;
  goLive?: boolean;
  dryRun?: boolean;
};

export function lecturesReadyToGoLive<T extends { status: string }>(lectures: T[]) {
  return lectures.filter(lecture => lecture.status === 'done');
}

function lectureSourceDir(courseSlug: string, lecture: { folderName: string; order: number; slug: string }) {
  const folderName = lecture.folderName || `${String(lecture.order).padStart(2, '0')}-${lecture.slug}`;
  return lectureFolderPath(courseSlug, folderName);
}

export async function publishCourse(options: PublishCourseOptions) {
  const plan = readCoursePlan(options.courseSlug);
  const state = readCourseState(options.courseSlug);

  const notDone = state.lectures.filter(lecture => lecture.status !== 'done');
  const readyToGoLive = lecturesReadyToGoLive(state.lectures);
  if (notDone.length > 0) {
    console.warn(`Warning: ${notDone.length} lecture(s) are not done: ${notDone.map(l => l.slug).join(', ')}`);
    if (options.goLive) {
      console.warn('Go-live will publish finished lectures only; unfinished ones stay off the catalog.');
    }
  }
  if (options.goLive && readyToGoLive.length === 0) {
    console.error('Cannot go live: no lecture is done yet.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nPublish course: ${plan.title} (${plan.slug})`);
  console.log(`Lectures: ${state.lectures.length}`);
  console.log(`Mode: ${options.goLive ? 'GO LIVE (public)' : 'DRAFT (not visible on catalog)'}`);

  if (options.dryRun) {
    const assessmentsFile = assessmentsPath(options.courseSlug);
    if (options.goLive) {
      for (const lecture of readyToGoLive) {
        console.log(`  publish-lecture --course ${plan.slug} --slug ${lecture.slug}`);
      }
      console.log(`  publish-course --slug ${plan.slug}`);
    } else {
      for (const lecture of state.lectures) {
        const sourceDir = lectureSourceDir(options.courseSlug, lecture);
        console.log(`  thumbnail ${sourceDir}/thumbnail.jpg`);
        console.log(`  upload-lecture --course ${plan.slug} --slug ${lecture.slug} --title "${lecture.title}" --source-dir ${sourceDir}`);
      }
    }
    if (existsSync(assessmentsFile)) {
      console.log(`  upsert-course-assessments --course ${plan.slug} --file ${assessmentsFile}`);
    }
    return;
  }

  const confirmMessage = options.goLive
    ? notDone.length > 0
      ? `Publish this course live? ${readyToGoLive.length} finished lecture(s) will go public; ${notDone.length} unfinished stay off the catalog.`
      : 'Publish this course live on the website?'
    : 'Upload this course to the website?';
  const ok = await confirm(confirmMessage, options.yes);
  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  const skippedSlugs: string[] = [];

  if (options.goLive) {
    const failedLectures: string[] = [];

    for (const lecture of readyToGoLive) {
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

    if (failedLectures.length === readyToGoLive.length) {
      console.error(`\nGo-live failed: could not publish any finished lecture(s): ${failedLectures.join(', ')}`);
      console.error('If a lecture was never uploaded, run publish (without --go-live) first.');
      console.error(`Fix the issues above and re-run: npm run coursegen -- publish --course ${plan.slug} --go-live`);
      process.exitCode = 1;
      return;
    }
    if (failedLectures.length > 0) {
      console.warn(`\nSkipped ${failedLectures.length} finished lecture(s) that are not on the website yet: ${failedLectures.join(', ')}`);
      console.warn('Upload draft first, then go live again to include them.');
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

      if (lecture.status === 'needs-review') {
        console.warn(`Warning: ${lecture.slug} has needs-review status — practice QA not passed; draft upload may ship incomplete activities.`);
      }

      const captionsPath = writeLectureCaptionsVtt(sourceDir);
      if (captionsPath) {
        console.log(`  captions: ${captionsPath}`);
      }

      try {
        const thumbnail = await ensureLectureThumbnail(sourceDir);
        if (thumbnail?.captured) {
          console.log(`  thumbnail: ${thumbnail.path} @ ${thumbnail.seekSeconds?.toFixed(1)}s`);
        } else if (thumbnail) {
          console.log(`  thumbnail: ${thumbnail.path}`);
        } else {
          console.warn(`  thumbnail: skipped (no MP4 in ${sourceDir})`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  thumbnail: skipped (${message})`);
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
    console.error(`\nPublish failed: skipped ${skippedSlugs.length} lecture(s) with missing folders: ${skippedSlugs.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const assessmentsFile = assessmentsPath(options.courseSlug);
  if (existsSync(assessmentsFile)) {
    console.log(`\nUploading assessments: ${assessmentsFile}`);
    await spawnAdmin([
      'upsert-course-assessments',
      '--course', plan.slug,
      '--file', assessmentsFile
    ]);
  }

  console.log('\nPublish complete.');
  if (options.goLive) {
    if (notDone.length > 0) {
      console.log(`Unfinished lectures were not published: ${notDone.map(l => l.slug).join(', ')}`);
    }
    console.log(`Rollback: npm run admin -- unpublish-course --slug ${plan.slug}`);
  } else {
    console.log(`Course uploaded as draft. Review, then: npm run coursegen -- publish --course ${plan.slug} --go-live`);
    console.log(`Per-lecture rollback: npm run admin -- unpublish-lecture --course ${plan.slug} --slug <lecture-slug> --purge-assets true`);
  }
}
