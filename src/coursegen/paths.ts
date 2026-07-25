import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadAppConfig, resolveConfigPath } from '../config.ts';

export const rootDir = process.cwd();

export function getCoursesRoot() {
  const config = loadAppConfig(rootDir);
  const generationDir = resolveConfigPath(rootDir, config.agent.generationDir);
  return path.join(generationDir, 'courses');
}

export function getSourcesRoot() {
  const config = loadAppConfig(rootDir);
  const generationDir = resolveConfigPath(rootDir, config.agent.generationDir);
  return path.join(generationDir, 'sources');
}

export function getSourceDir(sourceSlug: string) {
  return path.join(getSourcesRoot(), sourceSlug);
}

export function sourceManifestPath(sourceSlug: string) {
  return path.join(getSourceDir(sourceSlug), 'source-manifest.json');
}

export function sourceSectionsDir(sourceSlug: string) {
  return path.join(getSourceDir(sourceSlug), 'sections');
}

export function getCourseDir(courseSlug: string) {
  return path.join(getCoursesRoot(), courseSlug);
}

export function coursePlanPath(courseSlug: string) {
  return path.join(getCourseDir(courseSlug), 'course-plan.json');
}

export function courseStatePath(courseSlug: string) {
  return path.join(getCourseDir(courseSlug), 'course-state.json');
}

export function lectureFolderPath(courseSlug: string, folderName: string) {
  return path.join(getCourseDir(courseSlug), folderName);
}

export function ensureCourseDir(courseSlug: string) {
  const dir = getCourseDir(courseSlug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function websiteRoot() {
  return path.resolve(rootDir, '../mylecture-website');
}

export function lectureFolderName(order: number, slug: string) {
  const padded = String(order).padStart(2, '0');
  return `${padded}-${slug}`;
}

export function isIndexHtmlName(name: string) {
  return /^index.*\.html$/i.test(name);
}

export function isResolvedHtmlName(name: string) {
  return /^resolved.*\.html$/i.test(name);
}

export function resolvedSiblingPathForIndex(filePath: string) {
  const basename = path.basename(filePath);
  const suffix = basename.slice('index'.length, -'.html'.length);
  return path.join(path.dirname(filePath), `resolved${suffix}.html`);
}

export function ffmpegConcatPath(filePath: string) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}
